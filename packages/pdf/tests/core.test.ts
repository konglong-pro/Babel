import assert from "node:assert/strict";
import test from "node:test";
import { isPdfRect } from "@babel-apps/platform/pdf/core";
import {
  appendPdfMarkdown, isPdfExcerpt, preparePdfExcerpt, rotatePdfRect, unrotatePdfRect,
  PDF_EXCERPT_MAX_TEXT, pdfExcerptNoteTitle, type PdfExcerpt,
} from "../src/core";

const excerpt: PdfExcerpt = { id: "selection-1", title: "Chemical bonds", page: 3, text: "Carbon forms four bonds." };
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/y9sAAAAASUVORK5CYII=";

test("accepts text and scanned-page excerpts, rejects invalid and oversized messages", () => {
  assert.ok(isPdfExcerpt(excerpt));
  assert.ok(isPdfExcerpt({ ...excerpt, text: "", imageDataUrl: png }));
  for (const change of [
    { id: "../book" }, { title: "" }, { title: "x".repeat(241) }, { page: 0 }, { page: 1.5 },
    { text: " " }, { text: "x".repeat(PDF_EXCERPT_MAX_TEXT + 1) },
    { imageDataUrl: "data:image/svg+xml;base64,PHN2Zy8+" }, { imageDataUrl: "https://example.test/file.png" },
  ]) assert.equal(isPdfExcerpt({ ...excerpt, ...change }), false);
});

test("quotes literal PDF text without activating Markdown, HTML, formulas or wikilinks", async () => {
  const prepared = await preparePdfExcerpt({ ...excerpt, title: "[[Book]]", text: "# Heading\n1. item\n- item\n~~strike~~\n[[Secret]] <img> $math$" }, "carbon-upload");
  assert.equal(prepared.markdown, "> \\# Heading\n> 1\\. item\n> \\- item\n> \\~\\~strike\\~\\~\n> \\[\\[Secret\\]\\] \\<img\\> \\$math\\$\n\n*\\[\\[Book\\]\\] · p. 3*");
  assert.equal(prepared.image, undefined);
});

test("stages PNG bytes as a managed image, keeping the note free of base64 and source links", async () => {
  const prepared = await preparePdfExcerpt({ ...excerpt, text: "", imageDataUrl: png }, "retex-upload");
  assert.ok(prepared.image);
  assert.equal(prepared.image.file.type, "image/png");
  assert.equal(prepared.image.file.name, "pdf-page-3.png");
  assert.equal(prepared.image.previewUrl, png);
  assert.deepEqual([...new Uint8Array(await prepared.image.file.arrayBuffer())].slice(0, 8), [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(prepared.markdown.includes(`retex-upload://${prepared.image.token}`));
  assert.equal(prepared.markdown.includes("base64"), false);
  assert.equal(prepared.markdown.includes("/pdf-reader"), false);
  await assert.rejects(preparePdfExcerpt({ ...excerpt, imageDataUrl: "data:image/png;base64,PHN2Zy8+" }, "carbon-upload"), /PNG/);
  await assert.rejects(preparePdfExcerpt(excerpt, "javascript:"), /scheme/);
});

test("appending preserves every original byte, including hard breaks and trailing blank lines", () => {
  for (const current of ["", "Original", "Hard break  ", "Original\n", "Original\n\n", "Original\n\n\n", "  "]) {
    const result = appendPdfMarkdown(current, " > Selection ");
    assert.ok(result.startsWith(current));
    assert.ok(result.endsWith("> Selection\n"));
    if (current) assert.ok(result.slice(current.length).startsWith("\n") || current.endsWith("\n\n"));
  }
  assert.equal(appendPdfMarkdown("Original\n\n", "Excerpt"), "Original\n\nExcerpt\n");
});

test("HTML excerpts reuse managed note attachments and cite a chapter without PDF page numbers or source links", async () => {
  const html: PdfExcerpt = { ...excerpt, sourceType: "html", location: "Reaction mechanisms", imageDataUrl: png };
  assert.equal(isPdfExcerpt(html), true);
  const prepared = await preparePdfExcerpt(html, "carbon-upload");
  assert.ok(prepared.markdown.includes("Chemical bonds · Reaction mechanisms"));
  assert.equal(prepared.markdown.includes("p. 3"), false);
  assert.equal(prepared.markdown.includes("html-reader"), false);
  assert.equal(prepared.image?.file.name, "html-excerpt.png");
  assert.equal(isPdfExcerpt({ ...html, location: "x".repeat(241) }), false);
  assert.equal(isPdfExcerpt({ ...html, sourceType: "script" }), false);
  assert.equal(isPdfExcerpt({ ...excerpt, location: "Unexpected HTML location" }), false);
  assert.equal(pdfExcerptNoteTitle(html), "Chemical bonds — Reaction mechanisms");
  assert.equal(pdfExcerptNoteTitle(excerpt, " · "), "Chemical bonds · p. 3");
  assert.ok(pdfExcerptNoteTitle({ ...html, title: "x".repeat(240), location: "y".repeat(240) }).length <= 240);
});

test("annotation rectangles survive rotation and page-edge floating point round trips", () => {
  for (const rect of [
    { x: 0.12, y: 0.34, width: 0.25, height: 0.08 },
    { x: 0.9, y: 0.8, width: 0.1, height: 0.2 },
    { x: 0, y: 0, width: 1, height: 1 },
  ]) for (const rotation of [0, 90, 180, 270, -90, 450]) {
    const displayed = rotatePdfRect(rect, rotation);
    assert.ok(isPdfRect(displayed), JSON.stringify({ rect, rotation, displayed }));
    const restored = unrotatePdfRect(displayed, rotation);
    assert.ok(isPdfRect(restored));
    for (const key of ["x", "y", "width", "height"] as const) assert.ok(Math.abs(restored[key] - rect[key]) < 1e-12);
  }
});
