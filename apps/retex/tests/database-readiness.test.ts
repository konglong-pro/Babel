import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { assertAppDatabaseReady } from "@/lib/db/readiness";
import { GET as getHealth } from "@/app/api/health/route";

const latestMigration = 1_786_724_113_803;
const migrationsFolder = path.resolve(process.cwd(), "drizzle");

test("folder position migration backfills each type and parent by legacy name order", () => {
  const sqlite = new BetterSqlite3(":memory:");
  try {
    sqlite.exec(`
      CREATE TABLE folder (
        id integer PRIMARY KEY,
        parent_id integer,
        type text NOT NULL,
        name text NOT NULL
      );
      INSERT INTO folder (id, parent_id, type, name) VALUES
        (1, NULL, 'knowledge', 'Zulu'),
        (2, NULL, 'knowledge', 'Alpha'),
        (3, 2, 'knowledge', 'Beta'),
        (4, 2, 'knowledge', 'Alpha'),
        (5, NULL, 'exercise', 'Beta'),
        (6, NULL, 'exercise', 'Alpha');
    `);
    sqlite.exec(
      readFileSync(
        path.join(migrationsFolder, "0006_third_blazing_skull.sql"),
        "utf8",
      ).replaceAll("--> statement-breakpoint", ""),
    );

    const rows = sqlite.prepare(
      "SELECT id, position FROM folder ORDER BY id",
    ).all();
    assert.deepEqual(rows, [
      { id: 1, position: 1 },
      { id: 2, position: 0 },
      { id: 3, position: 1 },
      { id: 4, position: 0 },
      { id: 5, position: 1 },
      { id: 6, position: 0 },
    ]);
  } finally {
    sqlite.close();
  }
});

test("content position migration preserves each legacy list order", () => {
  const sqlite = new BetterSqlite3(":memory:");
  try {
    sqlite.exec(`
      CREATE TABLE knowledge_note (
        id integer PRIMARY KEY,
        parent_id integer,
        folder_id integer NOT NULL,
        title text NOT NULL,
        updated_at text NOT NULL
      );
      CREATE TABLE exercise (
        id integer PRIMARY KEY,
        folder_id integer NOT NULL,
        title text NOT NULL,
        updated_at text NOT NULL
      );
      INSERT INTO knowledge_note VALUES
        (1, NULL, 10, 'Older root', '2026-01-01'),
        (2, NULL, 10, 'Newer root', '2026-01-02'),
        (3, 1, 10, 'Child B', '2026-01-03'),
        (4, 1, 10, 'Child A', '2026-01-03');
      INSERT INTO exercise VALUES
        (1, 20, 'Older exercise', '2026-01-01'),
        (2, 20, 'Newer exercise', '2026-01-02');
    `);
    sqlite.exec(
      readFileSync(path.join(migrationsFolder, "0007_needy_king_bedlam.sql"), "utf8")
        .replaceAll("--> statement-breakpoint", ""),
    );
    assert.deepEqual(
      sqlite.prepare("SELECT id, position FROM knowledge_note ORDER BY id").all(),
      [
        { id: 1, position: 1 },
        { id: 2, position: 0 },
        { id: 3, position: 1 },
        { id: 4, position: 0 },
      ],
    );
    assert.deepEqual(
      sqlite.prepare("SELECT id, position FROM exercise ORDER BY id").all(),
      [{ id: 1, position: 1 }, { id: 2, position: 0 }],
    );
  } finally {
    sqlite.close();
  }
});

test("ReTex database readiness", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "retex-readiness-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  await t.test("accepts the current migrated database", () => {
    const databasePath = path.join(root, "current.db");
    const sqlite = new BetterSqlite3(databasePath);
    migrate(drizzle(sqlite), { migrationsFolder });
    sqlite.close();

    assert.doesNotThrow(() => assertAppDatabaseReady(databasePath));
  });

  await t.test("rejects a latest-looking database without page hierarchy", () => {
    const databasePath = path.join(root, "missing-parent.db");
    createLatestLookingDatabase(databasePath);

    assert.throws(
      () => assertAppDatabaseReady(databasePath),
      /missing required column: knowledge_note\.parent_id/i,
    );
  });

  await t.test("rejects a latest-looking database without the link index", () => {
    const databasePath = path.join(root, "missing-note-link.db");
    createLatestLookingDatabase(databasePath, true);

    assert.throws(
      () => assertAppDatabaseReady(databasePath),
      /missing required column: note_link\.source_kind/i,
    );
  });

  await t.test("rejects a latest-looking database without note images", () => {
    const databasePath = path.join(root, "missing-note-image.db");
    createLatestLookingDatabase(databasePath, true, true);

    assert.throws(
      () => assertAppDatabaseReady(databasePath),
      /missing required column: note_image\.source_kind/i,
    );
  });

  await t.test("health reports current and incompatible schemas", async () => {
    const originalPath = process.env.RETEX_DATABASE_PATH;
    const originalUploads = process.env.RETEX_NOTE_UPLOAD_DIRECTORY;
    process.env.RETEX_DATABASE_PATH = path.join(root, "current.db");
    process.env.RETEX_NOTE_UPLOAD_DIRECTORY = path.join(root, "uploads", "notes");
    await mkdir(process.env.RETEX_NOTE_UPLOAD_DIRECTORY, { recursive: true });
    assert.equal((await getHealth()).status, 200);
    const { sqlite } = await import("@/lib/db/client");
    sqlite.close();

    process.env.RETEX_DATABASE_PATH = path.join(root, "missing-parent.db");
    const originalConsoleError = console.error;
    console.error = () => undefined;
    try {
      assert.equal((await getHealth()).status, 503);
      const missingPath = path.join(root, "missing.db");
      process.env.RETEX_DATABASE_PATH = missingPath;
      assert.equal((await getHealth()).status, 503);
      assert.equal(existsSync(missingPath), false);
    } finally {
      console.error = originalConsoleError;
      if (originalPath === undefined) delete process.env.RETEX_DATABASE_PATH;
      else process.env.RETEX_DATABASE_PATH = originalPath;
      if (originalUploads === undefined) delete process.env.RETEX_NOTE_UPLOAD_DIRECTORY;
      else process.env.RETEX_NOTE_UPLOAD_DIRECTORY = originalUploads;
    }
  });
});

function createLatestLookingDatabase(
  databasePath: string,
  includeParentId = false,
  includeNoteLink = false,
): void {
  const sqlite = new BetterSqlite3(databasePath);
  try {
    sqlite.exec(`
      CREATE TABLE knowledge_note (
        id integer PRIMARY KEY
        ${includeParentId ? ", parent_id integer, position integer" : ""}
      );
      ${includeNoteLink ? `
        CREATE TABLE note_link (
          id integer PRIMARY KEY,
          source_kind text,
          source_id integer,
          target_title_key text,
          target_kind text,
          target_id integer
        );
      ` : ""}
      CREATE TABLE canvas (
        id integer PRIMARY KEY,
        title text NOT NULL,
        scene text NOT NULL,
        created_at text NOT NULL,
        updated_at text NOT NULL
      );
      CREATE TABLE __drizzle_migrations (
        id integer PRIMARY KEY AUTOINCREMENT,
        hash text NOT NULL,
        created_at numeric
      );
    `);
    sqlite
      .prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)")
      .run("fixture", latestMigration);
  } finally {
    sqlite.close();
  }
}
