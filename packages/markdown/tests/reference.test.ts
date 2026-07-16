import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  typstMathReferenceGroups,
  typstMathReferenceRows,
} from "@babel-apps/typst/reference";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  MarkdownWritingGuidePanel,
  ReferencePanelTriggers,
  TypstReferencePanel,
  markdownWritingGuideGroups,
  markdownWritingGuideRows,
} from "@babel-apps/markdown/reference";

test("publishes a concise English Markdown guide for supported Babel syntax", () => {
  assert.deepEqual(
    markdownWritingGuideGroups.map((group) => group.title),
    [
      "Headings",
      "Text",
      "Lists",
      "Blocks",
      "Links",
      "Media",
      "Tables",
      "Code",
      "Typst Math",
    ],
  );
  assert.ok(markdownWritingGuideRows.some((row) => row.syntax === "[[Note Title]]"));
  assert.ok(markdownWritingGuideRows.some((row) => row.syntax === "Paste, drop, or Add image"));
  assert.ok(markdownWritingGuideRows.some((row) => row.syntax === "```js\ncode\n```"));
  assert.ok(markdownWritingGuideRows.some((row) => row.syntax === "$x^2 + y^2$"));
  assert.doesNotMatch(
    JSON.stringify(markdownWritingGuideGroups),
    /[\u3400-\u9fff]/u,
  );
});

test("renders the Markdown guide with exactly Category, Syntax, and Usage columns", () => {
  const html = renderToStaticMarkup(createElement(MarkdownWritingGuidePanel, {
    onClose: () => undefined,
  }));
  const header = html.match(/<thead>(.*?)<\/thead>/u)?.[1] ?? "";

  assert.match(html, /role="dialog"/u);
  assert.match(html, /aria-modal="false"/u);
  assert.match(html, />Markdown Writing Guide<\/h2>/u);
  assert.match(html, />All categories<\/option>/u);
  assert.match(html, new RegExp(`>${markdownWritingGuideRows.length} rules<`, "u"));
  assert.match(
    html,
    /class="reference-board__table-wrap" role="region" aria-label="Markdown guide table" tabindex="0"/u,
  );
  assert.equal((html.match(/<tbody>/gu) ?? []).length, markdownWritingGuideGroups.length);
  assert.equal((header.match(/<th\b/gu) ?? []).length, 3);
  assert.match(header, />Category<\/th>/u);
  assert.match(header, />Syntax<\/th>/u);
  assert.match(header, />Usage<\/th>/u);
  assert.doesNotMatch(header, />Preview<\/th>/u);
});

test("renders the complete English Typst reference with lazy preview placeholders", () => {
  const html = renderToStaticMarkup(createElement(TypstReferencePanel, {
    onClose: () => undefined,
  }));

  assert.match(html, />Typst Formula Reference<\/h2>/u);
  assert.match(html, />Example source<\/th>/u);
  assert.match(html, />Preview<\/th>/u);
  assert.match(html, />Notes<\/th>/u);
  assert.match(html, new RegExp(`>${typstMathReferenceRows.length} rules<`, "u"));
  assert.match(
    html,
    /class="reference-board__table-wrap" role="region" aria-label="Typst formula reference table" tabindex="0"/u,
  );
  assert.equal((html.match(/<tbody>/gu) ?? []).length, typstMathReferenceGroups.length);
  assert.match(html, /class="reference-board__preview"><span aria-hidden="true">…<\/span>/u);
  assert.doesNotMatch(html, /aria-busy="true"/u);
  assert.doesNotMatch(html, /[\u3400-\u9fff]/u);
});

test("renders shared English triggers with accessible panel relationships", () => {
  const html = renderToStaticMarkup(createElement(ReferencePanelTriggers, {
    activePanel: "markdown",
    onOpenMarkdown: () => undefined,
    onOpenTypst: () => undefined,
    markdownPanelId: "markdown-panel",
    typstPanelId: "typst-panel",
  }));

  assert.match(html, /role="group" aria-label="Writing references"/u);
  assert.match(
    html,
    /aria-controls="markdown-panel" aria-expanded="true">Markdown Guide<\/button>/u,
  );
  assert.match(
    html,
    /aria-controls="typst-panel" aria-expanded="false">Typst Reference<\/button>/u,
  );
});

test("keeps desktop notebook panels pinned while a reference board overlays the first two columns", () => {
  const css = readFileSync(
    new URL("../src/reference.css", import.meta.url),
    "utf8",
  );

  assert.match(
    css,
    /\.notes-workspace\s*>\s*\.folder-panel,[\s\S]*?grid-column:\s*1;[\s\S]*?grid-row:\s*1;/u,
  );
  assert.match(
    css,
    /\.notes-workspace\s*>\s*\.note-panel,[\s\S]*?grid-column:\s*2;[\s\S]*?grid-row:\s*1;/u,
  );
  assert.match(
    css,
    /\.notes-workspace\s*>\s*\.detail-panel,[\s\S]*?grid-column:\s*3;[\s\S]*?grid-row:\s*1;/u,
  );
  assert.match(
    css,
    /\.entries-workspace\s*>\s*\.entry-panel[\s\S]*?grid-column:\s*2;[\s\S]*?grid-row:\s*1;/u,
  );
  assert.match(
    css,
    /@media\s*\(max-width:\s*1100px\)[\s\S]*?\.archive-workspace\s*>\s*\.reference-board[\s\S]*?height:\s*36dvh;/u,
  );
  assert.match(
    css,
    /@media\s*\(max-width:\s*1099px\)[\s\S]*?\.notes-workspace\s*>\s*\.reference-board,[\s\S]*?height:\s*36dvh;/u,
  );
  assert.match(
    css,
    /@media\s*\(max-width:\s*760px\)[\s\S]*?\.notes-workspace\s*>\s*\.reference-board,[\s\S]*?position:\s*absolute;[\s\S]*?inset:\s*0;[\s\S]*?height:\s*100%;/u,
  );
  assert.match(
    css,
    /\.babel-reader-title-button\s*\{[\s\S]*?display:\s*inline-flex;[\s\S]*?margin:\s*0 0 0\.65rem;/u,
  );
});
