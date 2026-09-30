import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownRenderer } from "@babel-apps/markdown/react";
import { ReaderImageZoom, fitReaderImage, clampReaderImageZoom } from "../src/reader-image-zoom";

test("reader images are keyboard accessible without changing the image or its surrounding link", () => {
  const content = '[![Diagram](/api/notes/1/images/diagram.png "Caption")](https://example.com/source)';
  const html = renderToStaticMarkup(createElement(ReaderImageZoom, null,
    createElement(MarkdownRenderer, { content }),
  ));
  assert.match(html, /href="https:\/\/example.com\/source"/u);
  assert.match(html, /src="\/api\/notes\/1\/images\/diagram.png"/u);
  assert.match(html, /alt="Diagram"/u);
  assert.match(html, /role="button"/u);
  assert.match(html, /tabindex="0"/u);
  assert.match(html, /aria-haspopup="dialog"/u);
  assert.match(html, /aria-label="Zoom image: Diagram"/u);
  assert.match(html, /title="Caption — Click to zoom"/u);
  assert.doesNotMatch(html, /<dialog/u);
});

test("ordinary Markdown previews do not opt into reader image controls", () => {
  const html = renderToStaticMarkup(createElement(MarkdownRenderer, { content: "![Diagram](/diagram.png)" }));
  assert.match(html, /loading="lazy"/u);
  assert.doesNotMatch(html, /babel-reader-image|role="button"|tabindex|Click to zoom/u);
});

test("readers zoom resolved draft blobs but preserve missing-image and canvas placeholders", () => {
  const html = renderToStaticMarkup(createElement(ReaderImageZoom, null,
    createElement(MarkdownRenderer, {
      content: "![Draft](test-upload://found)\n\n![Missing](test-upload://missing)\n\n![[canvas:12|Map]]",
      uploadScheme: "test-upload",
      imagePreviews: new Map([["found", "blob:existing-preview"]]),
    }),
  ));
  assert.match(html, /src="blob:existing-preview"/u);
  assert.equal((html.match(/aria-haspopup="dialog"/gu) ?? []).length, 1);
  assert.match(html, /Image awaiting file: Missing/u);
  assert.match(html, /data-canvas-id="12"/u);
});

test("blocked image URLs cannot become interactive zoom triggers", () => {
  const html = renderToStaticMarkup(createElement(ReaderImageZoom, null,
    createElement(MarkdownRenderer, { content: "![Bad](javascript:alert)" }),
  ));
  assert.doesNotMatch(html, /aria-haspopup|role="button"|javascript:/u);
});

test("fit preserves aspect ratio, allows tiny fits, and never enlarges small images", () => {
  assert.equal(fitReaderImage({ width: 2000, height: 1000 }, { width: 1048, height: 748 }), 0.5);
  assert.equal(fitReaderImage({ width: 100, height: 100 }, { width: 1048, height: 748 }), 1);
  assert.equal(fitReaderImage({ width: 1000, height: 20000 }, { width: 1048, height: 1048 }), 0.05);
  assert.equal(fitReaderImage({ width: 0, height: 0 }, { width: 1048, height: 748 }), 1);
  assert.ok(fitReaderImage({ width: 1000, height: 1000 }, { width: 0, height: 0 }) > 0);
});

test("zoom is bounded without preventing a very large image from fitting", () => {
  assert.equal(clampReaderImageZoom(20, 0.5), 8);
  assert.equal(clampReaderImageZoom(0.01, 0.5), 0.1);
  assert.equal(clampReaderImageZoom(0.01, 0.025), 0.025);
  assert.equal(clampReaderImageZoom(1, 0.025), 1);
});
