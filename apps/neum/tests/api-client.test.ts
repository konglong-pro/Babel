import assert from "node:assert/strict";
import test from "node:test";

import {
  ApiError,
  createFolder,
  listFolders,
} from "../src/lib/api-client";

test("read requests retry once after a transient network failure", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let calls = 0;
  globalThis.fetch = (async (_input, init) => {
    calls += 1;
    assert.equal(init?.cache, "no-store");
    if (calls === 1) throw new TypeError("fetch failed");
    return Response.json([]);
  }) as typeof fetch;

  assert.deepEqual(await listFolders(), []);
  assert.equal(calls, 2);
});

test("write requests are never retried", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return Response.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "The server failed to process the request.",
        },
      },
      { status: 503 },
    );
  }) as typeof fetch;

  await assert.rejects(
    () => createFolder({ name: "Systems", parentId: null }),
    (error: unknown) => error instanceof ApiError && error.status === 503,
  );
  assert.equal(calls, 1);
});
