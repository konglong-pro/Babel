import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { assertAppDatabaseReady } from "@/lib/db/readiness";
import { GET as getHealth } from "@/app/api/health/route";

const latestMigration = 1_785_924_020_413;
const migrationsFolder = path.resolve(process.cwd(), "drizzle");

test("Neum database readiness", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "neum-readiness-"));
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
      /missing required column: entry\.parent_id/i,
    );
  });

  await t.test("rejects a migrated database without the link index", () => {
    const databasePath = path.join(root, "missing-link-index.db");
    const sqlite = new BetterSqlite3(databasePath);
    migrate(drizzle(sqlite), { migrationsFolder });
    sqlite.exec('DROP TABLE "entry_link"');
    sqlite.close();

    assert.throws(
      () => assertAppDatabaseReady(databasePath),
      /entry_link/i,
    );
  });

  await t.test("health rejects missing storage without creating a database", async () => {
    const originalPath = process.env.NEUM_DATABASE_PATH;
    const originalUploads = process.env.NEUM_UPLOAD_DIRECTORY;
    const missingPath = path.join(root, "missing.db");
    process.env.NEUM_DATABASE_PATH = missingPath;
    process.env.NEUM_UPLOAD_DIRECTORY = path.join(root, "uploads");
    await mkdir(process.env.NEUM_UPLOAD_DIRECTORY, { recursive: true });
    const originalConsoleError = console.error;
    console.error = () => undefined;
    try {
      assert.equal((await getHealth()).status, 503);
      assert.equal(existsSync(missingPath), false);

      process.env.NEUM_DATABASE_PATH = path.join(root, "current.db");
      assert.equal((await getHealth()).status, 200);
      const { getNeumDatabase } = await import("@/lib/db/client");
      getNeumDatabase().sqlite.close();
    } finally {
      console.error = originalConsoleError;
      if (originalPath === undefined) delete process.env.NEUM_DATABASE_PATH;
      else process.env.NEUM_DATABASE_PATH = originalPath;
      if (originalUploads === undefined) delete process.env.NEUM_UPLOAD_DIRECTORY;
      else process.env.NEUM_UPLOAD_DIRECTORY = originalUploads;
    }
  });
});

function createLatestLookingDatabase(databasePath: string): void {
  const sqlite = new BetterSqlite3(databasePath);
  try {
    sqlite.exec(`
      CREATE TABLE folder (id integer PRIMARY KEY, position integer NOT NULL);
      CREATE TABLE entry (id integer PRIMARY KEY);
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
