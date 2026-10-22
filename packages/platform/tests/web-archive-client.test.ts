import assert from "node:assert/strict";
import test from "node:test";

import { CLIPBOARD_MARKDOWN_MAX_BYTES } from "../src/imports/clipboard-client";
import { WEB_ARCHIVE_MAX_BYTES, type WebArchive } from "../src/imports/web-archive-core";
import {
  prepareWebArchiveImport,
  readWebArchiveFile,
  webArchiveDraftImages,
  webArchiveImportTitle,
} from "../src/imports/web-archive-client";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jwX8AAAAASUVORK5CYII=";
function capture(): WebArchive {
  return {
    format: "babel.web-archive", version: 1, title: "Captured conversation",
    markdown: "## Assistant\n\n![Diagram](assets/diagram.png)\n\nCaption with $x^2$.",
    assets: [{ id: "diagram", name: "diagram.png", mimeType: "image/png", dataBase64: png }],
    snapshot: { tree: { tag: "article", children: [{ tag: "img", attrs: { src: "babel-asset://diagram", alt: "Diagram" } }] }, width: 640, background: "#ffffff" },
    warnings: ["An interactive control was captured as a static image."],
  };
}

test("archive review validates file size, extension, UTF-8 and archive structure without a network request", async context => {
  const fetch = context.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected upload before Save"); });
  assert.deepEqual(await readWebArchiveFile(new File([JSON.stringify(capture())], "capture.BABEL.JSON")), capture());
  await assert.rejects(readWebArchiveFile(new File(["{}"], "capture.json")), /\.babel\.json/u);
  await assert.rejects(readWebArchiveFile(new File([], "capture.babel.json")), /empty/u);
  const file = new File(["{}"], "capture.babel.json");
  Object.defineProperty(file, "size", { value: WEB_ARCHIVE_MAX_BYTES + 1 });
  const read = context.mock.method(file, "arrayBuffer", async () => { throw new Error("Oversized data must not be read"); });
  await assert.rejects(readWebArchiveFile(file), /150 MiB/u);
  assert.equal(read.mock.callCount(), 0);
  await assert.rejects(readWebArchiveFile(new File([new Uint8Array([0xff])], "capture.babel.json")));
  await assert.rejects(readWebArchiveFile(new File(["{}"], "capture.babel.json")));
  assert.equal(fetch.mock.callCount(), 0);
});

test("prepared Markdown retains a separately immutable original and decoded source images", async context => {
  const fetch = context.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected upload before Save"); });
  const source = capture();
  const prepared = prepareWebArchiveImport(source, { title: "Reviewed title", markdown: "![Kept](assets/diagram.png)\n\nEdited notes." });
  assert.equal(prepared.file.name, "Reviewed title.md");
  assert.equal(prepared.original.kind, "web-archive");
  assert.equal(prepared.original.file.type, "application/json");
  assert.deepEqual(JSON.parse(await prepared.original.file.text()), source);
  assert.equal(await prepared.file.text(), `![Kept](assets/diagram.png)\n\nEdited notes.\n\n[View original layout](babel-original://${prepared.original.token})\n`);
  assert.match(prepared.original.token, /^[a-f0-9-]{36}$/iu);
  const urls = context.mock.method(URL, "createObjectURL", () => "blob:synthetic");
  const images = webArchiveDraftImages(prepared.file, [
    { path: "assets/diagram.png", token: "managed-token" },
    { path: "elsewhere/diagram.png", token: "do-not-match-basename" },
  ])!;
  assert.equal(images.length, 1);
  assert.equal(images[0].token, "managed-token");
  assert.equal(images[0].previewUrl, "blob:synthetic");
  assert.equal(images[0].file.name, "diagram.png");
  assert.equal(images[0].file.type, "image/png");
  assert.equal(Buffer.from(await images[0].file.arrayBuffer()).toString("base64"), png);
  assert.equal(urls.mock.callCount(), 1);
  assert.equal(fetch.mock.callCount(), 0);
});

test("unreferenced archive assets and ordinary Markdown do not allocate preview URLs", context => {
  const urls = context.mock.method(URL, "createObjectURL", () => "blob:unexpected");
  assert.equal(webArchiveDraftImages(new File(["![local](assets/diagram.png)"], "ordinary.md"), [{ path: "assets/diagram.png", token: "token" }]), undefined);
  assert.deepEqual(webArchiveDraftImages(prepareWebArchiveImport(capture()).file, []), []);
  assert.equal(urls.mock.callCount(), 0);
});

