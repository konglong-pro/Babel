import assert from "node:assert/strict";
import test from "node:test";

import { readEntryMultipart } from "../src/lib/http/request";
import {
  assertEntrySaveLimits,
  ImageStorageError,
  type EntryImageUpload,
} from "../src/lib/storage";
import {
  ENTRY_CODE_MAX_BYTES,
  ENTRY_MULTIPART_WIRE_MAX_BYTES,
  ENTRY_NEW_IMAGE_MAX_COUNT,
  ENTRY_NOTES_MAX_BYTES,
} from "../src/lib/entry-limits";

function declaredUpload(size: number): EntryImageUpload {
  return {
    type: "image/png",
    size,
    async arrayBuffer() {
      throw new Error("Limit checks must not read upload bodies.");
    },
  };
}

test("entry limits count UTF-8 bytes for Markdown notes and code", () => {
  assert.throws(
    () => assertEntrySaveLimits(
      "\u53f2".repeat(Math.floor(ENTRY_NOTES_MAX_BYTES / 3) + 1),
      null,
      new Map(),
    ),
    (error: unknown) =>
      error instanceof ImageStorageError && error.code === "CONTENT_TOO_LARGE",
  );
  assert.throws(
    () => assertEntrySaveLimits("", "x".repeat(ENTRY_CODE_MAX_BYTES + 1), new Map()),
    (error: unknown) =>
      error instanceof ImageStorageError && error.code === "CODE_TOO_LARGE",
  );
});

test("entry limits reject too many images and logical saves above 100 MiB", () => {
  const tooMany = new Map<string, EntryImageUpload>();
  for (let index = 0; index <= ENTRY_NEW_IMAGE_MAX_COUNT; index += 1) {
    tooMany.set(`image-${index}`, declaredUpload(1));
  }
  assert.throws(
    () => assertEntrySaveLimits("", null, tooMany),
    (error: unknown) =>
      error instanceof ImageStorageError && error.code === "TOO_MANY_IMAGES",
  );

  const tooLarge = new Map<string, EntryImageUpload>();
  for (let index = 0; index < 11; index += 1) {
    tooLarge.set(`image-${index}`, declaredUpload(10 * 1024 * 1024));
  }
  assert.throws(
    () => assertEntrySaveLimits("", null, tooLarge),
    (error: unknown) =>
      error instanceof ImageStorageError && error.code === "REQUEST_TOO_LARGE",
  );
});

test("multipart wire size is rejected before parsing and while streaming", async () => {
  let formDataCalled = false;
  const oversizedHeader = {
    headers: new Headers({
      "Content-Length": String(ENTRY_MULTIPART_WIRE_MAX_BYTES + 1),
    }),
    body: null,
    async formData() {
      formDataCalled = true;
      return new FormData();
    },
  } as unknown as Request;
  await assert.rejects(
    readEntryMultipart(oversizedHeader),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      (error as { code: string }).code === "REQUEST_TOO_LARGE",
  );
  assert.equal(formDataCalled, false);

  const streamed = new Request("http://localhost/api/entries", {
    method: "POST",
    headers: { "content-type": "multipart/form-data; boundary=test" },
    body: new Uint8Array([1, 2, 3, 4]),
  });
  await assert.rejects(
    readEntryMultipart(streamed, 3),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      (error as { code: string }).code === "REQUEST_TOO_LARGE",
  );
});
