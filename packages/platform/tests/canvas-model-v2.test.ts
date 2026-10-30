import assert from "node:assert/strict";
import test from "node:test";

import {
  CANVAS_IMAGE_MAX_BYTES,
  CANVAS_SCENE_MAX_BYTES,
  createEmptyCanvasScene,
  decodeCanvasScene,
  elementBounds,
  encodeCanvasScene,
  fitCanvasViewport,
  isCanvasImageSource,
  parseCanvasScene,
  type CanvasElement,
  type CanvasImageElement,
  type CanvasTextElement,
} from "@babel-apps/platform/canvas/core";

const text: CanvasTextElement = {
  id: "text", type: "text", x: -100, y: -50, width: 200, height: 80,
  text: "Hello\n世界", fontSize: 24, textAlign: "center", stroke: "#123456",
};
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Z1kAAAAASUVORK5CYII=";
const image: CanvasImageElement = {
  id: "image", type: "image", x: 200, y: 50, width: 100, height: 100,
  src: png, alt: "Pasted image",
};
const scene = (elements: unknown[]) => ({ ...createEmptyCanvasScene(), elements });

test("text, images, styles and attached arrows round-trip with version one", () => {
  const value = scene([
    text,
    image,
    { id: "shape", type: "shape", shape: "rectangle", x: 0, y: 0, width: 40, height: 20,
      stroke: "#abc", strokeWidth: 3, fill: "#AABBCC88" },
    { id: "arrow", type: "arrow", start: { x: 100, y: -10 }, end: { x: 200, y: 100 },
      startBinding: { elementId: "text", anchor: { x: 1, y: 0.5 } },
      endBinding: { elementId: "image", anchor: { x: 0, y: 0.5 } } },
  ]);
  assert.deepEqual(decodeCanvasScene(encodeCanvasScene(value)), value);
  assert.equal(parseCanvasScene(value).version, 1);
});

test("cards are removed and old paths, shapes and arrows remain valid", () => {
  assert.throws(() => parseCanvasScene(scene([{ ...text, type: "card" }])), /invalid element/u);
  assert.doesNotThrow(() => parseCanvasScene(scene([
    { id: "path", type: "path", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
    { id: "shape", type: "shape", shape: "ellipse", x: 0, y: 0, width: 20, height: 20 },
    { id: "arrow", type: "arrow", start: { x: 0, y: 0 }, end: { x: 1, y: 1 } },
  ])));
});

test("text and styles reject unsupported values before saving", () => {
  for (const patch of [
    { fontSize: 7 }, { fontSize: 241 }, { fontSize: Number.NaN },
    { textAlign: "justify" }, { text: "x".repeat(20_001) },
    { stroke: "red" }, { stroke: "url(https://example.com/image)" },
    { fill: "transparent" }, { strokeWidth: 0 }, { strokeWidth: 33 }, { width: 0 },
  ]) {
    assert.throws(() => parseCanvasScene(scene([{ ...text, ...patch }])), /invalid element/u);
  }
  assert.doesNotThrow(() => parseCanvasScene(scene([{ ...text, fill: "none", stroke: "#1234" }])));
});

test("image sources accept only bounded base64 raster formats with matching headers", () => {
  assert.equal(isCanvasImageSource(png), true);
  const jpeg = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString("base64")}`;
  const webp = `data:image/webp;base64,${Buffer.from("RIFF\x04\x00\x00\x00WEBP", "binary").toString("base64")}`;
  assert.equal(isCanvasImageSource(jpeg), true);
  assert.equal(isCanvasImageSource(webp), true);
  for (const src of [
    "https://example.com/image.png",
    "data:image/svg+xml;base64,PHN2Zy8+",
    "data:image/png;base64,PHN2Zy8+",
    "data:image/png;base64,A===",
    "data:image/png;base64,%%%%",
    "data:image/png;base64,iVBORw0KGgo",
    png.replace("image/png", "image/jpeg"),
    "data:image/png,not-base64",
  ]) {
    assert.equal(isCanvasImageSource(src), false, src);
    assert.throws(() => parseCanvasScene(scene([{ ...image, src }])), /invalid element/u);
  }
  const bytes = Buffer.alloc(CANVAS_IMAGE_MAX_BYTES);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  assert.equal(isCanvasImageSource(`data:image/png;base64,${bytes.toString("base64")}`), true);
  assert.equal(isCanvasImageSource(`data:image/png;base64,${Buffer.concat([bytes, Buffer.from([0])]).toString("base64")}`), false);
});

test("scene byte limits apply to all parsing and serialization paths", () => {
  const bytes = Buffer.alloc(CANVAS_IMAGE_MAX_BYTES);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  const src = `data:image/png;base64,${bytes.toString("base64")}`;
  const value = scene([{ ...image, src }, { ...image, id: "second", src }]);
  assert.throws(() => parseCanvasScene(value), /must not exceed 5 MiB/u);
  assert.throws(() => encodeCanvasScene(value), /must not exceed 5 MiB/u);
  assert.throws(() => decodeCanvasScene(JSON.stringify(value)), /must not exceed 5 MiB/u);
  const unicodeValue = { ...createEmptyCanvasScene(), extra: "界".repeat(Math.ceil(CANVAS_SCENE_MAX_BYTES / 3)) };
  assert.throws(() => parseCanvasScene(unicodeValue), /must not exceed 5 MiB/u);
});

test("arrow bindings require existing boxed targets and normalized anchors", () => {
  const arrow = {
    id: "arrow", type: "arrow", start: { x: 0, y: 0 }, end: { x: 1, y: 1 },
    endBinding: { elementId: "text", anchor: { x: 0, y: 0.5 } },
  };
  assert.doesNotThrow(() => parseCanvasScene(scene([arrow, text])));
  assert.throws(() => parseCanvasScene(scene([arrow])), /must reference/u);
  assert.throws(() => parseCanvasScene(scene([
    { ...arrow, endBinding: { elementId: "arrow", anchor: { x: 0, y: 0 } } },
  ])), /must reference/u);
  assert.throws(() => parseCanvasScene(scene([
    { id: "text", type: "path", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }, arrow,
  ])), /must reference/u);
  for (const anchor of [{ x: -0.1, y: 0 }, { x: 1.1, y: 0 }, { x: 0, y: Number.NaN }]) {
    assert.throws(() => parseCanvasScene(scene([
      text, { ...arrow, endBinding: { elementId: "text", anchor } },
    ])), /invalid element/u);
  }
});

test("element bounds and fit include text, images and reversed arrows", () => {
  assert.deepEqual(elementBounds(text), { x: -100, y: -50, width: 200, height: 80 });
  assert.deepEqual(elementBounds(image), { x: 200, y: 50, width: 100, height: 100 });
  const arrow: CanvasElement = { id: "arrow", type: "arrow", start: { x: 20, y: 40 }, end: { x: -10, y: -20 } };
  assert.deepEqual(elementBounds(arrow), { x: -10, y: -20, width: 30, height: 60 });
  assert.deepEqual(elementBounds({ id: "path", type: "path", points: [{ x: 10, y: 20 }, { x: -30, y: -10 }, { x: 20, y: 50 }] }),
    { x: -30, y: -10, width: 50, height: 60 });
  assert.deepEqual(fitCanvasViewport([text, image], 800, 400, 20), { x: 220, y: 110, zoom: 1.8 });
});
