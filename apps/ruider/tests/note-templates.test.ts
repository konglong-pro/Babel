import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import type * as TemplateCollectionRoute from "@/app/api/templates/route";
import type * as TemplateItemRoute from "@/app/api/templates/[id]/route";
import type * as DatabaseModule from "@/lib/db/client";
import type * as RepositoryModule from "@/lib/repositories";

let root = "";
let database: typeof DatabaseModule;
let repositories: typeof RepositoryModule;
let collection: typeof TemplateCollectionRoute;
let item: typeof TemplateItemRoute;

before(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "ruider-templates-test-"));
  process.env.RUIDER_DATABASE_PATH = path.join(root, "sqlite.db");
  process.env.RUIDER_UPLOAD_DIRECTORY = path.join(root, "uploads");
  database = await import("@/lib/db/client");
  migrate(database.db, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  [repositories, collection, item] = await Promise.all([
    import("@/lib/repositories"),
    import("@/app/api/templates/route"),
    import("@/app/api/templates/[id]/route"),
  ]);
});

after(async () => {
  database.sqlite.close();
  await rm(root, { recursive: true, force: true });
});

test("Ruider note templates do not affect canvases or existing notes", async () => {
  const canvas = repositories.createCanvas("Untouched canvas");
  const originalScene = repositories.getCanvas(canvas.id)?.scene;
  const contentMd = "# Research\n\n## Signals\n\n- Observation";
  const createdResponse = await collection.POST(jsonRequest("POST", {
    name: "Research Note",
    contentMd,
  }));
  assert.equal(createdResponse.status, 201);
  const created = (await createdResponse.json()) as { id: number; contentMd: string };
  assert.equal(created.contentMd, contentMd);

  const duplicate = await collection.POST(jsonRequest("POST", {
    name: "research note",
    contentMd: "",
  }));
  assert.equal(duplicate.status, 409);
  assert.throws(() => database.sqlite.prepare(
    "INSERT INTO note_template (name, content_md) VALUES (?, ?)",
  ).run("RESEARCH NOTE", ""));

  const tooLong = await collection.POST(jsonRequest("POST", {
    name: "x".repeat(121),
    contentMd: "",
  }));
  assert.equal(tooLong.status, 400);

  for (const forbidden of [
    "![Pending](ruider-upload://note-image)",
    "![Owned](/api/uploads/notes/owned.png)",
  ]) {
    const response = await collection.POST(jsonRequest("POST", {
      name: `Forbidden ${forbidden.length}`,
      contentMd: forbidden,
    }));
    assert.equal(response.status, 400);
  }

  const note = repositories.createNote({
    folderId: repositories.listFolders()[0].id,
    title: "Copied research",
    contentMd,
  });
  const updated = await item.PATCH(
    jsonRequest("PATCH", { name: "Revised Research", contentMd: "# Changed" }, created.id),
    routeContext(created.id),
  );
  assert.equal(updated.status, 200);
  assert.equal(repositories.getNote(note.id)?.contentMd, contentMd);
  assert.deepEqual(repositories.getCanvas(canvas.id)?.scene, originalScene);

  const deleted = await item.DELETE(
    new Request(`http://localhost/api/templates/${created.id}`, { method: "DELETE" }),
    routeContext(created.id),
  );
  assert.equal(deleted.status, 204);
  assert.equal(repositories.getNote(note.id)?.contentMd, contentMd);
  assert.deepEqual(repositories.getCanvas(canvas.id)?.scene, originalScene);
});

function jsonRequest(method: string, body: unknown, id?: number): Request {
  const suffix = id === undefined ? "" : `/${id}`;
  return new Request(`http://localhost/api/templates${suffix}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function routeContext(id: number): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id: String(id) }) };
}
