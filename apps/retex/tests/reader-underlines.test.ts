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

test("ReTex reader underlines cover Knowledge, Exercise sections, and saved Scratch", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "retex-underlines-"));
  process.env.RETEX_DATABASE_PATH = path.join(root, "sqlite.db");
  const database = await import("../src/lib/db/client");
  migrate(database.db, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  t.after(async () => { database.sqlite.close(); delete process.env.RETEX_DATABASE_PATH; await rm(root, { recursive: true, force: true }); });
  const [collection, item, notes] = await Promise.all([
    import("../src/app/api/reader-underlines/route"),
    import("../src/app/api/reader-underlines/[id]/route"),
    import("../src/app/api/reader-underlines/[id]/notes/route"),
  ]);
  const knowledgeFolder = Number(database.sqlite.prepare('INSERT INTO "folder" ("type", "name") VALUES (?, ?)').run("knowledge", "Notes").lastInsertRowid);
  const exerciseFolder = Number(database.sqlite.prepare('INSERT INTO "folder" ("type", "name") VALUES (?, ?)').run("exercise", "Problems").lastInsertRowid);
  const knowledgeId = Number(database.sqlite.prepare('INSERT INTO "knowledge_note" ("folder_id", "title", "content_md") VALUES (?, ?, ?)').run(knowledgeFolder, "Source", "read more").lastInsertRowid);
  const targetId = Number(database.sqlite.prepare('INSERT INTO "knowledge_note" ("folder_id", "title") VALUES (?, ?)').run(knowledgeFolder, "Related").lastInsertRowid);
  const exerciseId = Number(database.sqlite.prepare('INSERT INTO "exercise" ("folder_id", "title", "problem_md") VALUES (?, ?, ?)').run(exerciseFolder, "Exercise", "read more").lastInsertRowid);

  const missingScratch = await collection.POST(jsonRequest("http://localhost/api/reader-underlines", "POST", {
    sourceKind: "scratch", sourceId: exerciseId, fieldKey: "work", color: "yellow", anchor,
  }));
  assert.equal(missingScratch.status, 404);
  database.sqlite.prepare('INSERT INTO "scratch_solution" ("exercise_id", "content_md") VALUES (?, ?)').run(exerciseId, "read more");
  for (const [sourceKind, sourceId, fieldKey] of [
    ["knowledge", knowledgeId, "content"],
    ["exercise", exerciseId, "problem"],
    ["exercise", exerciseId, "answer"],
    ["exercise", exerciseId, "solution"],
    ["scratch", exerciseId, "work"],
  ] as const) {
    const response = await collection.POST(jsonRequest("http://localhost/api/reader-underlines", "POST", {
      sourceKind, sourceId, fieldKey, color: "orange", anchor,
    }));
    assert.equal(response.status, 201, `${sourceKind}/${fieldKey}`);
  }
  const scratchList = await collection.GET(new Request(`http://localhost/api/reader-underlines?sourceKind=scratch&sourceId=${exerciseId}`));
  const scratch = (await scratchList.json() as Array<{ id: number; fieldKey: string; noteIds: number[] }>)[0];
  assert.equal(scratch.fieldKey, "work");
  const attached = await notes.POST(jsonRequest(`http://localhost/api/reader-underlines/${scratch.id}/notes`, "POST", { noteId: targetId }), { params: Promise.resolve({ id: String(scratch.id) }) });
  assert.deepEqual((await attached.json() as { noteIds: number[] }).noteIds, [targetId]);
  const recolored = await item.PATCH(jsonRequest(`http://localhost/api/reader-underlines/${scratch.id}`, "PATCH", { color: "blue" }), { params: Promise.resolve({ id: String(scratch.id) }) });
  assert.equal((await recolored.json() as { color: string }).color, "blue");
  const invalidField = await collection.POST(jsonRequest("http://localhost/api/reader-underlines", "POST", {
    sourceKind: "exercise", sourceId: exerciseId, fieldKey: "work", color: "orange", anchor,
  }));
  assert.equal(invalidField.status, 400);
  database.sqlite.prepare('DELETE FROM "scratch_solution" WHERE "exercise_id" = ?').run(exerciseId);
  assert.equal(database.sqlite.prepare('SELECT count(*) FROM "reader_underline" WHERE "source_scratch_id" IS NOT NULL').pluck().get(), 0);
  database.sqlite.prepare('DELETE FROM "knowledge_note" WHERE "id" = ?').run(targetId);
  assert.equal(database.sqlite.prepare('SELECT count(*) FROM "reader_underline_note"').pluck().get(), 0);
});
