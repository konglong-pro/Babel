import assert from "node:assert/strict";
import test from "node:test";

import { ApiError, errorResponse } from "../src/lib/http/errors";
import {
  assertSameOrigin,
  optionalIdArray,
  optionalStringArray,
  queryFolderType,
  readNoteMutationRequest,
  readJsonObject,
} from "../src/lib/http/request";
import { NOTE_MULTIPART_WIRE_MAX_BYTES } from "../src/lib/note-limits";
import { RepositoryError } from "../src/lib/repositories/errors";

test("Matter HTTP adapters preserve local normalization and status mappings", async () => {
  assert.deepEqual(
    optionalStringArray({ tags: [" analysis ", "analysis", "", " geometry "] }, "tags"),
    ["analysis", "geometry"],
  );
  assert.deepEqual(optionalIdArray({ knowledgeIds: [2, 2, 3] }, "knowledgeIds"), [2, 3]);
  assert.equal(queryFolderType("knowledge"), "knowledge");

  const response = errorResponse(
    new RepositoryError("NOT_EMPTY", "Folder is not empty.", { folderId: 1 }),
  );
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: {
      code: "NOT_EMPTY",
      message: "Folder is not empty.",
      details: { folderId: 1 },
    },
  });

  await assert.rejects(
    () =>
      readJsonObject(
        new Request("http://localhost/api/test", {
          method: "POST",
          body: "[]",
        }),
      ),
    (error: unknown) => error instanceof ApiError && error.code === "INVALID_JSON",
  );

  assert.doesNotThrow(() => assertSameOrigin(
    new Request("http://localhost:3000/api/test", {
      method: "POST",
      headers: { Origin: "http://127.0.0.1:3000" },
    }),
  ));
  assert.throws(
    () => assertSameOrigin(
      new Request("http://localhost:3000/api/test", {
        method: "POST",
        headers: { Origin: "https://attacker.example" },
      }),
    ),
    (error: unknown) => error instanceof ApiError && error.code === "FORBIDDEN_ORIGIN",
  );

  await assert.rejects(
    () => readNoteMutationRequest(
      new Request("http://localhost/api/test", {
        method: "POST",
        headers: {
          "Content-Type": "multipart/form-data; boundary=matter-limit",
          "Content-Length": String(NOTE_MULTIPART_WIRE_MAX_BYTES + 1),
        },
        body: "--matter-limit--\r\n",
      }),
    ),
    (error: unknown) => error instanceof ApiError && error.code === "REQUEST_TOO_LARGE",
  );

  const tooManyImages = new FormData();
  tooManyImages.set("payload", "{}");
  for (let index = 0; index < 51; index += 1) {
    tooManyImages.append(
      `image:image-${index}`,
      new Blob([Uint8Array.of(0x89)], { type: "image/png" }),
      `image-${index}.png`,
    );
  }
  await assert.rejects(
    () => readNoteMutationRequest(
      new Request("http://localhost/api/test", {
        method: "POST",
        body: tooManyImages,
      }),
    ),
    (error: unknown) => error instanceof ApiError && error.code === "TOO_MANY_IMAGES",
  );
});
