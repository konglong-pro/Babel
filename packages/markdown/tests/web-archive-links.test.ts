import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownRenderer } from "@babel-apps/markdown/react";

const snapshot = `/api/imports/web-archive/snapshots/${"a".repeat(64)}`;

test("saved original layouts open in a separate window without replacing a notebook page", () => {
  const html = renderToStaticMarkup(createElement(MarkdownRenderer, {
    content: `[View original layout](${snapshot})`,
  }));
  assert.match(html, /target="_blank"/u);
  assert.match(html, /rel="noopener noreferrer"/u);
  assert.match(html, /title="Open saved original layout"/u);
  assert.ok(html.includes(`href="${snapshot}"`));
});

test("only exact local snapshot paths gain the layout-reader behavior", () => {
  for (const destination of [
    `https://example.test${snapshot}`, `//example.test${snapshot}`, `${snapshot}?source=other`,
    "/api/imports/web-archive/snapshots/not-an-id", "/notes", "https://example.test",
  ]) {
    const html = renderToStaticMarkup(createElement(MarkdownRenderer, { content: `[Link](${destination})` }));
    assert.doesNotMatch(html, /target="_blank"|Open saved original layout/u, destination);
  }
});

test("transient original tokens and executable links stay blocked", () => {
  const html = renderToStaticMarkup(createElement(MarkdownRenderer, {
    content: "[Pending original](babel-original://123)\n\n[Unsafe](javascript:alert%281%29)",
  }));
  assert.doesNotMatch(html, /href="(?:babel-original:|javascript:)/u);
  assert.doesNotMatch(html, /target="_blank"/u);
});
