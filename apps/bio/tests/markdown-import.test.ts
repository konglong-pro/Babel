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

test("Markdown import decodes strict UTF-8, strips a BOM, and uses the filename stem", () => {
  const imported = parseMarkdownImport(
    "chronicle.final.md",
    encoder.encode("\uFEFF---\ntopic: history\n---\n# 春秋\n原文"),
  );

  assert.equal(imported.title, "chronicle.final");
  assert.equal(imported.contentMd, "---\ntopic: history\n---\n# 春秋\n原文");
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

test("inline and reference images are rewritten while remote images remain unchanged", () => {
  const source = [
    "![Map](images/map.png)",
    "![Portrait](<plates/author portrait.jpg> \"Author\")",
    "![Map again](./images/map.png)",
    "![Reference][cover]",
    "![Collapsed][]",
    "![Shortcut]",
    "![Remote](https://example.com/remote.png)",
    "![Protocol relative](//cdn.example.com/asset.webp)",
    "",
    "[cover]: media/cover.webp \"Cover\"",
    "[collapsed]: media/collapsed.gif",
    "[shortcut]: http://example.com/shortcut.jpg",
  ].join("\n");

  const imported = rewriteImportedImages(source);
  assert.equal(imported.imageReferences.length, 4);
  assert.deepEqual(
    imported.imageReferences.map(({ path, basename }) => ({ path, basename })),
    [
      { path: "images/map.png", basename: "map.png" },
      { path: "plates/author portrait.jpg", basename: "author portrait.jpg" },
      { path: "media/cover.webp", basename: "cover.webp" },
      { path: "media/collapsed.gif", basename: "collapsed.gif" },
    ],
  );

  const [map] = imported.imageReferences;
  assert.equal(
    imported.contentMd.match(new RegExp(`bio-upload:\\/\\/${map.token}`, "g"))?.length,
    2,
  );
  assert.match(imported.contentMd, /\[cover\]: bio-upload:\/\/import-[a-f0-9]+ "Cover"/);
  assert.match(imported.contentMd, /https:\/\/example\.com\/remote\.png/);
  assert.match(imported.contentMd, /\/\/cdn\.example\.com\/asset\.webp/);
  assert.match(imported.contentMd, /http:\/\/example\.com\/shortcut\.jpg/);
});

test("the same normalized local path receives one stable token", () => {
  const first = rewriteImportedImages("![One](./images/pic%20one.png)\n![Two](images/pic%20one.png)");
  const second = rewriteImportedImages("![Again](images/pic%20one.png)");

  assert.equal(first.imageReferences.length, 1);
  assert.equal(first.imageReferences[0].path, "images/pic one.png");
  assert.equal(first.imageReferences[0].basename, "pic one.png");
  assert.equal(first.imageReferences[0].token, second.imageReferences[0].token);
  assert.equal(
    first.contentMd.match(/bio-upload:\/\/import-[a-f0-9]+/g)?.length,
    2,
  );
});

test("image-like text in Markdown code and unsupported syntaxes is preserved", () => {
  const source = [
    "`![Inline](inline.png)`",
    "```md",
    "![Fenced](fenced.png)",
    "```",
    "    ![Indented](indented.png)",
    "![[obsidian.png]]",
    '<img src="html.png">',
    "\\![Escaped](escaped.png)",
  ].join("\n");

  assert.deepEqual(rewriteImportedImages(source), {
    contentMd: source,
    imageReferences: [],
  });
});

test("a multiline GFM code span does not import image-like text", () => {
  const source = "`before\n![Literal](inside.png)\nafter`";

  assert.deepEqual(rewriteImportedImages(source), {
    contentMd: source,
    imageReferences: [],
  });
});

test("an indented list continuation imports an image rendered by GFM", () => {
  const source = "- item\n    ![Map](images/map.png)";
  const imported = rewriteImportedImages(source);

  assert.deepEqual(
    imported.imageReferences.map(({ path }) => path),
    ["images/map.png"],
  );
  assert.match(imported.contentMd, /bio-upload:\/\/import-[a-f0-9]+/);
});

test("a blockquote image reference rewrites only its definition destination", () => {
  const source = [
    "> ![Map][map]",
    ">",
    "> [map]: images/map.png",
  ].join("\n");
  const imported = rewriteImportedImages(source);

  assert.deepEqual(
    imported.imageReferences.map(({ path }) => path),
    ["images/map.png"],
  );
  assert.match(imported.contentMd, /^> !\[Map\]\[map\]$/m);
  assert.match(
    imported.contentMd,
    /^> \[map\]: bio-upload:\/\/import-[a-f0-9]+$/m,
  );
});

test("blockquote fenced code preserves image-like text", () => {
  const source = [
    "> ```md",
    "> ![Literal](inside.png)",
    "> ```",
  ].join("\n");

  assert.deepEqual(rewriteImportedImages(source), {
    contentMd: source,
    imageReferences: [],
  });
});

test("an unclosed blockquote fence ends when its container ends", () => {
  const source = [
    "> ```",
    "> ![Literal](inside.png)",
    "outside ![Image](outside.png)",
  ].join("\n");
  const imported = rewriteImportedImages(source);

  assert.deepEqual(
    imported.imageReferences.map(({ path }) => path),
    ["outside.png"],
  );
  assert.match(imported.contentMd, /> !\[Literal\]\(inside\.png\)/);
  assert.match(imported.contentMd, /outside !\[Image\]\(bio-upload:\/\//);
});

test("nested list and blockquote continuations keep code and image contexts distinct", () => {
  const source = [
    "- outer",
    "  - inner",
    "      ![Nested](nested.png)",
    "",
    "> - quoted",
    ">     ![Quoted](quoted.png)",
    "",
    "    ![Root code](root-code.png)",
  ].join("\n");
  const imported = rewriteImportedImages(source);

  assert.deepEqual(
    imported.imageReferences.map(({ path }) => path),
    ["nested.png", "quoted.png"],
  );
  assert.match(imported.contentMd, /    !\[Root code\]\(root-code\.png\)$/m);
});

test("reference definitions work in repeated blockquotes and list containers", () => {
  const source = [
    ">> ![Deep][deep]",
    ">>",
    ">>   [deep]: plates/deep.png",
    "",
    "- ![Plate][plate]",
    "",
    "     [plate]: plates/list.png",
  ].join("\n");
  const imported = rewriteImportedImages(source);

  assert.deepEqual(
    imported.imageReferences.map(({ path }) => path),
    ["plates/deep.png", "plates/list.png"],
  );
  assert.match(imported.contentMd, /^>>   \[deep\]: bio-upload:\/\//m);
  assert.match(imported.contentMd, /^     \[plate\]: bio-upload:\/\//m);
});

test("unsafe local image destinations reject the whole draft", () => {
  const unsafe = [
    "/absolute.png",
    "C:/private/image.png",
    "file:///private/image.png",
    "data:image/png;base64,AAAA",
    "../escape.png",
    "images/%2e%2e/escape.png",
  ];

  for (const path of unsafe) {
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
