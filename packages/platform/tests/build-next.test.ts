import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import BetterSqlite3 from "better-sqlite3";

import {
  initializeIsolatedBuildDatabases,
  removeNextTypeScriptBuildCache,
  resolveIsolatedEnvironmentPaths,
} from "../src/build/next";

test("isolated Next build paths share one temporary root", () => {
  const root = path.resolve("temporary-build-root");
  assert.deepEqual(
    resolveIsolatedEnvironmentPaths(root, {
      APP_DATABASE_PATH: ["sqlite.db"],
      APP_UPLOAD_DIRECTORY: ["uploads", "notes"],
    }),
    {
      APP_DATABASE_PATH: path.join(root, "sqlite.db"),
      APP_UPLOAD_DIRECTORY: path.join(root, "uploads", "notes"),
    },
  );
});

test("isolated Next build paths reject empty and escaping paths", () => {
  assert.throws(
    () => resolveIsolatedEnvironmentPaths("temporary-build-root", {
      APP_DATABASE_PATH: [],
    }),
    /require a name and path/i,
  );
  assert.throws(
    () => resolveIsolatedEnvironmentPaths("temporary-build-root", {
      APP_DATABASE_PATH: ["..", "sqlite.db"],
    }),
    /escapes its temporary root/i,
  );
});

test("isolated Next builds initialize disposable databases in WAL mode", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "babel-platform-build-"));
  const databasePath = path.join(root, "nested", "sqlite.db");
  const uploadPath = path.join(root, "uploads");

  try {
    initializeIsolatedBuildDatabases({
      APP_DATABASE_PATH: databasePath,
      APP_UPLOAD_DIRECTORY: uploadPath,
    });

    const first = new BetterSqlite3(databasePath);
    const second = new BetterSqlite3(databasePath);
    try {
      assert.equal(first.pragma("journal_mode", { simple: true }), "wal");
      assert.equal(second.pragma("journal_mode = WAL", { simple: true }), "wal");
    } finally {
      second.close();
      first.close();
    }

    assert.equal(existsSync(uploadPath), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("isolated Next builds discard a stale TypeScript build cache", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "babel-platform-build-"));
  const cacheDirectory = path.join(root, ".next", "cache");
  const cachePath = path.join(cacheDirectory, ".tsbuildinfo");

  try {
    await mkdir(cacheDirectory, { recursive: true });
    await writeFile(cachePath, "stale cache", "utf8");

    removeNextTypeScriptBuildCache(root);

    assert.equal(existsSync(cachePath), false);
    assert.equal(existsSync(cacheDirectory), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
