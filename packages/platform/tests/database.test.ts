import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Worker } from "node:worker_threads";

import BetterSqlite3 from "better-sqlite3";

import { checkpointDatabase } from "../src/db/checkpoint";
import { createDatabase, resolveDatabasePath } from "../src/db/client";
import { runMigrations } from "../src/db/migrate";
import { assertLiveDatabaseMigrationsCurrent } from "../src/db/readiness";
import { assertDatabaseMigrationsCurrent } from "../src/db/readiness-snapshot";

test("database factory resolves paths, applies options, and isolates app caches", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "babel-platform-db-"));
  const envVar = "BABEL_PLATFORM_TEST_DATABASE_PATH";
  const secondEnvVar = "BABEL_PLATFORM_SECOND_TEST_DATABASE_PATH";
  const previousPath = process.env[envVar];
  const previousSecondPath = process.env[secondEnvVar];
  const databasePath = path.join(temporaryRoot, "nested", "sqlite.db");
  process.env[envVar] = databasePath;
  process.env[secondEnvVar] = databasePath;

  try {
    assert.equal(
      resolveDatabasePath({ envVar, defaultPath: path.join(temporaryRoot, "default.db") }),
      path.resolve(databasePath),
    );

    const first = createDatabase({
      envVar,
      defaultPath: path.join(temporaryRoot, "default.db"),
      schema: {},
      busyTimeoutMs: 5000,
    });
    const second = createDatabase({
      envVar,
      defaultPath: path.join(temporaryRoot, "other.db"),
      schema: {},
      busyTimeoutMs: 5000,
    });

    assert.equal(first.databasePath, path.resolve(databasePath));
    assert.equal(first.sqlite, second.sqlite);
    assert.equal(first.db, second.db);
    const isolated = createDatabase({
      envVar: secondEnvVar,
      defaultPath: path.join(temporaryRoot, "default.db"),
      schema: {},
    });
    assert.notEqual(first.sqlite, isolated.sqlite);
    assert.equal(first.sqlite.pragma("foreign_keys", { simple: true }), 1);
    assert.equal(first.sqlite.pragma("busy_timeout", { simple: true }), 5000);
    isolated.sqlite.close();
    first.sqlite.close();
  } finally {
    if (previousPath === undefined) {
      delete process.env[envVar];
    } else {
      process.env[envVar] = previousPath;
    }
    if (previousSecondPath === undefined) {
      delete process.env[secondEnvVar];
    } else {
      process.env[secondEnvVar] = previousSecondPath;
    }
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("migration and checkpoint helpers operate on explicit app parameters", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "babel-platform-scripts-"));
  const databasePath = path.join(temporaryRoot, "sqlite.db");
  const migrationsFolder = path.join(temporaryRoot, "drizzle");
  const metadataFolder = path.join(migrationsFolder, "meta");
  await mkdir(metadataFolder, { recursive: true });
  await writeFile(
    path.join(metadataFolder, "_journal.json"),
    JSON.stringify({
      version: "7",
      dialect: "sqlite",
      entries: [
        {
          idx: 0,
          version: "6",
          when: 1,
          tag: "0000_platform_test",
          breakpoints: true,
        },
      ],
    }),
  );
  await writeFile(
    path.join(migrationsFolder, "0000_platform_test.sql"),
    "CREATE TABLE platform_test (id integer PRIMARY KEY);",
  );

  const previousLog = console.log;
  console.log = () => undefined;
  try {
    const client = createDatabase({
      envVar: "BABEL_PLATFORM_UNUSED_DATABASE_PATH",
      defaultPath: databasePath,
      schema: {},
    });
    runMigrations({
      appName: "Platform Test",
      db: client.db,
      sqlite: client.sqlite,
      migrationsFolder,
    });

    const verification = new BetterSqlite3(databasePath, { fileMustExist: true });
    try {
      assert.deepEqual(
        verification
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
          .get("platform_test"),
        { name: "platform_test" },
      );
    } finally {
      verification.close();
    }

    checkpointDatabase({
      appName: "Platform Test",
      databasePath,
      fileMustExist: true,
    });

    const missingPath = path.join(temporaryRoot, "missing.db");
    assert.throws(
      () =>
        checkpointDatabase({
          appName: "Platform Test",
          databasePath: missingPath,
          fileMustExist: false,
        }),
      /Database does not exist/,
    );
    assert.equal(existsSync(missingPath), false);
  } finally {
    console.log = previousLog;
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("database readiness requires the exact code migration without writing", async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "babel-platform-readiness-"));
  const migrationsFolder = path.join(temporaryRoot, "drizzle");
  const metadataFolder = path.join(migrationsFolder, "meta");
  await mkdir(metadataFolder, { recursive: true });
  await writeFile(
    path.join(metadataFolder, "_journal.json"),
    JSON.stringify({
      version: "7",
      dialect: "sqlite",
      entries: [
        {
          idx: 0,
          version: "6",
          when: 100,
          tag: "0000_platform_readiness",
          breakpoints: true,
        },
        {
          idx: 1,
          version: "6",
          when: 200,
          tag: "0001_platform_readiness",
          breakpoints: true,
        },
      ],
    }),
  );
  await writeFile(
    path.join(migrationsFolder, "0000_platform_readiness.sql"),
    "CREATE TABLE note (id integer PRIMARY KEY, title text NOT NULL);",
  );
  await writeFile(
    path.join(migrationsFolder, "0001_platform_readiness.sql"),
    "ALTER TABLE note ADD parent_id text;",
  );

  const createFixture = (name: string, latestMigration?: number, includeParent = true) => {
    const databasePath = path.join(temporaryRoot, `${name}.db`);
    const sqlite = new BetterSqlite3(databasePath);
    try {
      sqlite.exec(
        `CREATE TABLE note (
          id integer PRIMARY KEY,
          title text NOT NULL${includeParent ? ", parent_id text" : ""}
        );`,
      );
      if (latestMigration !== undefined) {
        sqlite.exec(
          `CREATE TABLE __drizzle_migrations (
            id integer PRIMARY KEY AUTOINCREMENT,
            hash text NOT NULL,
            created_at numeric
          );`,
        );
        sqlite
          .prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)")
          .run("fixture", latestMigration);
      }
    } finally {
      sqlite.close();
    }
    return databasePath;
  };

  try {
    await context.test("accepts an exact migration and required columns", () => {
      const databasePath = createFixture("current", 200);
      assert.doesNotThrow(() =>
        assertDatabaseMigrationsCurrent({
          appName: "Platform Test",
          packageName: "@babel-apps/platform",
          databasePath,
          migrationsFolder,
          requiredColumns: { note: ["id", "parent_id"] },
        }),
      );
    });

    await context.test("live readiness stays consistent during WAL writes", async () => {
      const databasePath = createFixture("live-writer", 200);
      const writer = new Worker(
        `
          const { parentPort, workerData } = require("node:worker_threads");
          const Database = require("better-sqlite3");
          const database = new Database(workerData.databasePath);
          database.pragma("journal_mode = WAL");
          const write = database.prepare(
            "INSERT OR REPLACE INTO note (id, title, parent_id) VALUES (1, ?, NULL)",
          );
          const waiter = new Int32Array(new SharedArrayBuffer(4));
          parentPort.postMessage("ready");
          for (let index = 0; index < 200; index += 1) {
            write.run(String(index));
            Atomics.wait(waiter, 0, 0, 1);
          }
          database.close();
        `,
        { eval: true, workerData: { databasePath } },
      );
      await once(writer, "message");

      for (let index = 0; index < 500; index += 1) {
        assert.doesNotThrow(() =>
          assertLiveDatabaseMigrationsCurrent({
            appName: "Platform Test",
            packageName: "@babel-apps/platform",
            databasePath,
            expectedMigration: 200,
            requiredColumns: { note: ["id", "parent_id"] },
          }),
        );
      }

      const [exitCode] = await once(writer, "exit");
      assert.equal(exitCode, 0);
    });

    await context.test("rejects stale, ahead, and missing migration histories", async () => {
      const stalePath = createFixture("stale", 100);
      const walDatabase = new BetterSqlite3(stalePath);
      walDatabase.pragma("journal_mode = WAL");
      walDatabase.pragma("wal_checkpoint(TRUNCATE)");
      walDatabase.close();
      await rm(`${stalePath}-wal`, { force: true });
      await rm(`${stalePath}-shm`, { force: true });
      const staleBefore = await readFile(stalePath);
      const directoryBefore = await readdir(temporaryRoot);
      assert.throws(
        () =>
          assertDatabaseMigrationsCurrent({
            appName: "Platform Test",
            packageName: "@babel-apps/platform",
            databasePath: stalePath,
            migrationsFolder,
          }),
        /migration is stale[\s\S]*data:backup[\s\S]*db:migrate -w @babel-apps\/platform/i,
      );
      assert.deepEqual(await readFile(stalePath), staleBefore);
      assert.deepEqual(
        await readdir(temporaryRoot),
        directoryBefore,
        "a read-only readiness check must not create WAL sidecars",
      );

      const aheadPath = createFixture("ahead", 300);
      assert.throws(
        () =>
          assertDatabaseMigrationsCurrent({
            appName: "Platform Test",
            packageName: "@babel-apps/platform",
            databasePath: aheadPath,
            migrationsFolder,
          }),
        /migration is ahead of this code/i,
      );

      const missingHistoryPath = createFixture("missing-history");
      assert.throws(
        () =>
          assertDatabaseMigrationsCurrent({
            appName: "Platform Test",
            packageName: "@babel-apps/platform",
            databasePath: missingHistoryPath,
            migrationsFolder,
          }),
        /migration history is missing/i,
      );
    });

    await context.test("rejects missing required columns", () => {
      const databasePath = createFixture("missing-column", 200, false);
      assert.throws(
        () =>
          assertDatabaseMigrationsCurrent({
            appName: "Platform Test",
            packageName: "@babel-apps/platform",
            databasePath,
            migrationsFolder,
            requiredColumns: { note: ["id", "parent_id"] },
          }),
        /missing required column: note\.parent_id/i,
      );
    });

    await context.test("does not create a missing database", () => {
      const databasePath = path.join(temporaryRoot, "missing.db");
      assert.throws(
        () =>
          assertDatabaseMigrationsCurrent({
            appName: "Platform Test",
            packageName: "@babel-apps/platform",
            databasePath,
            migrationsFolder,
          }),
        /database does not exist/i,
      );
      assert.equal(existsSync(databasePath), false);
    });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
