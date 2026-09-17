import assert from "node:assert/strict";
import test from "node:test";
import { moveNote } from "@/lib/api-client";

test("moving a note only patches its folder and never sends stale content", async (t) => {
  const calls: Array<{ url: unknown; init?: RequestInit }> = [];
  t.mock.method(globalThis, "fetch", async (url: unknown, init?: RequestInit) => {
    calls.push({ url, init });
    return Response.json({ id: 12, folderId: 9 });
  });
  await moveNote(12, 9);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/notes/12");
  assert.equal(calls[0].init?.method, "PATCH");
  const body = calls[0].init?.body;
  assert.ok(body instanceof FormData);
  assert.deepEqual([...body.keys()], ["payload"]);
  assert.deepEqual(JSON.parse(body.get("payload") as string), { folderId: 9 });
});