test("failed preview allocation revokes every earlier URL and leaves the source reusable", context => {
  const { file } = prepareWebArchiveImport(capture());
  let count = 0;
  const create = context.mock.method(URL, "createObjectURL", () => {
    if (++count === 2) throw new Error("Cannot allocate a preview");
    return "blob:first";
  });
  const revoke = context.mock.method(URL, "revokeObjectURL", () => undefined);
  const references = [{ path: "assets/diagram.png", token: "first" }, { path: "assets/diagram.png", token: "second" }];
  assert.throws(() => webArchiveDraftImages(file, references), /Cannot allocate/u);
  assert.deepEqual(revoke.mock.calls.map(call => call.arguments[0]), ["blob:first"]);
  create.mock.mockImplementation(() => "blob:retry");
  assert.equal(webArchiveDraftImages(file, references)?.length, 2);
});

test("reviewed title and appended snapshot link share the note's complete size boundary", () => {
  assert.equal(webArchiveImportTitle("  A/B\\C\nD  "), "A B C D");
  assert.equal(webArchiveImportTitle("😀".repeat(200)), "😀".repeat(120));
  for (const title of ["", "../note", "a\\b", "a\nname", "x".repeat(241)]) {
    assert.throws(() => prepareWebArchiveImport(capture(), { title }), /title/u);
  }
  assert.throws(() => prepareWebArchiveImport(capture(), { markdown: "x".repeat(CLIPBOARD_MARKDOWN_MAX_BYTES) }), /10 MiB/u);
  assert.doesNotThrow(() => prepareWebArchiveImport(capture(), { markdown: "" }), "A visual-only archive may still open its original snapshot.");
});

test("archive images respect the notebook's actual combined save budget before allocating previews", async context => {
  const urls = context.mock.method(URL, "createObjectURL", () => "blob:budget-preview");
  const { file, original } = prepareWebArchiveImport(capture());
  const reference = { path: "assets/diagram.png", token: "managed-token" };
  const contentMd = `![Diagram](test-upload://${reference.token})\n\n[View original layout](babel-original://${original.token})\n`;
  const persisted = `![Diagram](/api/uploads/notes/00000000-0000-0000-0000-000000000000.webp)\n\n[View original layout](/api/imports/web-archive/snapshots/${"0".repeat(64)})\n`;
  const markdownBytes = new TextEncoder().encode(persisted).byteLength;
  const imageBytes = Buffer.from(png, "base64").byteLength;
  const budget = {
    contentMd, maxMarkdownBytes: markdownBytes, maxImages: 50, maxImageBytes: 10 * 1024 * 1024,
    maxSaveBytes: markdownBytes + imageBytes, imageScheme: "test-upload", imageUrlPrefix: "/api/uploads/notes/",
  };
  assert.throws(() => webArchiveDraftImages(file, [reference], { ...budget, maxSaveBytes: budget.maxSaveBytes - 1 }), /combined Markdown and referenced-image save limit/u);
  assert.throws(() => webArchiveDraftImages(file, [reference], { ...budget, maxMarkdownBytes: markdownBytes - 1 }), /Markdown limit after saving/u);
  assert.throws(() => webArchiveDraftImages(file, [reference], { ...budget, maxImages: 0 }), /0-image save limit/u);
  assert.throws(() => webArchiveDraftImages(file, [reference], { ...budget, maxImageBytes: 1 }), /image limit/u);
  assert.equal(urls.mock.callCount(), 0, "A rejected archive must stay in review without allocating object URLs.");
  assert.equal(webArchiveDraftImages(file, [reference], budget)?.length, 1, "Exactly fitting final links and image bytes remain importable.");
  assert.equal(urls.mock.callCount(), 1);

  const snapshotOnly = prepareWebArchiveImport(capture(), { markdown: "" });
  const snapshotMarkdown = await snapshotOnly.file.text();
  const finalBytes = new TextEncoder().encode(snapshotMarkdown.replace(`babel-original://${snapshotOnly.original.token}`, `/api/imports/web-archive/snapshots/${"0".repeat(64)}`)).byteLength;
  assert.deepEqual(webArchiveDraftImages(snapshotOnly.file, [], { ...budget, contentMd: snapshotMarkdown, maxMarkdownBytes: finalBytes, maxSaveBytes: finalBytes }), []);
  assert.equal(JSON.parse(await snapshotOnly.original.file.text()).assets.length, 1, "Snapshot-only visuals remain embedded in the immutable capture.");
});
