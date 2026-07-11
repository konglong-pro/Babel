import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { GET } from "../src/app/api/health/route";
import { openDatabase } from "../src/lib/db/client";
import { createValiVault } from "../src/lib/vali/module";

test("health rejects a missing database without creating it", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "vali-health-"));
  const databasePath = path.join(root, "missing", "sqlite.db");
  const previousDatabasePath = process.env.VALI_DATABASE_PATH;
  process.env.VALI_DATABASE_PATH = databasePath;

  try {
    const missingResponse = GET();
    assert.equal(missingResponse.status, 503);
    assert.deepEqual(await missingResponse.json(), {
      id: "vali",
      status: "error",
      schemaVersion: 1,
    });
    assert.equal(existsSync(databasePath), false);

    const database = openDatabase(databasePath);
    try {
      createValiVault(database);
    } finally {
      database.close();
    }

    const readyResponse = GET();
    assert.equal(readyResponse.status, 200);
    assert.deepEqual(await readyResponse.json(), {
      id: "vali",
      status: "ok",
      schemaVersion: 1,
    });
  } finally {
    if (previousDatabasePath === undefined) {
      delete process.env.VALI_DATABASE_PATH;
    } else {
      process.env.VALI_DATABASE_PATH = previousDatabasePath;
    }
    rmSync(root, { recursive: true, force: true });
  }
});
