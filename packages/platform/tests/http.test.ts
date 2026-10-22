import assert from "node:assert/strict";
import test from "node:test";

import {
  ApiError,
  createHttpErrorHandlers,
} from "../src/http/errors";
import {
  assertOnlyFields,
  assertPatchHasFields,
  assertSameOrigin,
  normalizeLoopbackOrigin,
  optionalNonNegativeInteger,
  optionalNullablePositiveInteger,
  optionalString,
  parsePositiveInteger,
  readJsonObject,
  requiredString,
} from "../src/http/request";

class TestImageError extends Error {
  readonly code = "FILE_TOO_LARGE" as const;
}

const { errorResponse, handleApi } = createHttpErrorHandlers({
  errorStatuses: {
    NOT_FOUND: 404,
  },
  imageErrorStatuses: {
    FILE_TOO_LARGE: 413,
  },
  isImageStorageError: (error): error is TestImageError => error instanceof TestImageError,
});

test("configured HTTP handlers preserve API, domain, and image errors", async () => {
  const apiResponse = errorResponse(
    new ApiError(400, "VALIDATION_ERROR", "Invalid value.", { field: "title" }),
  );
  assert.equal(apiResponse.status, 400);
  assert.deepEqual(await apiResponse.json(), {
    error: {
      code: "VALIDATION_ERROR",
      message: "Invalid value.",
      details: { field: "title" },
    },
  });

  const domainResponse = await handleApi(() => {
    throw Object.assign(new Error("Missing."), {
      code: "NOT_FOUND",
      details: { id: 7 },
    });
  });
  assert.equal(domainResponse.status, 404);
  assert.deepEqual(await domainResponse.json(), {
    error: {
      code: "NOT_FOUND",
      message: "Missing.",
      details: { id: 7 },
    },
  });

  const imageResponse = errorResponse(new TestImageError("Too large."));
  assert.equal(imageResponse.status, 413);
  assert.deepEqual(await imageResponse.json(), {
    error: {
      code: "FILE_TOO_LARGE",
      message: "Too large.",
    },
  });
});

test("shared request helpers preserve validation and normalization", async () => {
  const body = await readJsonObject(
    new Request("http://localhost/test", {
      method: "POST",
      body: JSON.stringify({ title: "  Note  ", parentId: null }),
    }),
  );
  assert.equal(requiredString(body, "title"), "Note");
  assert.equal(optionalNullablePositiveInteger(body, "parentId"), null);
  assert.equal(optionalString(body, "missing"), undefined);
  assert.equal(optionalNonNegativeInteger({ position: 0 }, "position"), 0);
  assert.equal(parsePositiveInteger("42", "id"), 42);
  assert.doesNotThrow(() =>
    assertSameOrigin(new Request("http://127.0.0.1:3001/test")),
  );

  assert.throws(
    () => optionalNonNegativeInteger({ position: 1.5 }, "position"),
    (error: unknown) => error instanceof ApiError && error.code === "VALIDATION_ERROR",
  );
  assert.throws(
    () => optionalNonNegativeInteger({ position: "1" }, "position"),
    (error: unknown) => error instanceof ApiError && error.code === "VALIDATION_ERROR",
  );
  assert.throws(
    () => optionalNonNegativeInteger({ position: Number.MAX_SAFE_INTEGER + 1 }, "position"),
    (error: unknown) => error instanceof ApiError && error.code === "VALIDATION_ERROR",
  );
  assert.throws(
    () => assertPatchHasFields({ title: undefined, parentId: undefined }),
    (error: unknown) => error instanceof ApiError && error.code === "VALIDATION_ERROR",
  );
  assert.throws(
    () => assertOnlyFields({ title: "ok", extra: true }, ["title"]),
    (error: unknown) => error instanceof ApiError && error.code === "VALIDATION_ERROR",
  );
  assert.throws(
    () =>
      assertSameOrigin(
        new Request("http://localhost:3001/test", {
          headers: { origin: "https://attacker.example" },
        }),
      ),
    (error: unknown) => error instanceof ApiError && error.code === "FORBIDDEN_ORIGIN",
  );

  await assert.rejects(
    () =>
      readJsonObject(
        new Request("http://localhost/test", {
          method: "POST",
          body: "[]",
        }),
      ),
    (error: unknown) => error instanceof ApiError && error.code === "INVALID_JSON",
  );
});

test("loopback origins normalize host aliases without relaxing protocol or port", () => {
  for (const value of [
    "http://localhost:3001/api/folders",
    "http://127.0.0.1:3001/api/folders",
    "http://[::1]:3001/api/folders",
  ]) {
    assert.equal(normalizeLoopbackOrigin(value), "http://localhost:3001");
  }

  assert.equal(normalizeLoopbackOrigin("https://127.0.0.1:3001"), "https://localhost:3001");
  assert.equal(normalizeLoopbackOrigin("http://localhost:3002"), "http://localhost:3002");
  assert.equal(normalizeLoopbackOrigin("http://127.0.0.2:3001"), undefined);
  assert.equal(normalizeLoopbackOrigin("https://attacker.example:3001"), undefined);
  assert.equal(normalizeLoopbackOrigin("not a URL"), undefined);
});
