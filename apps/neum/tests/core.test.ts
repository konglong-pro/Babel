import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

import BetterSqlite3 from "better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { assertCurrentNeumSchema } from "@/lib/db/readiness";
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
         ORDER BY name`,
      )
      .pluck()
      .all();
    assert.deepEqual(tables, [
      "entry",
      "entry_image",
      "entry_tag",
      "folder",
      "tag",
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

    const converted = repository.updateEntry(knowledge.id, {
      expectedVersion: knowledge.version,
      kind: "snippet",
      code: "{ definitely: not-json }",
      language: "json",
      filename: "sample.json",
    }).entry;
    assert.equal(converted.version, knowledge.version + 1);
    assert.equal(converted.kind, "snippet");
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

  await t.test("owned images survive trash, restore, and only purge deletes them", async () => {
    const inbox = repository.listFolders()[0];
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
        folderId: inbox.id,
        kind: "knowledge",
        title: "Owned diagram",
        notesMd: staged.notesMd,
      },
      staged.imagePaths,
    );
    assert.throws(
      () =>
        repository.createEntry({
          folderId: inbox.id,
          kind: "knowledge",
          title: "Foreign diagram",
          notesMd: staged.notesMd,
        }),
      repositoryConflict("CONFLICT"),
    );

    const trashed = repository.moveEntryToTrash(entry.id, entry.version);
    assert.ok(trashed);
    assert.equal(repository.getEntry(entry.id), null);
    assert.deepEqual((await storage.readEntryImage(staged.imagePaths[0])).data.length, 8);
    assert.throws(
      () => repository.deleteFolder(inbox.id),
      repositoryConflict("NOT_EMPTY"),
    );

    const restored = repository.restoreTrashEntry(trashed.trashId);
    assert.equal(restored.id, entry.id);
    assert.equal(restored.version, entry.version + 1);
    assert.deepEqual(repository.listEntryImagePaths(entry.id), staged.imagePaths);

    const trashedAgain = repository.moveEntryToTrash(restored.id, restored.version);
    assert.ok(trashedAgain);
    const quarantine = await storage.quarantineEntryImages(staged.imagePaths);
    try {
      assert.deepEqual(
        repository.purgeTrashEntry(trashedAgain.trashId, staged.imagePaths),
        { imagePaths: staged.imagePaths },
      );
    } catch (error) {
      await storage.restoreQuarantinedEntryImages(quarantine);
      throw error;
    }
    await storage.finalizeQuarantinedEntryImages(quarantine);
    await assert.rejects(storage.readEntryImage(staged.imagePaths[0]), {
      code: "NOT_FOUND",
    });
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
