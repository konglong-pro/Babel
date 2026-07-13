import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import BetterSqlite3 from "better-sqlite3";

import { parseExportSnapshotArguments } from "../scripts/export-snapshot";
import { parseImportSnapshotArguments } from "../scripts/import-snapshot";
import {
  exportNeumSnapshot,
  importNeumSnapshot,
  readNeumDatabaseSnapshot,
  SnapshotError,
  validateSnapshotManifest,
  type NeumSnapshotManifest,
} from "../src/lib/exchange";
import { identityKey } from "../src/lib/identity";
import {
  assertCurrentNeumSchema,
  NEUM_SCHEMA_MIGRATION_TIMESTAMP,
} from "../src/lib/db/readiness";

const created = "2026-07-01T01:02:03.000Z";
const updated = "2026-07-02T04:05:06.000Z";
const deleted = "2026-07-03T07:08:09.000Z";
const activeImagePath = "data/uploads/entries/active.png";
const trashImagePath = "data/uploads/entries/deleted.gif";
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
const gif = Buffer.from("GIF89a\x01", "binary");

test("complete database and image snapshots round-trip without semantic loss", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "neum-snapshot-roundtrip-"));
  const sourceUploads = path.join(root, "source-uploads");
  const targetUploads = path.join(root, "target-uploads");
  const firstBundle = path.join(root, "first-bundle");
  const secondBundle = path.join(root, "second-bundle");
  const source = new BetterSqlite3(path.join(root, "source.db"));
  const target = new BetterSqlite3(path.join(root, "target.db"));
  try {
    createSchema(source);
    createSchema(target);
    seedRichSource(source);
    await writeImages(sourceUploads);

    const exported = await exportNeumSnapshot({
      sqlite: source,
      uploadDirectory: sourceUploads,
      destination: firstBundle,
      exportedAt: created,
    });
    assert.equal(exported.manifest.appId, "neum");
    assert.equal(exported.manifest.schemaVersion, 2);
    assert.equal(exported.manifest.entries[1].parentId, 11);
    assert.equal(exported.manifest.entries[1].code, "root: [still, editable");
    assert.equal(exported.manifest.trash[0].snapshot.entry.id, 99);
    assert.deepEqual((await readdir(path.join(firstBundle, "images"))).sort(), [
      "active.png",
      "deleted.gif",
    ]);

    const dryRun = await importNeumSnapshot({
      sqlite: target,
      uploadDirectory: targetUploads,
      bundle: firstBundle,
    });
    assert.equal(dryRun.applied, false);
    assert.equal(target.prepare('SELECT count(*) FROM "entry"').pluck().get(), 0);
    await assert.rejects(readdir(targetUploads), { code: "ENOENT" });

    const applied = await importNeumSnapshot({
      sqlite: target,
      uploadDirectory: targetUploads,
      bundle: firstBundle,
      apply: true,
    });
    assert.equal(applied.applied, true);
    assert.deepEqual(readNeumDatabaseSnapshot(target), readNeumDatabaseSnapshot(source));
    assert.deepEqual(
      target
        .prepare(
          `SELECT "source_entry_id" AS sourceId,
                  "target_title_key" AS targetTitleKey,
                  "target_entry_id" AS targetId
           FROM "entry_link"
           ORDER BY "target_title_key"`,
        )
        .all(),
      [
        {
          sourceId: 11,
          targetTitleKey: "broken yaml is still useful",
          targetId: 12,
        },
        {
          sourceId: 11,
          targetTitleKey: "missing restored target",
          targetId: null,
        },
      ],
    );
    assert.deepEqual(await readFile(path.join(targetUploads, "active.png")), png);
    assert.deepEqual(await readFile(path.join(targetUploads, "deleted.gif")), gif);

    const nextEntry = target
      .prepare(
        `INSERT INTO entry
          (folder_id, kind, title, notes_md, code, language, filename, version, created_at, updated_at)
         VALUES (?, 'knowledge', 'After restore', '', NULL, NULL, NULL, 1, ?, ?)`,
      )
      .run(7, created, updated);
    assert.ok(Number(nextEntry.lastInsertRowid) > 99);
    target.prepare('DELETE FROM entry WHERE id = ?').run(nextEntry.lastInsertRowid);

    const reexported = await exportNeumSnapshot({
      sqlite: target,
      uploadDirectory: targetUploads,
      destination: secondBundle,
      exportedAt: created,
    });
    assert.deepEqual(reexported.manifest, exported.manifest);
  } finally {
    source.close();
    target.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("bundle validation rejects extra, corrupted, and traversal image files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "neum-snapshot-validation-"));
  const sourceUploads = path.join(root, "source-uploads");
  const source = new BetterSqlite3(path.join(root, "source.db"));
  try {
    createSchema(source);
    seedRichSource(source);
    await writeImages(sourceUploads);

    const extraBundle = path.join(root, "extra");
    await exportNeumSnapshot({
      sqlite: source,
      uploadDirectory: sourceUploads,
      destination: extraBundle,
    });
    await writeFile(path.join(extraBundle, "images", "extra.png"), png);
    await assertBundleRejected(extraBundle, root, "INVALID_BUNDLE");

    const corruptBundle = path.join(root, "corrupt");
    await exportNeumSnapshot({
      sqlite: source,
      uploadDirectory: sourceUploads,
      destination: corruptBundle,
    });
    await writeFile(
      path.join(corruptBundle, "images", "active.png"),
      Buffer.concat([png, Buffer.from([0xff])]),
    );
    await assertBundleRejected(corruptBundle, root, "INVALID_IMAGE");

    const traversalBundle = path.join(root, "traversal");
    const traversal = await exportNeumSnapshot({
      sqlite: source,
      uploadDirectory: sourceUploads,
      destination: traversalBundle,
    });
    const unsafe = structuredClone(traversal.manifest) as NeumSnapshotManifest;
    unsafe.entries[0].images[0].imagePath =
      "data/uploads/entries/../escape.png";
    unsafe.images[0].imagePath = "data/uploads/entries/../escape.png";
    await writeFile(
      path.join(traversalBundle, "manifest.json"),
      JSON.stringify(unsafe),
    );
    await assertBundleRejected(traversalBundle, root, "INVALID_MANIFEST");
  } finally {
    source.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("legacy version 1 snapshots import existing entries as root pages", () => {
  const manifest = {
    appId: "neum",
    schemaVersion: 1,
    exportedAt: created,
    folders: [
      { id: 1, parentId: null, name: "Inbox", createdAt: created, updatedAt: created },
    ],
    entries: [
      {
        id: 1,
        folderId: 1,
        kind: "knowledge",
        title: "Legacy page",
        notesMd: "",
        code: null,
        language: null,
        filename: null,
        version: 1,
        createdAt: created,
        updatedAt: updated,
        tagIds: [],
        images: [],
      },
    ],
    tags: [],
    trash: [],
    images: [],
  };

  const parsed = validateSnapshotManifest(manifest);
  assert.equal(parsed.schemaVersion, 2);
  assert.equal(parsed.entries[0].parentId, null);
});

test("import rejects non-pristine targets before writing files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "neum-snapshot-pristine-"));
  const source = new BetterSqlite3(path.join(root, "source.db"));
  const target = new BetterSqlite3(path.join(root, "target.db"));
  try {
    createSchema(source);
    createSchema(target);
    seedRichSource(source);
    await writeImages(path.join(root, "source-uploads"));
    await exportNeumSnapshot({
      sqlite: source,
      uploadDirectory: path.join(root, "source-uploads"),
      destination: path.join(root, "bundle"),
    });
    target
      .prepare('INSERT INTO "tag" ("name", "name_key") VALUES (?, ?)')
      .run("existing", identityKey("existing"));

    await assert.rejects(
      importNeumSnapshot({
        sqlite: target,
        uploadDirectory: path.join(root, "target-uploads"),
        bundle: path.join(root, "bundle"),
        apply: true,
      }),
      (error: unknown) =>
        error instanceof SnapshotError && error.code === "TARGET_NOT_PRISTINE",
    );
    assert.equal(target.prepare('SELECT count(*) FROM "tag"').pluck().get(), 1);
    await assert.rejects(readdir(path.join(root, "target-uploads")), { code: "ENOENT" });

    target.prepare('DELETE FROM "tag"').run();
    assert.equal(target.prepare('SELECT count(*) FROM "tag"').pluck().get(), 0);
    await assert.rejects(
      importNeumSnapshot({
        sqlite: target,
        uploadDirectory: path.join(root, "target-uploads"),
        bundle: path.join(root, "bundle"),
      }),
      (error: unknown) =>
        error instanceof SnapshotError && error.code === "TARGET_NOT_PRISTINE",
    );
  } finally {
    source.close();
    target.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("late database failure rolls back rows and removes staged images", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "neum-snapshot-rollback-"));
  const source = new BetterSqlite3(path.join(root, "source.db"));
  const target = new BetterSqlite3(path.join(root, "target.db"));
  const targetUploads = path.join(root, "target-uploads");
  try {
    createSchema(source);
    createSchema(target);
    seedRichSource(source);
    await writeImages(path.join(root, "source-uploads"));
    await exportNeumSnapshot({
      sqlite: source,
      uploadDirectory: path.join(root, "source-uploads"),
      destination: path.join(root, "bundle"),
    });
    target.exec(`CREATE TRIGGER fail_snapshot_link
      BEFORE INSERT ON entry_link
      BEGIN SELECT RAISE(ABORT, 'late failure'); END`);

    await assert.rejects(
      importNeumSnapshot({
        sqlite: target,
        uploadDirectory: targetUploads,
        bundle: path.join(root, "bundle"),
        apply: true,
      }),
      /late failure/,
    );
    assert.deepEqual(
      target.prepare('SELECT "id", "name" FROM "folder"').all(),
      [{ id: 1, name: "Inbox" }],
    );
    for (const table of [
      "entry",
      "entry_link",
      "tag",
      "entry_tag",
      "entry_image",
      "trash_entry",
    ]) {
      assert.equal(
        target.prepare(`SELECT count(*) FROM "${table}"`).pluck().get(),
        0,
      );
    }
    await assert.rejects(readdir(targetUploads), { code: "ENOENT" });
  } finally {
    source.close();
    target.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI parsing keeps import dry-run by default and requires explicit destinations", () => {
  assert.equal(parseImportSnapshotArguments(["bundle"]).apply, false);
  assert.equal(parseImportSnapshotArguments(["bundle", "--apply"]).apply, true);
  assert.match(parseExportSnapshotArguments(["output"]).destination, /output$/);
  assert.throws(() => parseExportSnapshotArguments([]), {
    code: "INVALID_ARGUMENT",
  });
});

test("schema readiness rejects a weakened identity index", () => {
  const sqlite = new BetterSqlite3(":memory:");
  try {
    createSchema(sqlite);
    assert.doesNotThrow(() => assertCurrentNeumSchema(sqlite));
    sqlite.exec("DROP INDEX tag_name_unique; CREATE INDEX tag_name_unique ON tag(name_key)");
    assert.throws(
      () => assertCurrentNeumSchema(sqlite),
      /wrong uniqueness/i,
    );
    sqlite.exec(`
      DROP INDEX tag_name_unique;
      CREATE UNIQUE INDEX tag_name_unique ON tag(name_key);
      DROP INDEX folder_root_name_unique;
      CREATE UNIQUE INDEX folder_root_name_unique
        ON folder(name_key)
        WHERE parent_id IS NOT NULL;
    `);
    assert.throws(
      () => assertCurrentNeumSchema(sqlite),
      /wrong predicate/i,
    );
  } finally {
    sqlite.close();
  }
});

async function assertBundleRejected(
  bundle: string,
  root: string,
  code: string,
): Promise<void> {
  const target = new BetterSqlite3(path.join(root, `${path.basename(bundle)}-target.db`));
  try {
    createSchema(target);
    await assert.rejects(
      importNeumSnapshot({
        sqlite: target,
        uploadDirectory: path.join(root, `${path.basename(bundle)}-uploads`),
        bundle,
      }),
      (error: unknown) => error instanceof SnapshotError && error.code === code,
    );
  } finally {
    target.close();
  }
}

async function writeImages(uploadDirectory: string): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(uploadDirectory, { recursive: true });
  await writeFile(path.join(uploadDirectory, "active.png"), png);
  await writeFile(path.join(uploadDirectory, "deleted.gif"), gif);
}

function createSchema(sqlite: BetterSqlite3.Database): void {
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(`
    CREATE TABLE folder (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_id INTEGER REFERENCES folder(id) ON DELETE RESTRICT,
      name TEXT NOT NULL,
      name_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CONSTRAINT folder_name_not_blank CHECK(length(trim(name)) > 0)
    );
    CREATE INDEX folder_parent_idx ON folder(parent_id);
    CREATE UNIQUE INDEX folder_root_name_unique ON folder(name_key) WHERE parent_id IS NULL;
    CREATE UNIQUE INDEX folder_sibling_name_unique ON folder(parent_id, name_key) WHERE parent_id IS NOT NULL;
    CREATE TABLE entry (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_id INTEGER REFERENCES entry(id) ON DELETE RESTRICT,
      folder_id INTEGER NOT NULL REFERENCES folder(id) ON DELETE RESTRICT,
      kind TEXT NOT NULL CHECK(kind IN ('knowledge', 'snippet')),
      title TEXT NOT NULL,
      notes_md TEXT NOT NULL,
      code TEXT,
      language TEXT,
      filename TEXT,
      version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CONSTRAINT entry_title_not_blank CHECK(length(trim(title)) > 0),
      CONSTRAINT entry_version_positive CHECK(version > 0),
      CONSTRAINT entry_kind_fields_valid CHECK(
        (kind = 'knowledge' AND code IS NULL AND language IS NULL AND filename IS NULL)
        OR
        (kind = 'snippet' AND code IS NOT NULL AND language IS NOT NULL AND length(trim(language)) > 0)
      )
    );
    CREATE INDEX entry_parent_idx ON entry(parent_id);
    CREATE INDEX entry_folder_idx ON entry(folder_id);
    CREATE INDEX entry_kind_idx ON entry(kind);
    CREATE INDEX entry_title_idx ON entry(title);
    CREATE INDEX entry_updated_idx ON entry(updated_at, id);
    CREATE TABLE entry_link (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_entry_id INTEGER NOT NULL REFERENCES entry(id) ON DELETE CASCADE,
      target_title_key TEXT NOT NULL,
      target_entry_id INTEGER REFERENCES entry(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE UNIQUE INDEX entry_link_source_title_unique
      ON entry_link(source_entry_id, target_title_key);
    CREATE INDEX entry_link_target_idx ON entry_link(target_entry_id);
    CREATE INDEX entry_link_title_key_idx ON entry_link(target_title_key);
    CREATE TABLE tag (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      name_key TEXT NOT NULL,
      CONSTRAINT tag_name_not_blank CHECK(length(trim(name)) > 0)
    );
    CREATE UNIQUE INDEX tag_name_unique ON tag(name_key);
    CREATE TABLE entry_tag (
      entry_id INTEGER NOT NULL REFERENCES entry(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
      PRIMARY KEY(entry_id, tag_id)
    );
    CREATE INDEX entry_tag_tag_idx ON entry_tag(tag_id);
    CREATE TABLE entry_image (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER NOT NULL REFERENCES entry(id) ON DELETE CASCADE,
      image_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      CONSTRAINT entry_image_path_not_blank CHECK(length(trim(image_path)) > 0)
    );
    CREATE INDEX entry_image_entry_idx ON entry_image(entry_id);
    CREATE UNIQUE INDEX entry_image_path_unique ON entry_image(image_path);
    CREATE TABLE trash_entry (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_entry_id INTEGER NOT NULL,
      folder_id INTEGER NOT NULL REFERENCES folder(id) ON DELETE RESTRICT,
      snapshot_json TEXT NOT NULL,
      deleted_at TEXT NOT NULL,
      CONSTRAINT trash_entry_snapshot_json_valid CHECK(json_valid(snapshot_json))
    );
    CREATE UNIQUE INDEX trash_entry_original_id_unique ON trash_entry(original_entry_id);
    CREATE INDEX trash_entry_folder_idx ON trash_entry(folder_id);
    CREATE INDEX trash_entry_deleted_idx ON trash_entry(deleted_at, id);
    CREATE TABLE __drizzle_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT NOT NULL,
      created_at numeric
    );
    INSERT INTO __drizzle_migrations (hash, created_at)
      VALUES ('test-migration', ${NEUM_SCHEMA_MIGRATION_TIMESTAMP});
    INSERT INTO folder (id, parent_id, name, name_key, created_at, updated_at)
      VALUES (1, NULL, 'Inbox', 'inbox', '${created}', '${created}');
  `);
}

function seedRichSource(sqlite: BetterSqlite3.Database): void {
  sqlite.exec('DELETE FROM "folder"');
  const insertFolder = sqlite.prepare(
    'INSERT INTO "folder" ("id", "parent_id", "name", "name_key", "created_at", "updated_at") VALUES (?, ?, ?, ?, ?, ?)',
  );
  insertFolder.run(
    7,
    null,
    "Computer Science",
    identityKey("Computer Science"),
    created,
    updated,
  );
  insertFolder.run(
    8,
    7,
    "Configuration",
    identityKey("Configuration"),
    created,
    updated,
  );
  const insertTag = sqlite.prepare(
    'INSERT INTO "tag" ("id", "name", "name_key") VALUES (?, ?, ?)',
  );
  insertTag.run(5, "Älgorithms", identityKey("Älgorithms"));
  insertTag.run(6, "YAML", identityKey("YAML"));
  const insertEntry = sqlite.prepare(
    'INSERT INTO "entry" ("id", "parent_id", "folder_id", "kind", "title", "notes_md", "code", "language", "filename", "version", "created_at", "updated_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  insertEntry.run(
    11,
    null,
    7,
    "knowledge",
    "Schedulers",
    "![diagram](/api/uploads/entries/active.png)\n\nKeep Unicode: 排程。",
    null,
    null,
    null,
    3,
    created,
    updated,
  );
  insertEntry.run(
    12,
    11,
    7,
    "snippet",
    "Broken YAML is still useful",
    "A deliberately unfinished sample.",
    "root: [still, editable",
    "yaml",
    "config.yaml",
    1,
    created,
    updated,
  );
  sqlite
    .prepare('UPDATE "entry" SET "notes_md" = "notes_md" || ? WHERE "id" = 11')
    .run("\n\n[[Broken YAML is still useful]] [[Missing restored target]]");
  sqlite.prepare('INSERT INTO "entry_tag" VALUES (?, ?)').run(11, 5);
  sqlite.prepare('INSERT INTO "entry_tag" VALUES (?, ?)').run(12, 6);
  sqlite
    .prepare('INSERT INTO "entry_image" VALUES (?, ?, ?, ?)')
    .run(13, 11, activeImagePath, created);
  const trashSnapshot = {
    entry: {
      id: 99,
      parentId: 12,
      folderId: 7,
      kind: "snippet",
      title: "Deleted JSON",
      notesMd: "![old](/api/uploads/entries/deleted.gif)",
      code: '{"unfinished":',
      language: "json",
      filename: "sample.json",
      version: 4,
      createdAt: created,
      updatedAt: updated,
    },
    tags: ["JSON", "Archive"],
    imagePaths: [trashImagePath],
  };
  sqlite
    .prepare(
      'INSERT INTO "trash_entry" ("id", "original_entry_id", "folder_id", "snapshot_json", "deleted_at") VALUES (?, ?, ?, ?, ?)',
    )
    .run(21, 99, 7, JSON.stringify(trashSnapshot), deleted);
}
