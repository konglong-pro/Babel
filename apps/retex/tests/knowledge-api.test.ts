import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";

let temporaryDirectory = "";
let database: typeof import("../src/lib/db/client");
let repositories: typeof import("../src/lib/repositories");
let collectionRoute: typeof import("../src/app/api/knowledge/route");
let itemRoute: typeof import("../src/app/api/knowledge/[id]/route");

before(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "retex-api-test-"));
  process.env.RETEX_DATABASE_PATH = path.join(temporaryDirectory, "sqlite.db");
  database = await import("../src/lib/db/client");
  migrate(database.db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  repositories = await import("../src/lib/repositories");
  collectionRoute = await import("../src/app/api/knowledge/route");
  itemRoute = await import("../src/app/api/knowledge/[id]/route");
});

after(() => {
  database.sqlite.close();
  const resolved = path.resolve(temporaryDirectory);
  const temporaryRoot = path.resolve(os.tmpdir());
  assert.ok(resolved.startsWith(`${temporaryRoot}${path.sep}retex-api-test-`));
  rmSync(resolved, { recursive: true, force: true });
});

function jsonRequest(url: string, method: string, body: unknown): Request {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("knowledge API accepts parent pages and rejects cycles and non-empty deletion", async () => {
  const folder = repositories.createFolder({ type: "knowledge", name: "API tree" });
  const parent = repositories.createKnowledge({ folderId: folder.id, title: "API parent" });

  const createResponse = await collectionRoute.POST(
    jsonRequest("http://localhost/api/knowledge", "POST", {
      folderId: folder.id,
      parentId: parent.id,
      title: "API child",
    }),
  );
  assert.equal(createResponse.status, 201);
  const child = (await createResponse.json()) as { id: number; parentId: number | null };
  assert.equal(child.parentId, parent.id);

  const cycleResponse = await itemRoute.PATCH(
    jsonRequest(`http://localhost/api/knowledge/${parent.id}`, "PATCH", {
      parentId: child.id,
    }),
    { params: Promise.resolve({ id: String(parent.id) }) },
  );
  assert.equal(cycleResponse.status, 409);

  const deleteResponse = await itemRoute.DELETE(
    new Request(`http://localhost/api/knowledge/${parent.id}`, { method: "DELETE" }),
    { params: Promise.resolve({ id: String(parent.id) }) },
  );
  assert.equal(deleteResponse.status, 409);
  assert.equal((await deleteResponse.json() as { error: { code: string } }).error.code, "NOT_EMPTY");
});
