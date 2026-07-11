import assert from "node:assert/strict";
import test from "node:test";

import { ApiError, errorResponse } from "../src/lib/http/errors";
import {
  optionalIdArray,
  optionalStringArray,
  queryFolderType,
  readJsonObject,
} from "../src/lib/http/request";
import { RepositoryError } from "../src/lib/repositories/errors";

test("ReTex HTTP adapters preserve local normalization and status mappings", async () => {
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
});
