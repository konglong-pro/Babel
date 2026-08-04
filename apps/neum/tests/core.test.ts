import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

import BetterSqlite3 from "better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { assertCurrentNeumSchema } from "@/lib/db/readiness";
import {
  NEUM_SNAPSHOT_APP_ID,
  NEUM_SNAPSHOT_SCHEMA_VERSION,
  readNeumDatabaseSnapshot,
  validateSnapshotManifest,
} from "@/lib/exchange";
import type * as DatabaseModule from "@/lib/db/client";
import type * as RepositoryModule from "@/lib/repositories";
import type * as StorageModule from "@/lib/storage";

let temporaryRoot = "";
let database: ReturnType<typeof DatabaseModule.getNeumDatabase>;
let repository: typeof RepositoryModule;
let storage: typeof StorageModule;

before(async () => {
  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "neum-core-test-"));
  process.env.NEUM_DATABASE_PATH = path.join(temporaryRoot, "sqlite.db");
  process.env.NEUM_UPLOAD_DIRECTORY = path.join(temporaryRoot, "uploads");
  const databaseModule = await import("@/lib/db/client");
  assert.equal(existsSync(process.env.NEUM_DATABASE_PATH), false);
  database = databaseModule.getNeumDatabase();
  assert.equal(existsSync(process.env.NEUM_DATABASE_PATH), true);
  migrate(database.db, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  [repository, storage] = await Promise.all([
    import("@/lib/repositories"),
    import("@/lib/storage"),
  ]);
});

after(async () => {
  database.sqlite.close();
  await rm(temporaryRoot, { recursive: true, force: true });
});

