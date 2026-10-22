import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const anchor = { start: 0, end: 4, exact: "read", prefix: "", suffix: " more" };
function jsonRequest(url: string, method: string, body: unknown): Request {
  return new Request(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

test("Vali reader underlines persist on notes and reflections with independent note links", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vali-underlines-"));
  process.env.VALI_DATABASE_PATH = path.join(root, "sqlite.db");
  const database = await import("../src/lib/db/client");
  migrate(database.db, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  t.after(async () => { database.sqlite.close(); delete process.env.VALI_DATABASE_PATH; await rm(root, { recursive: true, force: true }); });
  const [collection, item, notes, note] = await Promise.all([
    import("../src/app/api/reader-underlines/route"),
    import("../src/app/api/reader-underlines/[id]/route"),
    import("../src/app/api/reader-underlines/[id]/notes/route"),
    import("../src/app/api/reader-underlines/[id]/notes/[noteId]/route"),
  ]);
  const folderId = Number(database.sqlite.prepare('INSERT INTO "folder" ("name") VALUES (?)').run("Readings").lastInsertRowid);
  database.sqlite.prepare('INSERT INTO "note" ("id", "folder_id", "title", "content_md") VALUES (1, ?, ?, ?), (2, ?, ?, ?)').run(folderId, "Source", "read more", folderId, "Related", "notes");
  database.sqlite.prepare('INSERT INTO "reflection" ("date", "content_md") VALUES (?, ?)').run("2026-09-23", "read more");

  const created = await collection.POST(jsonRequest("http://localhost/api/reader-underlines", "POST", {
    sourceKind: "note", sourceId: 1, fieldKey: "content", color: "orange", anchor,
  }));
  assert.equal(created.status, 201);
  const underline = await created.json() as { id: number; noteIds: number[]; color: string };
  assert.deepEqual(underline.noteIds, []);
  const attached = await notes.POST(jsonRequest(`http://localhost/api/reader-underlines/${underline.id}/notes`, "POST", { noteId: 2 }), { params: Promise.resolve({ id: String(underline.id) }) });
  assert.equal(attached.status, 200);
  assert.deepEqual((await attached.json() as { noteIds: number[] }).noteIds, [2]);
  const loaded = await collection.GET(new Request("http://localhost/api/reader-underlines?sourceKind=note&sourceId=1"));
  assert.equal(loaded.status, 200);
  assert.deepEqual((await loaded.json() as Array<{ noteIds: number[] }>)[0].noteIds, [2]);
  const recolored = await item.PATCH(jsonRequest(`http://localhost/api/reader-underlines/${underline.id}`, "PATCH", { color: "blue" }), { params: Promise.resolve({ id: String(underline.id) }) });
  assert.equal((await recolored.json() as { color: string }).color, "blue");
  const detached = await note.DELETE(new Request(`http://localhost/api/reader-underlines/${underline.id}/notes/2`, { method: "DELETE" }), { params: Promise.resolve({ id: String(underline.id), noteId: "2" }) });
  assert.deepEqual((await detached.json() as { noteIds: number[] }).noteIds, []);

  const reflection = await collection.POST(jsonRequest("http://localhost/api/reader-underlines", "POST", {
    sourceKind: "reflection", sourceId: "2026-09-23", fieldKey: "content", color: "pink", anchor,
  }));
  assert.equal(reflection.status, 201);
  const invalid = await collection.POST(jsonRequest("http://localhost/api/reader-underlines", "POST", {
    sourceKind: "reflection", sourceId: "2026-09-24", fieldKey: "content", color: "pink", anchor,
  }));
  assert.equal(invalid.status, 404);
  database.sqlite.prepare('DELETE FROM "reflection" WHERE "date" = ?').run("2026-09-23");
  assert.equal(database.sqlite.prepare('SELECT count(*) FROM "reader_underline" WHERE "source_reflection_date" = ?').pluck().get("2026-09-23"), 0);
});
