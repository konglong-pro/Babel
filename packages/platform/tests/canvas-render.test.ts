import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CanvasPreview } from "../src/canvas/react";
import { CanvasEditor } from "../src/canvas/editor";
import { createEmptyCanvasScene, type CanvasDetail } from "../src/canvas/core";

const canvas: CanvasDetail = {
  id: 1, title: "Example", createdAt: "2026-09-09", updatedAt: "2026-09-09",
  scene: { ...createEmptyCanvasScene(), elements: [
    { id: "text", type: "text", x: 0, y: 0, width: 200, height: 80, text: "<script>text</script>", fontSize: 24, textAlign: "center", stroke: "#ff0000" },
    { id: "image", type: "image", x: 220, y: 0, width: 100, height: 100, src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6iXAAAAAASUVORK5CYII=", alt: "Pasted diagram" },
  ] },
};

test("embedded preview renders escaped text, styles and the persisted raster image", () => {
  const html = renderToStaticMarkup(createElement(CanvasPreview, { scene: canvas.scene, label: "Diagram" }));
  assert.match(html, /&lt;script&gt;text&lt;\/script&gt;/u);
  assert.match(html, /font-size:24px/u);
  assert.match(html, /text-align:center/u);
  assert.match(html, /data:image\/png;base64,/u);
  assert.match(html, /Pasted diagram/u);
  assert.doesNotMatch(html, /<script>|canvas-card/u);
});

test("editor exposes new tool bindings, viewport actions and no Card tool", () => {
  const html = renderToStaticMarkup(createElement(CanvasEditor, { canvas, updateCanvas: async () => canvas, onSaved: () => undefined, errorMessage: String }));
  assert.match(html, /Eraser \(Ctrl\+Shift\+4\)/u);
  assert.match(html, /Text \(Ctrl\+Shift\+5\)/u);
  assert.match(html, /Redo \(Ctrl\+Y\)/u);
  assert.match(html, /Fit selection/u);
  assert.match(html, /Ctrl\+K commands/u);
  assert.doesNotMatch(html, />Card</u);
});
