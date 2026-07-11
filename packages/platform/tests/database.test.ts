import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import BetterSqlite3 from "better-sqlite3";

import { checkpointDatabase } from "../src/db/checkpoint";
import { createDatabase, resolveDatabasePath } from "../src/db/client";
import { runMigrations } from "../src/db/migrate";

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
