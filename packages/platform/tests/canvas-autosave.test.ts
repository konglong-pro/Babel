import assert from "node:assert/strict";
import test from "node:test";

import { createCanvasSaveQueue } from "../src/canvas/autosave";
import { createEmptyCanvasScene } from "../src/canvas/core";

const initial = createEmptyCanvasScene();
const edited = { ...initial, viewport: { ...initial.viewport, x: 10 } };
const newest = { ...initial, viewport: { ...initial.viewport, x: 20 } };

test("discard cancels writes that have not started", async () => {
  const writes: number[] = [];
  const queue = createCanvasSaveQueue(initial);
  const write = async (scene: typeof initial) => { writes.push(scene.viewport.x); };
  const pending = queue.save(edited, write);
  await queue.cancelPending();
  await pending;
  assert.deepEqual(writes, []);
  assert.equal(queue.isSaved(initial), true);
});

test("discard drains an in-flight save and drops the following queued edit", async () => {
  const started = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  const writes: number[] = [];
  const queue = createCanvasSaveQueue(initial);
  const write = async (scene: typeof initial) => {
    writes.push(scene.viewport.x);
    started.resolve();
    await finish.promise;
  };
  const first = queue.save(edited, write);
  await started.promise;
  const second = queue.save(newest, write);
  let discarded = false;
  const discard = queue.cancelPending().then(() => { discarded = true; });
  await Promise.resolve();
  assert.equal(discarded, false, "closing must wait for the active request");
  finish.resolve();
  await Promise.all([first, second, discard]);
  assert.deepEqual(writes, [10]);
  assert.equal(queue.isSaved(edited), true);
});

test("undo to the initial scene while saving persists the undo after that write", async () => {
  const started = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  const writes: number[] = [];
  const queue = createCanvasSaveQueue(initial);
  const write = async (scene: typeof initial) => {
    writes.push(scene.viewport.x);
    started.resolve();
    await finish.promise;
  };
  const first = queue.save(edited, write);
  await started.promise;
  assert.equal(queue.isSaved(initial), false);
  const undo = queue.save(initial, write);
  finish.resolve();
  await Promise.all([first, undo]);
  assert.deepEqual(writes, [10, 0]);
  assert.equal(queue.isSaved(initial), true);
});

test("duplicate saves coalesce and a failed save remains retryable", async () => {
  let attempts = 0;
  const queue = createCanvasSaveQueue(initial);
  const write = async () => {
    if (++attempts === 1) throw new Error("offline");
  };
  await assert.rejects(queue.save(edited, write), /offline/);
  assert.equal(queue.isSaved(edited), false);
  await Promise.all([queue.save(edited, write), queue.save(edited, write)]);
  assert.equal(attempts, 2);
  assert.equal(queue.isSaved(edited), true);
});

test("effect cleanup cancellation does not prevent a later mount from saving", async () => {
  const writes: number[] = [];
  const queue = createCanvasSaveQueue(initial);
  const write = async (scene: typeof initial) => { writes.push(scene.viewport.x); };
  await queue.cancelPending();
  await queue.save(edited, write);
  assert.deepEqual(writes, [10]);
});
