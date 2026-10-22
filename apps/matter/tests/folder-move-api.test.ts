import assert from "node:assert/strict";
import test from "node:test";
import { moveKnowledge, moveExercise } from "@/lib/api-client";

test("folder moves patch location only and keep knowledge and exercise endpoints separate", async (t) => {
  const calls: Array<{ url: unknown; init?: RequestInit }> = [];
  t.mock.method(globalThis, "fetch", async (url: unknown, init?: RequestInit) => {
    calls.push({ url, init });
    return Response.json({ id: 12, folderId: 9 });
  });
  await moveKnowledge(12, 9);
  await moveExercise(14, 8);
  assert.deepEqual(calls.map((call) => call.url), ["/api/knowledge/12", "/api/exercises/14"]);
  assert.deepEqual(calls.map((call) => call.init?.method), ["PATCH", "PATCH"]);
  assert.deepEqual(calls.map((call) => JSON.parse(call.init?.body as string)), [{ folderId: 9, parentId: null }, { folderId: 8 }]);
});
