import assert from "node:assert/strict";
import test from "node:test";

import {
  matchImportedImagesByBasename,
  MarkdownImportError,
  parseMarkdownImport,
  rewriteImportedImages,
} from "../src/lib/markdown-import";
import { NOTE_CONTENT_MAX_BYTES } from "../src/lib/note-limits";

const encoder = new TextEncoder();

test("Markdown import validates type and UTF-8 and derives the title", () => {
  const imported = parseMarkdownImport(
    "lesson.final.md",
    encoder.encode("\uFEFF# Lesson\nBody"),
  );

  assert.equal(imported.title, "lesson.final");
  assert.equal(imported.contentMd, "# Lesson\nBody");
  assert.deepEqual(imported.imageReferences, []);
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
    () => parseMarkdownImport(
      "oversized.md",
      new Uint8Array(NOTE_CONTENT_MAX_BYTES + 1),
    ),
    (error: unknown) =>
      error instanceof MarkdownImportError && error.code === "FILE_TOO_LARGE",
  );
});

test("local images are rewritten while remote images remain unchanged", () => {
  const source = [
    "![Map](images/map.png)",
    "![Map again](./images/map.png)",
    "![Portrait](<plates/author portrait.jpg> \"Author\")",
    "![Reference][cover]",
    "![Remote](https://example.com/remote.png)",
    "",
    "[cover]: media/cover.webp \"Cover\"",
  ].join("\n");
  const imported = rewriteImportedImages(source);

  assert.deepEqual(
    imported.imageReferences.map(({ path, basename }) => ({ path, basename })),
    [
      { path: "images/map.png", basename: "map.png" },
      { path: "plates/author portrait.jpg", basename: "author portrait.jpg" },
      { path: "media/cover.webp", basename: "cover.webp" },
    ],
  );
  assert.equal(
    imported.contentMd.match(/vali-upload:\/\/import-[a-f0-9]+/g)?.length,
    4,
  );
  assert.match(imported.contentMd, /https:\/\/example\.com\/remote\.png/);
});

test("image-like text inside Markdown code is preserved", () => {
  const source = [
    "`![Inline](inline.png)`",
    "```md",
    "![Fenced](fenced.png)",
    "```",
    "    ![Indented](indented.png)",
    "\\![Escaped](escaped.png)",
  ].join("\n");

  assert.deepEqual(rewriteImportedImages(source), {
    contentMd: source,
    imageReferences: [],
  });
});

test("unsafe local image paths reject the entire import", () => {
  const unsafe = [
    "/absolute.png",
    "C:/private/image.png",
    "file:///private/image.png",
    "data:image/png;base64,AAAA",
    "../escape.png",
    "images/%2e%2e/escape.png",
  ];

  for (const imagePath of unsafe) {
    assert.throws(
      () => rewriteImportedImages(`![Unsafe](${imagePath})`),
      (error: unknown) =>
        error instanceof MarkdownImportError &&
        error.code === "UNSAFE_IMAGE_PATH" &&
        error.path === imagePath,
      imagePath,
    );
  }
});

test("basename matching resolves only unique reference and file pairs", () => {
  const references = rewriteImportedImages([
    "![Map](maps/map.png)",
    "![Portrait](portraits/author.jpg)",
    "![First seal](one/seal.png)",
    "![Second seal](two/seal.png)",
    "![Missing](missing.gif)",
  ].join("\n")).imageReferences;
  const files = [
    { name: "MAP.PNG", id: 1 },
    { name: "author.jpg", id: 2 },
    { name: "author.jpg", id: 3 },
    { name: "seal.png", id: 4 },
    { name: "extra.webp", id: 5 },
  ];

  const result = matchImportedImagesByBasename(references, files);
  assert.deepEqual(
    result.matches.map(({ reference, file }) => [reference.path, file.id]),
    [["maps/map.png", 1]],
  );
  assert.deepEqual(
    result.unresolved.map(({ path }) => path),
    [
      "portraits/author.jpg",
      "one/seal.png",
      "two/seal.png",
      "missing.gif",
    ],
  );
  assert.deepEqual(result.unmatchedFiles.map(({ id }) => id), [2, 3, 4, 5]);
});
