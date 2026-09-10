import assert from "node:assert/strict";
import test from "node:test";

import {
  matchImportedImagesByBasename,
  MarkdownImportError,
  parseMarkdownImport,
  rewriteImportedImages,
} from "../src/lib/markdown-import";
import { ENTRY_NOTES_MAX_BYTES } from "../src/lib/entry-limits";

const encoder = new TextEncoder();

test("Markdown import validates type, size, and strict UTF-8", () => {
  const imported = parseMarkdownImport(
    "knowledge.final.md",
    encoder.encode("\uFEFF# Topic\nContext"),
  );
  assert.equal(imported.title, "knowledge.final");
  assert.equal(imported.contentMd, "# Topic\nContext");

  assert.throws(
    () => parseMarkdownImport("broken.md", new Uint8Array([0xc3, 0x28])),
    (error: unknown) =>
      error instanceof MarkdownImportError && error.code === "INVALID_UTF8",
  );
  assert.throws(
    () => parseMarkdownImport("notes.txt", encoder.encode("text")),
    (error: unknown) =>
      error instanceof MarkdownImportError && error.code === "INVALID_FILE_TYPE",
  );
  assert.throws(
    () => parseMarkdownImport("large.md", new Uint8Array(ENTRY_NOTES_MAX_BYTES + 1)),
    (error: unknown) =>
      error instanceof MarkdownImportError && error.code === "FILE_TOO_LARGE",
  );
});

test("local inline and reference images are rewritten with stable Neum tokens", () => {
  const source = [
    "![Map](./images/map.png)",
    "![Map again](images/map.png)",
    "![Cover][cover]",
    "![Remote](https://example.com/remote.png)",
    "",
    "[cover]: <plates/cover.webp> \"Cover\"",
  ].join("\n");
  const imported = rewriteImportedImages(source);

  assert.deepEqual(
    imported.imageReferences.map(({ path, basename }) => ({ path, basename })),
    [
      { path: "images/map.png", basename: "map.png" },
      { path: "plates/cover.webp", basename: "cover.webp" },
    ],
  );
  assert.equal(
    imported.contentMd.match(/neum-upload:\/\/import-[a-f0-9]+/g)?.length,
    3,
  );
  assert.match(imported.contentMd, /https:\/\/example\.com\/remote\.png/);
  assert.equal(
    rewriteImportedImages("![Again](images/map.png)").imageReferences[0].token,
    imported.imageReferences[0].token,
  );
});

test("image-like text in Markdown code is not imported", () => {
  const source = [
    "`![Inline](inline.png)`",
    "```md",
    "![Fenced](fenced.png)",
    "```",
    "    ![Indented](indented.png)",
    "![Actual](actual.png)",
  ].join("\n");
  const imported = rewriteImportedImages(source);
  assert.deepEqual(imported.imageReferences.map(({ path }) => path), ["actual.png"]);
  assert.match(imported.contentMd, /!\[Fenced\]\(fenced\.png\)/);
});

test("unsafe local image paths reject the import", () => {
  for (const path of [
    "/absolute.png",
    "C:/private/image.png",
    "file:///private/image.png",
    "../escape.png",
    "images/%2e%2e/escape.png",
  ]) {
    assert.throws(
      () => rewriteImportedImages(`![Unsafe](${path})`),
      (error: unknown) =>
        error instanceof MarkdownImportError &&
        error.code === "UNSAFE_IMAGE_PATH" &&
        error.path === path,
      path,
    );
  }
});

test("basename matching resolves only unique reference and file pairs", () => {
  const references = rewriteImportedImages([
    "![Map](maps/map.png)",
    "![First](one/seal.png)",
    "![Second](two/seal.png)",
  ].join("\n")).imageReferences;
  const files = [
    { name: "MAP.PNG", id: 1 },
    { name: "seal.png", id: 2 },
  ];
  const result = matchImportedImagesByBasename(references, files);

  assert.deepEqual(
    result.matches.map(({ reference, file }) => [reference.path, file.id]),
    [["maps/map.png", 1]],
  );
  assert.deepEqual(result.unresolved.map(({ path }) => path), [
    "one/seal.png",
    "two/seal.png",
  ]);
  assert.deepEqual(result.unmatchedFiles.map(({ id }) => id), [2]);
});
