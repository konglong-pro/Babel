import assert from "node:assert/strict";
import test from "node:test";
import { canvasToolFromKey, recordCanvasChange, stepCanvasHistory, type CanvasHistory } from "../src/canvas/editor-state";
import type { CanvasElement } from "../src/canvas/core";

const before: CanvasElement[] = [];
const after: CanvasElement[] = [{ id: "line", type: "path", points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }];
const empty: CanvasHistory = { past: [], future: [] };

test("physical digit shortcuts work with Shift symbols and ignore composing/extra modifiers", () => {
  const key = { code: "Digit3", ctrlKey: true, metaKey: false, shiftKey: true, altKey: false, isComposing: false };
  assert.equal(canvasToolFromKey(key), "pen");
  assert.equal(canvasToolFromKey({ ...key, code: "Digit4" }), "eraser");
  assert.equal(canvasToolFromKey({ ...key, code: "Digit5" }), "text");
  assert.equal(canvasToolFromKey({ ...key, code: "Numpad8" }), "arrow");
  assert.equal(canvasToolFromKey({ ...key, isComposing: true }), null);
  assert.equal(canvasToolFromKey({ ...key, shiftKey: false }), null);
  assert.equal(canvasToolFromKey({ ...key, altKey: true }), null);
  assert.equal(canvasToolFromKey({ ...key, code: "Digit9" }), null);
});

test("one completed gesture is one undo step; redo is invalidated by new content", () => {
  const history = recordCanvasChange(empty, before, after);
  const undo = stepCanvasHistory(history, after, "undo")!;
  assert.deepEqual(undo.elements, before);
  const redo = stepCanvasHistory(undo.history, before, "redo")!;
  assert.deepEqual(redo.elements, after);
  const changed: CanvasElement[] = [{ ...after[0], stroke: "#ff0000" }];
  assert.equal(recordCanvasChange(undo.history, before, changed).future.length, 0);
  assert.equal(stepCanvasHistory(empty, before, "undo"), null);
});

test("unchanged content and viewport-only changes do not consume undo or erase redo", () => {
  const withRedo = stepCanvasHistory(recordCanvasChange(empty, before, after), after, "undo")!.history;
  assert.equal(recordCanvasChange(withRedo, [], []), withRedo);
  const scene = { elements: before, viewport: { x: 400, y: -200, zoom: 2 } };
  const redo = stepCanvasHistory(withRedo, scene.elements, "redo")!;
  const restored = { ...scene, elements: redo.elements };
  assert.deepEqual(restored.viewport, { x: 400, y: -200, zoom: 2 });
});
