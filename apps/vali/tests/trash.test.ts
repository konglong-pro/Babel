import assert from "node:assert/strict";
import test from "node:test";

import { openDatabase } from "../src/lib/db/client";
import { NotFoundError } from "../src/lib/vali/errors";
import { createValiVault } from "../src/lib/vali/module";

test("deleting an entry stores its complete latest snapshot and removes active data", () => {
  const database = openDatabase(":memory:");

  try {
    const vault = createValiVault(database);
    const created = vault.entries.create({
      title: "台積電",
      aliases: ["TSM", "2330"],
      categoryId: "cat_watchlist",
      content: "# Thesis\n\nKeep exact Markdown.\n\n",
    });
    const updated = vault.entries.update(created.id, {
      order: 9,
      aliases: ["TSM", "台積電"],
    });

    vault.entries.delete(updated.id);

    assert.throws(() => vault.entries.get(updated.id), NotFoundError);
    const trashed = database
      .prepare(
        `SELECT deleted_at AS deletedAt, original_entry_id AS originalEntryId,
                snapshot_json AS snapshotJson
         FROM trash_entry`,
      )
      .get() as { deletedAt: string; originalEntryId: string; snapshotJson: string };
    assert.match(trashed.deletedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.equal(trashed.originalEntryId, updated.id);
    assert.deepEqual(JSON.parse(trashed.snapshotJson), updated);
    assert.equal(
      database.prepare("SELECT count(*) FROM entry_alias").pluck().get(),
      0,
    );
  } finally {
    database.close();
  }
});

test("entry deletion rolls back the trash snapshot when active deletion fails", () => {
  const database = openDatabase(":memory:");

  try {
    const vault = createValiVault(database);
    const created = vault.entries.create({ title: "Apple", categoryId: "cat_watchlist" });
    database.exec(
      `CREATE TRIGGER reject_entry_delete BEFORE DELETE ON entry
       BEGIN SELECT RAISE(ABORT, 'forced delete failure'); END`,
    );

    assert.throws(() => vault.entries.delete(created.id), /forced delete failure/);
    assert.deepEqual(vault.entries.get(created.id), created);
    assert.equal(database.prepare("SELECT count(*) FROM trash_entry").pluck().get(), 0);
  } finally {
    database.close();
  }
});

test("deleting a missing entry returns a 404 domain error", () => {
  const database = openDatabase(":memory:");

  try {
    const vault = createValiVault(database);

    assert.throws(
      () => vault.entries.delete("ent_missing"),
      (error) => {
        assert.ok(error instanceof NotFoundError);
        assert.equal(error.statusCode, 404);
        assert.equal(error.message, "Entry not found: ent_missing");
        return true;
      },
    );
  } finally {
    database.close();
  }
});
