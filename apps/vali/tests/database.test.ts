import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { openDatabase } from "../src/lib/db/client";
import { createValiVault } from "../src/lib/vali/module";

test("every SQLite connection enforces foreign keys and waits for short write contention", () => {
  const database = openDatabase(":memory:");

  try {
    assert.equal(database.pragma("foreign_keys", { simple: true }), 1);
    assert.equal(database.pragma("busy_timeout", { simple: true }), 5_000);
  } finally {
    database.close();
  }
});

test("file-backed SQLite uses WAL with full commit durability", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "vali-durability-"));
  const database = openDatabase(path.join(root, "sqlite.db"));

  try {
    assert.equal(database.pragma("journal_mode", { simple: true }), "wal");
    assert.equal(database.pragma("synchronous", { simple: true }), 2);
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("the vault configuration table enforces its singleton row", () => {
  const database = openDatabase(":memory:");

  try {
    createValiVault(database);
    assert.throws(() =>
      database
        .prepare(
          `INSERT INTO vault_config
             (id, name, schema_version, created_at, default_category_id)
           VALUES (2, 'Other', 1, '2026-07-11T00:00:00Z', 'cat_watchlist')`,
        )
        .run(),
    );
  } finally {
    database.close();
  }
});
