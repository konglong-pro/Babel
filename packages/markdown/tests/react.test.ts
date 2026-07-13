import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MarkdownRenderer } from "@babel-apps/markdown/react";

test("renders resolved and unresolved wikilinks with deterministic classes and typed hrefs", () => {
  const html = renderToStaticMarkup(createElement(MarkdownRenderer, {
    content: "[[Known]] and [[Missing|Create it]]",
    defaultWikilinkKind: "knowledge",
    resolveWikilink: (titleKey: string) => titleKey === "known"
      ? { id: 7, kind: "exercise" }
      : null,
    onNavigateWikilink: () => undefined,
    onCreateFromWikilink: () => undefined,
  }));

  assert.match(
    html,
    /class="wikilink wikilink-resolved" href="babel-note:\/\/exercise\/known"/u,
  );
  assert.match(
    html,
    /class="wikilink wikilink-unresolved" href="babel-note:\/\/knowledge\/missing"/u,
  );
  assert.match(html, />Create it<\/a>/u);
});

test("preserves image previews before wikilink preprocessing", () => {
  const html = renderToStaticMarkup(createElement(MarkdownRenderer, {
    content: "![Draft](esperanto-upload://token-1)\n\n[[Note]]",
    uploadScheme: "esperanto-upload",
    imagePreviews: new Map([["token-1", "blob:preview-1"]]),
    onCreateFromWikilink: () => undefined,
  }));

  assert.match(html, /src="blob:preview-1"/u);
  assert.match(html, /alt="Draft"/u);
  assert.match(html, /loading="lazy"/u);
  assert.match(html, /href="babel-note:\/\/note"/u);
  assert.doesNotMatch(html, /esperanto-upload/u);
});

test("configures GFM by default and math only when requested", () => {
  const gfmHtml = renderToStaticMarkup(createElement(MarkdownRenderer, {
    content: "| A |\n| - |\n| B |",
  }));
  const mathHtml = renderToStaticMarkup(createElement(MarkdownRenderer, {
    content: "$x^2$",
    remarkFeatures: ["math"],
  }));

  assert.match(gfmHtml, /<table>/u);
  assert.match(mathHtml, /class="katex"/u);
});

test("does not allow internal note schemes in image sources or malformed links", () => {
  const html = renderToStaticMarkup(createElement(MarkdownRenderer, {
    content: "![Bad](babel-note://note) [Opaque](babel-note:opaque)",
  }));

  assert.doesNotMatch(html, /src="babel-note:/u);
  assert.doesNotMatch(html, /href="babel-note:/u);
});

test("keeps occurrence-specific raw titles for links sharing one normalized key", () => {
  const html = renderToStaticMarkup(createElement(MarkdownRenderer, {
    content: "[[Foo|First]] and [[ foo |Second]]",
    onCreateFromWikilink: () => undefined,
  }));

  assert.match(html, /data-wikilink-title="Foo"[^>]*>First<\/a>/u);
  assert.match(html, /data-wikilink-title=" foo "[^>]*>Second<\/a>/u);
});