test("Neum core persistence", async (t) => {
  await t.test("fresh migration creates the domain schema and only Inbox", () => {
    assert.doesNotThrow(() => assertCurrentNeumSchema(database.sqlite));
    assert.deepEqual(
      repository.listFolders().map(({ name, parentId }) => ({ name, parentId })),
      [{ name: "Inbox", parentId: null }],
    );
    const tables = database.sqlite
      .prepare(
        `SELECT name FROM sqlite_schema
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle_%'
           AND name NOT GLOB 'entry_search_*'
           AND name NOT GLOB 'tag_search_*'
         ORDER BY name`,
      )
      .pluck()
      .all();
    assert.deepEqual(tables, [
      "entry",
      "entry_image",
      "entry_link",
      "entry_search",
      "entry_tag",
      "folder",
      "tag",
      "tag_search",
      "trash_entry",
    ]);

    const incomplete = new BetterSqlite3(":memory:");
    try {
      incomplete.exec("CREATE TABLE folder (id INTEGER PRIMARY KEY)");
      assert.throws(() => assertCurrentNeumSchema(incomplete), /Missing Neum/);
    } finally {
      incomplete.close();
    }
  });

  await t.test("folders enforce sibling identity, cycles, and protected deletion", () => {
    const systems = repository.createFolder({ name: "Systems" });
    assert.throws(
      () => repository.createFolder({ name: " systems " }),
      repositoryConflict("CONFLICT"),
    );
    repository.createFolder({ name: "Ärchive" });
    assert.throws(
      () => repository.createFolder({ name: "A\u0308RCHIVE" }),
      repositoryConflict("CONFLICT"),
    );
    const languages = repository.createFolder({ name: "Languages" });
    repository.createFolder({ name: "Shared", parentId: systems.id });
    repository.createFolder({ name: "Shared", parentId: languages.id });
    const operatingSystems = repository.createFolder({
      name: "Operating systems",
      parentId: systems.id,
    });
    assert.throws(
      () => repository.updateFolder(systems.id, { parentId: operatingSystems.id }),
      repositoryConflict("CONFLICT"),
    );
    assert.throws(
      () => repository.deleteFolder(systems.id),
      repositoryConflict("NOT_EMPTY"),
    );

    const historical = repository.createFolder({ name: "Historical records" });
    const historicalRow = database.sqlite
      .prepare(
        `INSERT INTO trash_entry (original_entry_id, folder_id, snapshot_json)
         VALUES (?, ?, ?)`,
      )
      .run(900_000_000, historical.id, "{}");
    try {
      assert.throws(
        () => repository.deleteFolder(historical.id),
        /preserved historical records/u,
      );
    } finally {
      database.sqlite
        .prepare("DELETE FROM trash_entry WHERE id = ?")
        .run(historicalRow.lastInsertRowid);
    }
    assert.equal(repository.deleteFolder(historical.id), true);
  });

  await t.test("folders persist root and nested sibling order", () => {
    const previousFirstRoot = repository.listFolders().find(({ parentId }) => parentId === null);
    assert.ok(previousFirstRoot);
    const rootA = repository.createFolder({ name: "Order root A" });
    const rootB = repository.createFolder({ name: "Order root B" });
    const childA = repository.createFolder({ name: "Order child A", parentId: rootA.id });
    const childB = repository.createFolder({ name: "Order child B", parentId: rootA.id });

    repository.updateFolder(rootB.id, { position: 0 });
    repository.updateFolder(childB.id, { position: 0 });

    const ordered = repository.listFolders();
    assert.deepEqual(
      ordered.filter(({ parentId }) => parentId === null).slice(0, 2).map(({ id }) => id),
      [rootB.id, previousFirstRoot.id],
    );
    assert.deepEqual(
      ordered.filter(({ parentId }) => parentId === rootA.id).map(({ id }) => id),
      [childB.id, childA.id],
    );
    assert.throws(
      () => repository.updateFolder(rootA.id, { position: 999 }),
      repositoryConflict("VALIDATION"),
    );
  });

  await t.test("entries preserve raw code, relational tags, filters, and versions", () => {
    const inbox = repository.listFolders()[0];
    const child = repository.createFolder({ name: "Search child", parentId: inbox.id });
    const knowledge = repository.createEntry({
      folderId: inbox.id,
      kind: "knowledge",
      title: "C++ percent% overview",
      notesMd: "A literal foo_bar and JSON key: feature_flag",
      tags: [" C++ ", "c++", "JSON"],
    });
    const invalidYaml = "service:\n  enabled: [not closed";
    const snippet = repository.createEntry({
      folderId: child.id,
      kind: "snippet",
      title: "Broken YAML",
      notesMd: "Kept intentionally incomplete.",
      code: invalidYaml,
      language: "yaml",
      filename: "service.yaml",
      tags: ["JSON", "Config"],
    });
    assert.equal(repository.getEntry(snippet.id)?.code, invalidYaml);
    assert.deepEqual(repository.getEntry(knowledge.id)?.tags, ["C++", "JSON"]);
    assert.deepEqual(
      repository.listTags().map(({ name, entryCount }) => ({ name, entryCount })),
      [
        { name: "C++", entryCount: 1 },
        { name: "Config", entryCount: 1 },
        { name: "JSON", entryCount: 2 },
      ],
    );

    assert.deepEqual(repository.searchEntries("C++").items.map(({ id }) => id), [
      knowledge.id,
    ]);
    assert.deepEqual(repository.searchEntries("%").items.map(({ id }) => id), [
      knowledge.id,
    ]);
    assert.deepEqual(repository.searchEntries("foo_bar").items.map(({ id }) => id), [
      knowledge.id,
    ]);
    assert.deepEqual(
      repository.listEntries({ folderId: inbox.id }).items.map(({ id }) => id).sort(),
      [knowledge.id, snippet.id].sort(),
    );
    assert.deepEqual(
      repository
        .listEntries({ folderId: inbox.id, includeDescendants: false })
        .items.map(({ id }) => id),
      [knowledge.id],
    );
    assert.equal(repository.listEntries({ tag: "json", limit: 1 }).total, 2);
    assert.deepEqual(
      repository.listEntries({ kind: "knowledge" }).items.map(({ id }) => id),
      [knowledge.id],
    );
    assert.deepEqual(
      repository.listEntries({ kind: "snippet" }).items.map(({ id }) => id),
      [snippet.id],
    );
    assert.throws(
      () => repository.updateEntry(knowledge.id, {
        expectedVersion: knowledge.version,
        kind: "snippet",
        code: "{ definitely: not-json }",
        language: "json",
        filename: "sample.json",
      }),
      repositoryConflict("CONFLICT"),
    );
    const renamed = repository.updateEntry(knowledge.id, {
      expectedVersion: knowledge.version,
      title: "C++ overview",
    }).entry;
    assert.equal(renamed.version, knowledge.version + 1);
    assert.equal(renamed.kind, "knowledge");
    assert.throws(
      () =>
        repository.updateEntry(knowledge.id, {
          expectedVersion: knowledge.version,
          title: "Stale edit",
        }),
      repositoryConflict("VERSION_CONFLICT"),
    );
    assert.throws(
      () =>
        repository.createEntry({
          folderId: inbox.id,
          kind: "snippet",
          title: "Missing language",
          code: "{}",
        }),
      repositoryConflict("VALIDATION"),
    );

    repository.createEntry({
      folderId: inbox.id,
      kind: "knowledge",
      title: "Unicode tag one",
      tags: ["Älgorithms"],
    });
    repository.createEntry({
      folderId: inbox.id,
      kind: "knowledge",
      title: "Unicode tag two",
      tags: ["A\u0308LGORITHMS"],
    });
    assert.equal(repository.listEntries({ tag: "älgorithms" }).total, 2);
    assert.equal(
      repository.listTags().filter(({ name }) => name === "Älgorithms").length,
      1,
    );
  });

  await t.test("search ranks the complete result set before pagination", () => {
    const folderId = repository.listFolders()[0].id;
    const query = "Rank before pagination";
    const exactTitle = repository.createEntry({
      folderId,
      kind: "knowledge",
      title: query,
    });
    repository.createEntry({
      folderId,
      kind: "knowledge",
      title: "Newer body-only match",
      notesMd: `This note mentions ${query} only in its body.`,
    });

    const page = repository.searchEntries(query, { limit: 1 });

    assert.equal(page.total, 2);
    assert.equal(page.limit, 1);
    assert.equal(page.offset, 0);
    assert.equal(page.items[0]?.id, exactTitle.id);
    assert.deepEqual(page.items[0]?.match.matchedFields, ["title"]);
    assert.deepEqual(page.items[0]?.match.snippet, {
      field: "title",
      parts: [{ text: "Title match", highlighted: false }],
      truncatedStart: false,
      truncatedEnd: false,
    });
    assert.equal(repository.searchEntries(query, { limit: 1, offset: 1 }).items[0]?.title, "Newer body-only match");
  });

  await t.test("search applies every relevance tier and deterministic tie breaker", () => {
    const folderId = repository.listFolders()[0].id;
    const query = "Neum tier token 7f3";
    const exactTitle = repository.createEntry({
      folderId,
      kind: "knowledge",
      title: query,
    });
    const titlePrefix = repository.createEntry({
      folderId,
      kind: "knowledge",
      title: `${query} reference`,
    });
    const exactTag = repository.createEntry({
      folderId,
      kind: "knowledge",
      title: "Exact tag tier",
      tags: [query],
    });
    const exactFilename = repository.createEntry({
      folderId,
      kind: "snippet",
      title: "Exact filename tier",
      code: "const tier = 2;",
      language: "typescript",
      filename: query,
    });
    const titleContains = repository.createEntry({
      folderId,
      kind: "knowledge",
      title: `Before ${query} after`,
    });
    const metadataContains = repository.createEntry({
      folderId,
      kind: "snippet",
      title: "Metadata tier",
      code: "const tier = 4;",
      language: `lang-${query}-mode`,
    });
    const bodyContains = repository.createEntry({
      folderId,
      kind: "knowledge",
      title: "Body tier",
      notesMd: `Only the body contains ${query}.`,
    });

    const tieredItems = repository.searchEntries(query, { limit: 20 }).items;
    assert.deepEqual(
      tieredItems.map(({ id }) => id),
      [
        exactTitle.id,
        titlePrefix.id,
        exactFilename.id,
        exactTag.id,
        titleContains.id,
        metadataContains.id,
        bodyContains.id,
      ],
    );
    assert.equal(tieredItems.find(({ id }) => id === exactTag.id)?.match.snippet.field, "tags");
    assert.equal(
      tieredItems.find(({ id }) => id === exactFilename.id)?.match.snippet.field,
      "filename",
    );

    const fieldCountQuery = "Neum field count 8g4";
    const multipleFields = repository.createEntry({
      folderId,
      kind: "knowledge",
      title: fieldCountQuery,
      notesMd: fieldCountQuery,
    });
    repository.createEntry({
      folderId,
      kind: "knowledge",
      title: fieldCountQuery,
    });
    assert.equal(repository.searchEntries(fieldCountQuery).items[0]?.id, multipleFields.id);

    const occurrenceQuery = "Neum occurrence 4p2";
    const twice = repository.createEntry({
      folderId,
      kind: "knowledge",
      title: "Two body occurrences",
      notesMd: `${occurrenceQuery} then ${occurrenceQuery}`,
    });
    repository.createEntry({
      folderId,
      kind: "knowledge",
      title: "One body occurrence",
      notesMd: occurrenceQuery,
    });
    assert.equal(repository.searchEntries(occurrenceQuery).items[0]?.id, twice.id);

    const cappedQuery = "Neum capped count 2k6";
    const earlierPosition = repository.createEntry({
      folderId,
      kind: "knowledge",
      title: "Five capped occurrences",
      notesMd: Array.from({ length: 5 }, () => cappedQuery).join(" "),
    });
    repository.createEntry({
      folderId,
      kind: "knowledge",
      title: "Six later occurrences",
      notesMd: `Padding before the match. ${Array.from({ length: 6 }, () => cappedQuery).join(" ")}`,
    });
    assert.equal(repository.searchEntries(cappedQuery).items[0]?.id, earlierPosition.id);

    const updatedQuery = "Neum updated tie 5m1";
    const firstId = repository.createEntry({
      folderId,
      kind: "knowledge",
      title: "First stable row",
      notesMd: updatedQuery,
    });
    const secondId = repository.createEntry({
      folderId,
      kind: "knowledge",
      title: "Second stable row",
      notesMd: updatedQuery,
    });
    database.sqlite.prepare("UPDATE entry SET updated_at = ? WHERE id = ?")
      .run("2026-01-02T00:00:00.000Z", firstId.id);
    database.sqlite.prepare("UPDATE entry SET updated_at = ? WHERE id = ?")
      .run("2026-01-01T00:00:00.000Z", secondId.id);
    assert.equal(repository.searchEntries(updatedQuery).items[0]?.id, firstId.id);
    database.sqlite.prepare("UPDATE entry SET updated_at = ? WHERE id IN (?, ?)")
      .run("2026-01-03T00:00:00.000Z", firstId.id, secondId.id);
    assert.equal(repository.searchEntries(updatedQuery).items[0]?.id, secondId.id);
  });

  await t.test("search keeps literal characters, case behavior, and filters", () => {
    const inboxId = repository.listFolders()[0].id;
    const scope = repository.createFolder({ name: "Search filter scope", parentId: inboxId });
    const child = repository.createFolder({ name: "Search filter child", parentId: scope.id });
    const query = "Neum scoped literal 3v8";
    const direct = repository.createEntry({
      folderId: scope.id,
      kind: "knowledge",
      title: query,
    });
    repository.createEntry({
      folderId: child.id,
      kind: "knowledge",
      title: "Scoped child note",
      notesMd: query,
      tags: ["Neum scoped tag"],
    });
    const snippet = repository.createEntry({
      folderId: child.id,
      kind: "snippet",
      title: "Scoped child snippet",
      code: query,
      language: "text",
      tags: ["Neum scoped tag"],
    });

    assert.equal(repository.searchEntries(query, { folderId: scope.id }).total, 3);
    assert.deepEqual(
      repository.searchEntries(query, {
        folderId: scope.id,
        includeDescendants: false,
      }).items.map(({ id }) => id),
      [direct.id],
    );
    assert.deepEqual(
      repository.searchEntries(query, { folderId: scope.id, kind: "snippet" }).items.map(({ id }) => id),
      [snippet.id],
    );
    assert.equal(
      repository.searchEntries(query, { folderId: scope.id, tag: "neum scoped tag" }).total,
      2,
    );
    const offsetPage = repository.searchEntries(query, {
      folderId: scope.id,
      limit: 1,
      offset: 1,
    });
    assert.equal(offsetPage.total, 3);
    assert.equal(offsetPage.limit, 1);
    assert.equal(offsetPage.offset, 1);

    const literals = repository.createEntry({
      folderId: scope.id,
      kind: "knowledge",
      title: "ASCII NEEDLE 中文 😀 percent% underscore_ slash\\ C++ ÄCaseSentinel",
    });
    for (const literalQuery of ["ascii needle", "中文", "😀", "%", "_", "\\", "C++", "Äcasesentinel"]) {
      assert.ok(repository.searchEntries(literalQuery).items.some(({ id }) => id === literals.id));
    }
    assert.equal(repository.searchEntries("äcasesentinel").items.some(({ id }) => id === literals.id), false);

    const multilineQuery = "Multiline\tneedle 😀";
    const longMarkdown = repository.createEntry({
      folderId: scope.id,
      kind: "knowledge",
      title: "Long Markdown snippet",
      notesMd: `${"Prefix context. ".repeat(30)}${multilineQuery}${" Suffix context.".repeat(30)}`,
    });
    const markdownMatch = repository.searchEntries(multilineQuery).items
      .find(({ id }) => id === longMarkdown.id)?.match;
    assert.ok(markdownMatch);
    assert.equal(markdownMatch.snippet.field, "notesMd");
    assert.equal(markdownMatch.snippet.truncatedStart, true);
    assert.equal(markdownMatch.snippet.truncatedEnd, true);
    assert.ok(
      markdownMatch.snippet.parts.some(
        ({ text, highlighted }) => highlighted && text === "Multiline needle 😀",
      ),
    );

    const edgeQuery = "Neum Markdown edge 6h9";
    const atStart = repository.createEntry({
      folderId: scope.id,
      kind: "knowledge",
      title: "Markdown hit at start",
      notesMd: `${edgeQuery} ${"tail ".repeat(80)}`,
    });
    const atEnd = repository.createEntry({
      folderId: scope.id,
      kind: "knowledge",
      title: "Markdown hit at end",
      notesMd: `${"head ".repeat(80)}${edgeQuery}`,
    });
    const edgeMatches = new Map(
      repository.searchEntries(edgeQuery).items.map((item) => [item.id, item.match.snippet]),
    );
    assert.equal(edgeMatches.get(atStart.id)?.truncatedStart, false);
    assert.equal(edgeMatches.get(atStart.id)?.truncatedEnd, true);
    assert.equal(edgeMatches.get(atEnd.id)?.truncatedStart, true);
    assert.equal(edgeMatches.get(atEnd.id)?.truncatedEnd, false);
  });

  await t.test("wikilinks resolve deterministically and follow entry lifecycle", () => {
    const inbox = repository.listFolders()[0];
    const source = repository.createEntry({
      folderId: inbox.id,
      kind: "knowledge",
      title: "Wikilink lifecycle source",
      notesMd: [
        "[[  Wikilink lifecycle target  ]] and [[wikilink lifecycle target|again]]",
        "`[[Skipped inline target]]`",
        "```txt",
        "[[Skipped fenced target]]",
        "```",
      ].join("\n"),
    });
    assert.deepEqual(source.links, [
      {
        titleKey: "wikilink lifecycle target",
        targetId: null,
        targetKind: null,
      },
    ]);

    const firstTarget = repository.createEntry({
      folderId: inbox.id,
      kind: "snippet",
      title: "Wikilink lifecycle target",
      code: "const first = true;",
      language: "typescript",
    });
    const secondTarget = repository.createEntry({
      folderId: inbox.id,
      kind: "knowledge",
      title: "WIKILINK   LIFECYCLE TARGET",
    });
    assert.deepEqual(repository.getEntry(source.id)?.links, [
      {
        titleKey: "wikilink lifecycle target",
        targetId: firstTarget.id,
        targetKind: "snippet",
      },
    ]);
    assert.deepEqual(
      repository.listEntryBacklinks(firstTarget.id).map(({ id }) => id),
      [source.id],
    );

    const renamedFirst = repository.updateEntry(firstTarget.id, {
      expectedVersion: firstTarget.version,
      title: "Wikilink lifecycle renamed",
    }).entry;
    assert.equal(repository.getEntry(source.id)?.links[0]?.targetId, secondTarget.id);
    repository.updateEntry(secondTarget.id, {
      expectedVersion: secondTarget.version,
      title: "Wikilink lifecycle second renamed",
    });
    assert.equal(repository.getEntry(source.id)?.links[0]?.targetId, null);
    const restoredName = repository.updateEntry(renamedFirst.id, {
      expectedVersion: renamedFirst.version,
      title: "Wikilink lifecycle target",
    }).entry;
    assert.equal(repository.getEntry(source.id)?.links[0]?.targetId, firstTarget.id);

    const beforeStale = repository.getEntry(source.id)!;
    assert.throws(
      () =>
        repository.updateEntry(source.id, {
          expectedVersion: beforeStale.version + 1,
          notesMd: "[[Stale replacement target]]",
        }),
      repositoryConflict("VERSION_CONFLICT"),
    );
    assert.deepEqual(repository.getEntry(source.id), beforeStale);

    database.sqlite.exec(`CREATE TRIGGER fail_wikilink_insert
      BEFORE INSERT ON entry_link
      WHEN NEW.target_title_key = 'forced rollback target'
      BEGIN SELECT RAISE(ABORT, 'forced wikilink failure'); END`);
    try {
      assert.throws(
        () =>
          repository.createEntry({
            folderId: inbox.id,
            kind: "knowledge",
            title: "Wikilink rolled back create",
            notesMd: "[[Forced rollback target]]",
          }),
        /forced wikilink failure/,
      );
      assert.equal(repository.listEntryTitles("Wikilink rolled back create").length, 0);
      assert.throws(
        () =>
          repository.updateEntry(source.id, {
            expectedVersion: beforeStale.version,
            notesMd: "[[Forced rollback target]]",
          }),
        /forced wikilink failure/,
      );
      assert.deepEqual(repository.getEntry(source.id), beforeStale);
    } finally {
      database.sqlite.exec("DROP TRIGGER fail_wikilink_insert");
    }

    assert.deepEqual(
      repository.deleteEntry(source.id, beforeStale.version, []),
      { imagePaths: [] },
    );
    assert.deepEqual(repository.listEntryBacklinks(firstTarget.id), []);

    const survivingSource = repository.createEntry({
      folderId: inbox.id,
      kind: "knowledge",
      title: "Wikilink surviving source",
      notesMd: "[[Wikilink lifecycle target]]",
    });
    assert.equal(repository.getEntry(survivingSource.id)?.links[0]?.targetId, firstTarget.id);
    assert.deepEqual(
      repository.deleteEntry(restoredName.id, restoredName.version, []),
      { imagePaths: [] },
    );
    assert.equal(repository.getEntry(survivingSource.id)?.links[0]?.targetId, null);
    const replacementTarget = repository.createEntry({
      folderId: inbox.id,
      kind: "knowledge",
      title: "Wikilink lifecycle target",
    });
    assert.equal(
      repository.getEntry(survivingSource.id)?.links[0]?.targetId,
      replacementTarget.id,
    );
  });

  await t.test("title suggestions use escaped SQL prefixes and bounded results", () => {
    const folderId = repository.listFolders()[0].id;
    const literal = repository.createEntry({
      folderId,
      kind: "knowledge",
      title: "Neum %_ literal prefix",
    });
    repository.createEntry({
      folderId,
      kind: "snippet",
      title: "Before Neum %_ literal prefix",
      code: "const infix = true;",
      language: "typescript",
    });
    const slash = repository.createEntry({
      folderId,
      kind: "knowledge",
      title: "Neum slash\\ literal prefix",
    });
    const unicode = repository.createEntry({
      folderId,
      kind: "knowledge",
      title: "Ĉapitro   Du",
    });

    assert.deepEqual(repository.listEntryTitles("neum %_", 20), [
      { id: literal.id, kind: literal.kind, title: literal.title },
    ]);
    assert.deepEqual(repository.listEntryTitles("neum slash\\", 20), [
      { id: slash.id, kind: slash.kind, title: slash.title },
    ]);
    assert.deepEqual(repository.listEntryTitles("ĉa", 20), [
      { id: unicode.id, kind: unicode.kind, title: unicode.title },
    ]);
    assert.deepEqual(repository.listEntryTitles("ĉapitro du", 20), [
      { id: unicode.id, kind: unicode.kind, title: unicode.title },
    ]);
    assert.equal(repository.listEntryTitles("", 1).length, 1);
  });

  await t.test("entries form guarded page trees and move as a branch", () => {
    const source = repository.createFolder({ name: "Page tree source" });
    const target = repository.createFolder({ name: "Page tree target" });
    const root = repository.createEntry({
      folderId: source.id,
      kind: "knowledge",
      title: "Root page",
    });
    const child = repository.createEntry({
      folderId: source.id,
      parentId: root.id,
      kind: "knowledge",
      title: "Child page",
    });
    const grandchild = repository.createEntry({
      folderId: source.id,
      parentId: child.id,
      kind: "knowledge",
      title: "Grandchild page",
    });

    assert.equal(repository.getEntry(child.id)?.parentId, root.id);
    assert.equal(repository.getEntry(grandchild.id)?.parentId, child.id);
    assert.throws(
      () =>
        repository.createEntry({
          folderId: source.id,
          parentId: root.id,
          kind: "snippet",
          title: "Cross-unit child",
          code: "const child = true;",
          language: "typescript",
        }),
      repositoryConflict("CONFLICT"),
    );
    assert.throws(
      () =>
        repository.createEntry({
          folderId: target.id,
          parentId: root.id,
          kind: "knowledge",
          title: "Cross-folder child",
        }),
      repositoryConflict("CONFLICT"),
    );
    assert.throws(
      () =>
        repository.updateEntry(root.id, {
          expectedVersion: root.version,
          parentId: grandchild.id,
        }),
      repositoryConflict("CONFLICT"),
    );
    assert.throws(
      () => repository.deleteEntry(root.id, root.version, []),
      repositoryConflict("NOT_EMPTY"),
    );

    const moved = repository.updateEntry(root.id, {
      expectedVersion: root.version,
      folderId: target.id,
    }).entry;
    assert.equal(moved.folderId, target.id);
    assert.equal(moved.parentId, null);
    assert.equal(repository.getEntry(child.id)?.folderId, target.id);
    assert.equal(repository.getEntry(grandchild.id)?.folderId, target.id);
    const completeTree = repository.listEntries({
      folderId: target.id,
      completeTree: true,
      limit: 1,
    });
    assert.equal(completeTree.items.length, completeTree.total);
    assert.ok(completeTree.items.length >= 3);

    const movedGrandchild = repository.getEntry(grandchild.id)!;
    assert.deepEqual(
      repository.deleteEntry(grandchild.id, movedGrandchild.version, []),
      { imagePaths: [] },
    );
    assert.equal(repository.getEntry(grandchild.id), null);
  });

  await t.test("legacy trash snapshots stay valid when their active parent moves", () => {
    const source = repository.createFolder({ name: "Legacy snapshot source" });
    const target = repository.createFolder({ name: "Legacy snapshot target" });
    const root = repository.createEntry({
      folderId: source.id,
      kind: "knowledge",
      title: "Legacy snapshot root",
    });
    const child = repository.createEntry({
      folderId: source.id,
      parentId: root.id,
      kind: "knowledge",
      title: "Legacy snapshot child",
    });

    const legacySnapshot = {
      entry: {
        id: child.id,
        parentId: child.parentId,
        folderId: child.folderId,
        kind: child.kind,
        title: child.title,
        notesMd: child.notesMd,
        code: child.code,
        language: child.language,
        filename: child.filename,
        version: child.version,
        createdAt: child.createdAt,
        updatedAt: child.updatedAt,
      },
      tags: child.tags,
      imagePaths: [],
    };
    const legacyTrashId = Number(database.sqlite.transaction(() => {
      const inserted = database.sqlite
        .prepare(
          `INSERT INTO trash_entry (original_entry_id, folder_id, snapshot_json)
           VALUES (?, ?, ?)`,
        )
        .run(child.id, child.folderId, JSON.stringify(legacySnapshot));
      database.sqlite.prepare("DELETE FROM entry WHERE id = ?").run(child.id);
      return inserted.lastInsertRowid;
    })());

    const movedRoot = repository.updateEntry(root.id, {
      expectedVersion: root.version,
      folderId: target.id,
    }).entry;
    const movedLegacy = database.sqlite
      .prepare(
        `SELECT folder_id AS folderId, snapshot_json AS snapshotJson
         FROM trash_entry WHERE id = ?`,
      )
      .get(legacyTrashId) as { folderId: number; snapshotJson: string };
    const movedSnapshot = JSON.parse(movedLegacy.snapshotJson) as {
      entry: { folderId: number; parentId: number | null };
    };
    assert.equal(movedLegacy.folderId, target.id);
    assert.equal(movedSnapshot.entry.folderId, target.id);
    assert.equal(movedSnapshot.entry.parentId, root.id);
    assert.deepEqual(
      repository.deleteEntry(root.id, movedRoot.version, []),
      { imagePaths: [] },
    );
    const detachedSnapshot = JSON.parse(
      database.sqlite
        .prepare("SELECT snapshot_json FROM trash_entry WHERE id = ?")
        .pluck()
        .get(legacyTrashId) as string,
    ) as { entry: { parentId: number | null } };
    assert.equal(detachedSnapshot.entry.parentId, null);

    const snapshot = readNeumDatabaseSnapshot(database.sqlite);
    assert.doesNotThrow(() =>
      validateSnapshotManifest({
        appId: NEUM_SNAPSHOT_APP_ID,
        schemaVersion: NEUM_SNAPSHOT_SCHEMA_VERSION,
        exportedAt: "2026-07-13T00:00:00.000Z",
        ...snapshot,
        images: [],
      }),
    );
  });

  await t.test("permanent deletion removes owned images without creating trash", async () => {
    const folder = repository.createFolder({ name: "Permanent image deletion" });
    const staged = await storage.stageEntryImages(
      "![diagram](neum-upload://diagram)",
      new Map([
        [
          "diagram",
          upload(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
        ],
      ]),
    );
    const entry = repository.createEntry(
      {
        folderId: folder.id,
        kind: "knowledge",
        title: "Owned diagram",
        notesMd: staged.notesMd,
      },
      staged.imagePaths,
    );
    assert.throws(
      () =>
        repository.createEntry({
          folderId: folder.id,
          kind: "knowledge",
          title: "Foreign diagram",
          notesMd: staged.notesMd,
        }),
      repositoryConflict("CONFLICT"),
    );

    assert.throws(
      () => repository.deleteEntry(entry.id, entry.version, []),
      repositoryConflict("CONFLICT"),
    );
    const trashCountBefore = database.sqlite
      .prepare("SELECT count(*) FROM trash_entry")
      .pluck()
      .get() as number;
    const quarantine = await storage.quarantineEntryImages(staged.imagePaths);
    try {
      assert.deepEqual(
        repository.deleteEntry(entry.id, entry.version, staged.imagePaths),
        { imagePaths: staged.imagePaths },
      );
    } catch (error) {
      await storage.restoreQuarantinedEntryImages(quarantine);
      throw error;
    }
    await storage.finalizeQuarantinedEntryImages(quarantine);
    assert.equal(repository.getEntry(entry.id), null);
    assert.deepEqual(repository.listEntryImagePaths(entry.id), []);
    await assert.rejects(storage.readEntryImage(staged.imagePaths[0]), {
      code: "NOT_FOUND",
    });
    assert.equal(
      database.sqlite.prepare("SELECT count(*) FROM trash_entry").pluck().get(),
      trashCountBefore,
    );
    assert.equal(repository.deleteFolder(folder.id), true);
  });
});

function repositoryConflict(code: RepositoryModule.RepositoryErrorCode) {
  return (error: unknown): boolean =>
    error instanceof repository.RepositoryError && error.code === code;
}

function upload(data: Buffer): StorageModule.EntryImageUpload {
  return {
    type: "image/png",
    size: data.byteLength,
    async arrayBuffer() {
      return Uint8Array.from(data).buffer;
    },
  };
}
