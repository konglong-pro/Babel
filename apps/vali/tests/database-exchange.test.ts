import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { openDatabase } from "../src/lib/db/client";
import {
  isDatabaseEmpty,
  readDatabaseSnapshot,
  restoreSnapshot,
} from "../src/lib/exchange/database";
import type { VaultSnapshot } from "../src/lib/exchange/types";
import { ValidationError } from "../src/lib/vali/errors";

test("a complete snapshot round-trips through SQLite without semantic loss", () => {
  const database = openDatabase(":memory:");
  const snapshot = syntheticSnapshot();

  try {
    assert.equal(isDatabaseEmpty(database), true);

    restoreSnapshot(database, snapshot);

    assert.equal(isDatabaseEmpty(database), false);
    assert.deepEqual(readDatabaseSnapshot(database), snapshot);
  } finally {
    database.close();
  }
});

test("a database snapshot does not mix a concurrent entry update with older rows", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vali-snapshot-consistency-"));
  const databasePath = path.join(root, "sqlite.db");
  const reader = openDatabase(databasePath);
  let writer: ReturnType<typeof openDatabase> | undefined;

  try {
    const expected = syntheticSnapshot();
    restoreSnapshot(reader, expected);
    writer = openDatabase(databasePath);

    reader.exec('ALTER TABLE "entry" RENAME TO "entry_source"');
    let updateInjected = false;
    reader.function("inject_concurrent_entry_update", () => {
      if (!updateInjected) {
        updateInjected = true;
        writer
          ?.transaction(() => {
            writer
              ?.prepare('UPDATE "entry_source" SET "updated_at" = ? WHERE "id" = ?')
              .run("2026-07-12T00:00:00Z", "ent_unicode");
            writer
              ?.prepare(
                'UPDATE "entry_alias" SET "alias" = ? WHERE "entry_id" = ? AND "position" = 0',
              )
              .run("CHANGED", "ent_unicode");
          })
          .immediate();
      }
      return "";
    });
    reader.exec(`CREATE VIEW "entry" AS
      SELECT "id", "category_id",
             "title" || inject_concurrent_entry_update() AS "title",
             "order", "content", "created_at", "updated_at"
      FROM "entry_source"`);

    const snapshot = readDatabaseSnapshot(reader);

    assert.equal(updateInjected, true);
    assert.deepEqual(snapshot, expected);
    assert.equal(
      writer
        .prepare(
          'SELECT "alias" FROM "entry_alias" WHERE "entry_id" = ? AND "position" = 0',
        )
        .pluck()
        .get("ent_unicode"),
      "CHANGED",
    );
  } finally {
    writer?.close();
    reader.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("restore rejects a nonempty target before writing snapshot rows", () => {
  const database = openDatabase(":memory:");

  try {
    database
      .prepare("INSERT INTO reflection (date, content) VALUES (?, ?)")
      .run("2026-07-09", "existing");

    assert.throws(
      () => restoreSnapshot(database, syntheticSnapshot()),
      (error) => {
        assert.ok(error instanceof ValidationError);
        assert.equal(error.statusCode, 400);
        assert.equal(error.message, "Target database is not empty");
        return true;
      },
    );
    assert.equal(database.prepare("SELECT count(*) FROM reflection").pluck().get(), 1);
    assert.equal(database.prepare("SELECT count(*) FROM category").pluck().get(), 0);
    assert.equal(database.prepare("SELECT count(*) FROM vault_config").pluck().get(), 0);
  } finally {
    database.close();
  }
});

test("a late restore failure rolls back every inserted domain row", () => {
  const database = openDatabase(":memory:");
  const snapshot = structuredClone(syntheticSnapshot());
  snapshot.trash[1].sourceName = snapshot.trash[0].sourceName;

  try {
    assert.throws(() => restoreSnapshot(database, snapshot));

    assert.equal(isDatabaseEmpty(database), true);
  } finally {
    database.close();
  }
});

function syntheticSnapshot(): VaultSnapshot {
  return {
    config: {
      name: "Vali 測試",
      version: 1,
      createdAt: "2026-06-30T10:00:00Z",
      defaultCategoryId: "cat_watchlist",
    },
    categories: [
      {
        id: "cat_watchlist",
        name: "觀察清單",
        order: 1,
        content: "# 觀察\n\n保留尾端換行。\n\n",
        createdAt: "2026-06-30T10:00:00Z",
        updatedAt: "2026-07-01T11:00:00Z",
      },
      {
        id: "cat_owned",
        name: "Owned",
        order: 2,
        content: "",
        createdAt: "2026-06-30T10:00:00Z",
        updatedAt: "2026-06-30T10:00:00Z",
      },
    ],
    entries: [
      {
        id: "ent_unicode",
        title: "台積電",
        aliases: ["TSM", "2330"],
        categoryId: "cat_watchlist",
        order: 3,
        content: "# 投資論點\n\n精確保存 Markdown。\n\n",
        createdAt: "2026-07-01T01:02:03Z",
        updatedAt: "2026-07-02T04:05:06Z",
      },
    ],
    reflections: [
      { date: "2026-07-11", content: "# 今天\n\n保留兩個尾端換行。\n\n" },
      { date: "2026-07-10", content: "Earlier\n" },
    ],
    trash: [
      {
        sourceName: "ent_old.md",
        originalEntryId: "ent_old",
        deletedAt: null,
        entry: {
          id: "ent_old",
          title: "舊條目",
          aliases: ["OLD"],
          categoryId: "cat_removed",
          order: 0,
          content: "First deleted snapshot.\n\n",
          createdAt: "2026-06-01T00:00:00Z",
          updatedAt: "2026-06-02T00:00:00Z",
        },
      },
      {
        sourceName: "ent_old_20260703040506.md",
        originalEntryId: "ent_old",
        deletedAt: "2026-07-03T04:05:06Z",
        entry: {
          id: "ent_old",
          title: "舊條目（第二次）",
          aliases: ["OLD", "再次刪除"],
          categoryId: "cat_removed",
          order: 9,
          content: "Second deleted snapshot.\n",
          createdAt: "2026-06-01T00:00:00Z",
          updatedAt: "2026-07-03T03:00:00Z",
        },
      },
    ],
  };
}
