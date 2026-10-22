import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import test from "node:test";

import { subscribeCanvasEmbed, type CanvasEmbedSnapshot } from "../src/canvas-embeds";

class ReaderDocument extends EventTarget {
  visibilityState: DocumentVisibilityState = "visible";
  setVisible(visible: boolean) {
    this.visibilityState = visible ? "visible" : "hidden";
    this.dispatchEvent(new Event("visibilitychange"));
  }
  asDocument(): Document { return this as unknown as Document; }
}

function response(id: number, updatedAt = "2026-09-05T00:00:00Z") {
  return Response.json({ id, title: `Canvas ${id}`, updatedAt,
    scene: { version: 1, elements: [], viewport: { x: 0, y: 0, zoom: 1 } } });
}

test("visible readers share a request and polling stops with the last subscription", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const fetch = t.mock.method(globalThis, "fetch", async () => response(1));
  const document = new ReaderDocument();
  const first: CanvasEmbedSnapshot[] = [];
  const second: CanvasEmbedSnapshot[] = [];
  const closeFirst = subscribeCanvasEmbed(1, document.asDocument(), (value) => first.push(value));
  const closeSecond = subscribeCanvasEmbed(1, document.asDocument(), (value) => second.push(value));
  t.after(() => { closeFirst(); closeSecond(); });
  await setImmediate();
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(first.at(-1)?.canvas, second.at(-1)?.canvas);
  closeFirst();
  t.mock.timers.tick(2_000);
  await setImmediate();
  assert.equal(fetch.mock.callCount(), 2);
  closeSecond();
  t.mock.timers.tick(10_000);
  assert.equal(fetch.mock.callCount(), 2);
});

test("hidden documents do not load and resume immediately when visible", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const fetch = t.mock.method(globalThis, "fetch", async () => response(2));
  const document = new ReaderDocument();
  document.setVisible(false);
  const close = subscribeCanvasEmbed(2, document.asDocument(), () => undefined);
  t.after(close);
  t.mock.timers.tick(10_000);
  assert.equal(fetch.mock.callCount(), 0);
  document.setVisible(true);
  await setImmediate();
  assert.equal(fetch.mock.callCount(), 1);
  document.setVisible(false);
  t.mock.timers.tick(10_000);
  assert.equal(fetch.mock.callCount(), 1);
  document.setVisible(true);
  await setImmediate();
  assert.equal(fetch.mock.callCount(), 2);
});

test("a visible detached reader keeps polling when the source document hides", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const fetch = t.mock.method(globalThis, "fetch", async () => response(3));
  const source = new ReaderDocument();
  const detached = new ReaderDocument();
  const closeSource = subscribeCanvasEmbed(3, source.asDocument(), () => undefined);
  const closeDetached = subscribeCanvasEmbed(3, detached.asDocument(), () => undefined);
  t.after(() => { closeSource(); closeDetached(); });
  await setImmediate();
  source.setVisible(false);
  t.mock.timers.tick(2_000);
  await setImmediate();
  assert.equal(fetch.mock.callCount(), 2);
});

test("slow or aborted requests cannot replace a newer canvas snapshot", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const oldResponse = Promise.withResolvers<Response>();
  let requests = 0;
  const fetch = t.mock.method(globalThis, "fetch", () => ++requests === 1
    ? oldResponse.promise : Promise.resolve(response(4, "new")));
  const document = new ReaderDocument();
  const snapshots: CanvasEmbedSnapshot[] = [];
  const close = subscribeCanvasEmbed(4, document.asDocument(), (value) => snapshots.push(value));
  t.after(close);
  t.mock.timers.tick(10_000);
  assert.equal(fetch.mock.callCount(), 1, "slow requests must not be restarted every two seconds");
  document.setVisible(false);
  document.setVisible(true);
  await setImmediate();
  assert.equal(snapshots.at(-1)?.canvas?.updatedAt, "new");
  oldResponse.resolve(response(4, "old"));
  await setImmediate();
  assert.equal(snapshots.at(-1)?.canvas?.updatedAt, "new");
});
