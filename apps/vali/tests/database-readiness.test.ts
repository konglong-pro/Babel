import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { assertAppDatabaseReady } from "@/lib/db/readiness";
import { GET as getHealth } from "@/app/api/health/route";

const latestMigration = 1_783_669_000_000;
const migrationsFolder = path.resolve(process.cwd(), "drizzle");

test("Vali database readiness", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vali-readiness-"));
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
      /missing required column: note\.parent_id/i,
    );
  });

  await t.test("rejects a latest-looking database without the link index", () => {
    const databasePath = path.join(root, "missing-note-link.db");
    createLatestLookingDatabase(databasePath, true);

    assert.throws(
      () => assertAppDatabaseReady(databasePath),
      /missing required column: note_link\.source_note_id/i,
    );
  });

  await t.test("health reports current and incompatible schemas", async () => {
    const originalPath = process.env.VALI_DATABASE_PATH;
    process.env.VALI_DATABASE_PATH = path.join(root, "current.db");
    assert.equal((await getHealth()).status, 200);
    const openedDatabase = await import("@/lib/db/client");

    process.env.VALI_DATABASE_PATH = path.join(root, "missing-parent.db");
    const originalConsoleError = console.error;
    console.error = () => undefined;
    try {
      assert.equal((await getHealth()).status, 503);
      const missingPath = path.join(root, "missing.db");
      process.env.VALI_DATABASE_PATH = missingPath;
      assert.equal((await getHealth()).status, 503);
      assert.equal(existsSync(missingPath), false);
    } finally {
      openedDatabase.sqlite.close();
      console.error = originalConsoleError;
      if (originalPath === undefined) delete process.env.VALI_DATABASE_PATH;
      else process.env.VALI_DATABASE_PATH = originalPath;
    }
  });
});

function createLatestLookingDatabase(
  databasePath: string,
  includeParentId = false,
): void {
  const sqlite = new BetterSqlite3(databasePath);
  try {
    sqlite.exec(`
      CREATE TABLE note (
        id integer PRIMARY KEY
        ${includeParentId ? ", parent_id integer" : ""}
      );
      ${includeParentId ? "CREATE TABLE reflection (date text PRIMARY KEY, content_md text);" : ""}
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
