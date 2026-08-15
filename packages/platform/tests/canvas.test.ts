import assert from "node:assert/strict";
import test from "node:test";

import BetterSqlite3 from "better-sqlite3";

import {
  createEmptyCanvasScene,
  decodeCanvasScene,
  encodeCanvasScene,
  fitCanvasViewport,
  parseCanvasScene,
} from "@babel-apps/platform/canvas/core";
import { createCanvasRepository } from "@babel-apps/platform/canvas/server";

test("canvas scenes round-trip through their persisted JSON form", () => {
  const scene = createEmptyCanvasScene();
  assert.deepEqual(decodeCanvasScene(encodeCanvasScene(scene)), scene);
});

test("canvas validation rejects duplicate element ids", () => {
  assert.throws(() => parseCanvasScene({
    version: 1,
    viewport: { x: 0, y: 0, zoom: 1 },
    elements: [
      { id: "same", type: "shape", shape: "rectangle", x: 0, y: 0, width: 10, height: 10 },
      { id: "same", type: "shape", shape: "ellipse", x: 20, y: 20, width: 10, height: 10 },
    ],
  }), /unique/u);
});

test("fit viewport includes all canvas content and centers it", () => {
  const viewport = fitCanvasViewport([
    { id: "left", type: "shape", shape: "rectangle", x: -100, y: -50, width: 50, height: 50 },
    { id: "right", type: "arrow", start: { x: 100, y: 50 }, end: { x: 300, y: 150 } },
  ], 800, 400, 20);

  assert.equal(viewport.zoom, 1.8);
  assert.equal(viewport.x, 220);
  assert.equal(viewport.y, 110);
});

test("shared canvas repository persists CRUD data and validates scenes", () => {
  const sqlite = new BetterSqlite3(":memory:");
  try {
    sqlite.exec(`
      CREATE TABLE canvas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        scene TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `);
    const repository = createCanvasRepository(sqlite);
    const created = repository.create("Opening image");
    assert.equal(created.title, "Opening image");
    assert.deepEqual(repository.list().map(({ id }) => id), [created.id]);

    const scene = createEmptyCanvasScene();
    scene.elements.push({
      id: "idea_1",
      type: "card",
      x: 24,
      y: 36,
      width: 240,
      height: 140,
      text: "What if?",
    });
    assert.deepEqual(repository.update(created.id, { scene })?.scene, scene);
    assert.throws(
      () => repository.update(created.id, {
        scene: { ...scene, viewport: { x: 0, y: 0, zoom: 99 } },
      }),
      /viewport is invalid/u,
    );
    assert.equal(repository.delete(created.id), true);
    assert.equal(repository.get(created.id), null);
  } finally {
    sqlite.close();
  }
});
