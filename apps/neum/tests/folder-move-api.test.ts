import assert from "node:assert/strict";
import test from "node:test";
import { moveEntry } from "@/lib/api-client";

test("moving an entry sends its expected version and location without stale content", async (t) => {
  let captured: RequestInit | undefined;
  t.mock.method(globalThis, "fetch", async (url: unknown, init?: RequestInit) => {
    assert.equal(url, "/api/entries/12");
    captured = init;
    return Response.json({ id: 12, folderId: 9, version: 5 });
  });
  await moveEntry(12, 4, 9);
  assert.equal(captured?.method, "PATCH");
  assert.ok(captured?.body instanceof FormData);
  assert.deepEqual([...captured.body.keys()], ["payload"]);
  assert.deepEqual(JSON.parse(captured.body.get("payload") as string), { expectedVersion: 4, folderId: 9, parentId: null });
});
