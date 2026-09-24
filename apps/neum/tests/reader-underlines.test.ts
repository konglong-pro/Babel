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

test("Neum reader underlines persist on Entry notes and snippet code", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "neum-underlines-"));
  process.env.NEUM_DATABASE_PATH = path.join(root, "sqlite.db");
  const { getNeumDatabase } = await import("../src/lib/db/client");
  const database = getNeumDatabase();
  migrate(database.db, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  t.after(async () => { database.sqlite.close(); delete process.env.NEUM_DATABASE_PATH; await rm(root, { recursive: true, force: true }); });
  const [collection, item, notes] = await Promise.all([
    import("../src/app/api/reader-underlines/route"),
    import("../src/app/api/reader-underlines/[id]/route"),
    import("../src/app/api/reader-underlines/[id]/notes/route"),
  ]);
  const folder = database.sqlite.prepare('SELECT "id" FROM "folder" WHERE "name" = ?').get("Inbox") as { id: number };
  const knowledgeId = Number(database.sqlite.prepare('INSERT INTO "entry" ("folder_id", "kind", "title", "notes_md") VALUES (?, ?, ?, ?)').run(folder.id, "knowledge", "Source", "read more").lastInsertRowid);
  const snippetId = Number(database.sqlite.prepare('INSERT INTO "entry" ("folder_id", "kind", "title", "notes_md", "code", "language") VALUES (?, ?, ?, ?, ?, ?)').run(folder.id, "snippet", "Snippet", "read more", "read more", "text").lastInsertRowid);

  const noteUnderline = await collection.POST(jsonRequest("http://localhost/api/reader-underlines", "POST", {
    sourceKind: "entry", sourceId: knowledgeId, fieldKey: "notes", color: "green", anchor,
  }));
  assert.equal(noteUnderline.status, 201);
  const invalidCode = await collection.POST(jsonRequest("http://localhost/api/reader-underlines", "POST", {
    sourceKind: "entry", sourceId: knowledgeId, fieldKey: "code", color: "orange", anchor,
  }));
  assert.equal(invalidCode.status, 400);
  const codeUnderline = await collection.POST(jsonRequest("http://localhost/api/reader-underlines", "POST", {
    sourceKind: "entry", sourceId: snippetId, fieldKey: "code", color: "orange", anchor,
  }));
  assert.equal(codeUnderline.status, 201);
  const code = await codeUnderline.json() as { id: number; noteIds: number[] };
  const attached = await notes.POST(jsonRequest(`http://localhost/api/reader-underlines/${code.id}/notes`, "POST", { noteId: knowledgeId }), { params: Promise.resolve({ id: String(code.id) }) });
  assert.deepEqual((await attached.json() as { noteIds: number[] }).noteIds, [knowledgeId]);
  const loaded = await collection.GET(new Request(`http://localhost/api/reader-underlines?sourceKind=entry&sourceId=${snippetId}`));
  assert.deepEqual((await loaded.json() as Array<{ noteIds: number[] }>)[0].noteIds, [knowledgeId]);
  const changed = await item.PATCH(jsonRequest(`http://localhost/api/reader-underlines/${code.id}`, "PATCH", { color: "pink" }), { params: Promise.resolve({ id: String(code.id) }) });
  assert.equal((await changed.json() as { color: string }).color, "pink");
  database.sqlite.prepare('DELETE FROM "entry" WHERE "id" = ?').run(knowledgeId);
  assert.equal(database.sqlite.prepare('SELECT count(*) FROM "reader_underline_note"').pluck().get(), 0);
  database.sqlite.prepare('DELETE FROM "entry" WHERE "id" = ?').run(snippetId);
  assert.equal(database.sqlite.prepare('SELECT count(*) FROM "reader_underline"').pluck().get(), 0);
});
