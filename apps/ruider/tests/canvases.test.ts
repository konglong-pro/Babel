import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import {
  createEmptyCanvasScene,
  decodeCanvasScene,
  encodeCanvasScene,
  parseCanvasScene,
} from "@/lib/canvas-scene";

test("canvas scene validation accepts editable elements and rejects malformed data", () => {
  const scene = createEmptyCanvasScene();
  scene.elements.push(
    { id: "card_1", type: "card", x: 10, y: 20, width: 240, height: 140, text: "Seed" },
    { id: "line_1", type: "path", points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] },
    { id: "shape_1", type: "shape", shape: "ellipse", x: 5, y: 6, width: 80, height: 50 },
    { id: "arrow_1", type: "arrow", start: { x: 0, y: 0 }, end: { x: 20, y: 30 } },
  );

  assert.deepEqual(decodeCanvasScene(encodeCanvasScene(scene)), scene);
  assert.throws(
    () => parseCanvasScene({ ...scene, elements: [...scene.elements, scene.elements[0]] }),
    /ids must be unique/i,
  );
  assert.throws(
    () => parseCanvasScene({ ...scene, viewport: { x: 0, y: 0, zoom: 10 } }),
    /viewport is invalid/i,
  );
});

test("canvas API creates, updates, lists, validates, and deletes canvases", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ruider-canvases-"));
  const databasePath = path.join(root, "sqlite.db");
  process.env.RUIDER_DATABASE_PATH = databasePath;

  const migrationDatabase = new BetterSqlite3(databasePath);
  migrate(drizzle(migrationDatabase), { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  migrationDatabase.close();

  const collectionRoute = await import("@/app/api/canvases/route");
  const itemRoute = await import("@/app/api/canvases/[id]/route");
  const { sqlite } = await import("@/lib/db/client");

  t.after(async () => {
    sqlite.close();
    delete process.env.RUIDER_DATABASE_PATH;
    await rm(root, { recursive: true, force: true });
  });

  const createdResponse = await collectionRoute.POST(jsonRequest("/api/canvases", "POST", { title: "Opening image" }));
  assert.equal(createdResponse.status, 201);
  const created = (await createdResponse.json()) as { id: number; title: string };
  assert.equal(created.title, "Opening image");

  const scene = createEmptyCanvasScene();
  scene.elements.push({ id: "idea_1", type: "card", x: 24, y: 36, width: 240, height: 140, text: "What if?" });
  const updatedResponse = await itemRoute.PATCH(
    jsonRequest(`/api/canvases/${created.id}`, "PATCH", { scene }),
    routeContext(created.id),
  );
  assert.equal(updatedResponse.status, 200);
  const updated = (await updatedResponse.json()) as { scene: typeof scene };
  assert.deepEqual(updated.scene, scene);

  const listResponse = await collectionRoute.GET();
  assert.equal(listResponse.status, 200);
  assert.equal(((await listResponse.json()) as unknown[]).length, 1);

  const invalidResponse = await itemRoute.PATCH(
    jsonRequest(`/api/canvases/${created.id}`, "PATCH", {
      scene: { version: 1, elements: [], viewport: { x: 0, y: 0, zoom: 99 } },
    }),
    routeContext(created.id),
  );
  assert.equal(invalidResponse.status, 400);

  const deleteResponse = await itemRoute.DELETE(
    new Request(`http://localhost/api/canvases/${created.id}`, { method: "DELETE" }),
    routeContext(created.id),
  );
  assert.equal(deleteResponse.status, 204);
  assert.deepEqual(await (await collectionRoute.GET()).json(), []);
});

function jsonRequest(pathname: string, method: string, body: unknown): Request {
  return new Request(`http://localhost${pathname}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function routeContext(id: number): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id: String(id) }) };
}
