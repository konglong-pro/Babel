import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import type * as DatabaseModule from "@/lib/db/client";
import type * as CollectionRoute from "@/app/api/reader-underlines/route";
import type * as ItemRoute from "@/app/api/reader-underlines/[id]/route";
import type * as NotesRoute from "@/app/api/reader-underlines/[id]/notes/route";
import type * as NoteItemRoute from "@/app/api/reader-underlines/[id]/notes/[noteId]/route";

let root = "";
let database: typeof DatabaseModule;
let collection: typeof CollectionRoute;
let item: typeof ItemRoute;
let notes: typeof NotesRoute;
let noteItem: typeof NoteItemRoute;

before(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "__APP_ID__-underlines-"));
  process.env.__APP_ENV_PREFIX___DATABASE_PATH = path.join(root, "sqlite.db");
  database = await import("@/lib/db/client");
  migrate(database.db, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  [collection, item, notes, noteItem] = await Promise.all([
    import("@/app/api/reader-underlines/route"),
    import("@/app/api/reader-underlines/[id]/route"),
    import("@/app/api/reader-underlines/[id]/notes/route"),
    import("@/app/api/reader-underlines/[id]/notes/[noteId]/route"),
  ]);
});

after(async () => {
  database.sqlite.close();
  await rm(root, { recursive: true, force: true });
});

function createNote(title: string): number {
  const folder = database.sqlite.prepare("SELECT id FROM folder ORDER BY id LIMIT 1").get() as { id: number };
  const note = database.sqlite.prepare(
    "INSERT INTO note (folder_id, title, content_md) VALUES (?, ?, ?) RETURNING id",
  ).get(folder.id, title, "A selected passage and more text.") as { id: number };
  return note.id;
}

function jsonRequest(method: string, url: string, body: unknown): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", origin: "http://localhost" },
    body: JSON.stringify(body),
  });
}

test("reader underlines persist colors and formal note associations", async () => {
  const sourceId = createNote("Source");
  const targetId = createNote("Related note");
  const url = "http://localhost/api/reader-underlines";
  const anchor = { start: 2, end: 10, exact: "selected", prefix: "A ", suffix: " passage" };
  const createdResponse = await collection.POST(jsonRequest("POST", url, {
    sourceKind: "note", sourceId, fieldKey: "content", color: "yellow", anchor,
  }));
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json() as { id: number; color: string; anchor: typeof anchor; noteIds: number[] };
  assert.equal(created.color, "yellow");
  assert.deepEqual(created.anchor, anchor);
  assert.deepEqual(created.noteIds, []);

  const listUrl = `${url}?sourceKind=note&sourceId=${sourceId}`;
  const listed = await collection.GET(new Request(listUrl));
  assert.equal(listed.status, 200);
  assert.deepEqual(await listed.json(), [{ ...created, fieldKey: "content" }]);

  const context = { params: Promise.resolve({ id: String(created.id) }) };
  const recolored = await item.PATCH(jsonRequest("PATCH", `${url}/${created.id}`, { color: "orange" }), context);
  assert.equal(recolored.status, 200);
  assert.equal((await recolored.json() as { color: string }).color, "orange");

  const attached = await notes.POST(jsonRequest("POST", `${url}/${created.id}/notes`, { noteId: targetId }), context);
  assert.equal(attached.status, 200);
  assert.deepEqual((await attached.json() as { noteIds: number[] }).noteIds, [targetId]);
  const attachedAgain = await notes.POST(jsonRequest("POST", `${url}/${created.id}/notes`, { noteId: targetId }), context);
  assert.deepEqual((await attachedAgain.json() as { noteIds: number[] }).noteIds, [targetId]);

  const detached = await noteItem.DELETE(
    new Request(`${url}/${created.id}/notes/${targetId}`, { method: "DELETE" }),
    { params: Promise.resolve({ id: String(created.id), noteId: String(targetId) }) },
  );
  assert.equal(detached.status, 204);
  assert.deepEqual((await (await collection.GET(new Request(listUrl))).json() as Array<{ noteIds: number[] }>)[0].noteIds, []);
  await notes.POST(jsonRequest("POST", `${url}/${created.id}/notes`, { noteId: targetId }), context);

  const invalidColor = await item.PATCH(jsonRequest("PATCH", `${url}/${created.id}`, { color: "purple" }), context);
  assert.equal(invalidColor.status, 400);
  const missingNote = await notes.POST(jsonRequest("POST", `${url}/${created.id}/notes`, { noteId: 999_999 }), context);
  assert.equal(missingNote.status, 404);

  database.sqlite.prepare("DELETE FROM note WHERE id = ?").run(targetId);
  assert.deepEqual((await (await collection.GET(new Request(listUrl))).json() as Array<{ noteIds: number[] }>)[0].noteIds, []);

  database.sqlite.prepare("DELETE FROM note WHERE id = ?").run(sourceId);
  assert.equal(database.sqlite.prepare("SELECT count(*) FROM reader_underline").pluck().get(), 0);
});
