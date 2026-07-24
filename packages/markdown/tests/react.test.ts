import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  DetachedReaderWindow,
  MarkdownEditor,
  MarkdownRenderer,
  OutlinePanel,
  detachedReaderWindowFeatures,
  detachedReaderWindowName,
} from "@babel-apps/markdown/react";

test("normalizes stable detached reader window names", () => {
  assert.equal(
    detachedReaderWindowName("  Leviathan / note:42  "),
    "babel-reader-Leviathan-note-42",
  );
  assert.equal(detachedReaderWindowName("***"), "babel-reader-document");
});

test("opens detached readers with normal browser window controls", () => {
  assert.equal(
    detachedReaderWindowFeatures(),
    "popup=no,width=1040,height=860,resizable=yes,scrollbars=yes",
  );
});

test("renders an accessible detached reader control without inline content", () => {
  const html = renderToStaticMarkup(createElement(
    DetachedReaderWindow,
    {
      title: "Draft note — Reader",
      windowKey: "note-42",
      buttonLabel: "Read",
    },
    createElement("p", null, "Detached content"),
  ));

  assert.match(html, /type="button"/u);
  assert.match(html, /data-babel-command="read"/u);
  assert.match(html, /title="Open a live reading window"/u);
  assert.match(html, />Read<\/button>/u);
  assert.doesNotMatch(html, /Detached content/u);
});

test("renders hidden fallback markup when a portal target is configured", () => {
  const html = renderToStaticMarkup(createElement(
    DetachedReaderWindow,
    {
      title: "Draft note - Reader",
      windowKey: "note-42",
      buttonLabel: "Read",
      buttonPortalTargetId: "note-reader-trigger",
    },
    createElement("p", null, "Detached content"),
  ));

  assert.match(html, /class="babel-detached-reader-fallback"/u);
  assert.match(html, /data-babel-command="read"/u);
  assert.match(html, />Read<\/button>/u);
  assert.doesNotMatch(html, /Detached content/u);
});

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

test("renders an unresolved managed image as a placeholder without an empty source", () => {
  const html = renderToStaticMarkup(createElement(MarkdownRenderer, {
    content: "![Babel seal](herodotus-upload://import-token)",
    uploadScheme: "herodotus-upload",
  }));

  assert.match(html, /class="markdown-image-pending"/u);
  assert.match(html, /Image awaiting file: Babel seal/u);
  assert.doesNotMatch(html, /<img/u);
  assert.doesNotMatch(html, /src=""/u);
});

test("configures GFM by default and native Typst math only when requested", () => {
  const gfmHtml = renderToStaticMarkup(createElement(MarkdownRenderer, {
    content: "| A |\n| - |\n| B |",
  }));
  const mathHtml = renderToStaticMarkup(createElement(MarkdownRenderer, {
    content: "$x^2$",
    remarkFeatures: ["typst-math"],
  }));

  assert.match(gfmHtml, /<table>/u);
  assert.match(mathHtml, /class="typst-formula typst-formula-inline"/u);
  assert.match(mathHtml, /data-typst-display="inline"/u);
  assert.match(mathHtml, /<code>x\^2<\/code>/u);
  assert.doesNotMatch(mathHtml, /katex/u);
});

test("renders standalone spaced dollars as a Typst display formula", () => {
  const html = renderToStaticMarkup(createElement(MarkdownRenderer, {
    content: "Before\n\n$ sum_(i=1)^n i $\n\nAfter",
    remarkFeatures: ["typst-math"],
  }));

  assert.match(html, /class="typst-formula typst-formula-block"/u);
  assert.match(html, /data-typst-display="block"/u);
  assert.match(html, /<code>sum_\(i=1\)\^n i<\/code>/u);
});

test("renders explicit Typst and LaTeX formulas through separate engines", () => {
  const html = renderToStaticMarkup(createElement(MarkdownRenderer, {
    content: String.raw`Typst $x^2$ and LaTeX \(\frac{x}{2}\).`,
    remarkFeatures: ["formula-math"],
  }));

  assert.match(html, /class="typst-formula typst-formula-inline"/u);
  assert.match(html, /data-typst-display="inline"/u);
  assert.match(html, /data-formula-engine="latex"/u);
  assert.match(html, /data-katex-display="inline"/u);
  assert.match(html, /class="katex"/u);
  assert.match(html, /<math/u);
});

test("renders traditional single-dollar LaTeX commands through KaTeX", () => {
  const html = renderToStaticMarkup(createElement(MarkdownRenderer, {
    content: [
      String.raw`Half: $\frac{b}{2a}$.`,
      String.raw`Squared: $\left(\frac{b}{2a}\right)^2 = \frac{b^2}{4a^2}$.`,
      String.raw`Discriminant: $b^2 - 4ac < 0$.`,
      String.raw`Root: $x + \frac{b}{2a} = \frac{\pm\sqrt{\b^2 - 4ac}}{2a}$.`,
      String.raw`Native Typst: $sum_(i=1)^n i$.`,
    ].join("\n\n"),
    remarkFeatures: ["formula-math"],
  }));

  assert.equal((html.match(/data-formula-engine="latex"/gu) ?? []).length, 4);
  assert.equal((html.match(/class="katex"/gu) ?? []).length, 4);
  assert.match(html, /class="typst-formula typst-formula-inline"/u);
  assert.doesNotMatch(html, /data-katex-error="true"/u);
});

test("renders double dollars and bracket delimiters as LaTeX display formulas", () => {
  const html = renderToStaticMarkup(createElement(MarkdownRenderer, {
    content: String.raw`$$\sum_{i=1}^{n} i$$

\[\frac{a}{b}\]`,
    remarkFeatures: ["formula-math"],
  }));

  assert.equal((html.match(/data-katex-display="block"/gu) ?? []).length, 2);
  assert.equal((html.match(/class="katex-display"/gu) ?? []).length, 2);
  assert.doesNotMatch(html, /aria-busy="true"/u);
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

test("uses outline slugs for demoted heading ids", () => {
  const html = renderToStaticMarkup(createElement(MarkdownRenderer, {
    content: "# Same\n## Same\n### 世界",
    headingIdPrefix: "note-",
  }));

  assert.match(html, /<h2 id="note-same">Same<\/h2>/u);
  assert.match(html, /<h3 id="note-same-1">Same<\/h3>/u);
  assert.match(html, /<h4 id="note-世界">世界<\/h4>/u);
});

test("keeps multiline and container heading ids aligned with the outline", () => {
  const html = renderToStaticMarkup(createElement(MarkdownRenderer, {
    content: "First **line**\nsecond line\n---\n\n- # Nested heading",
  }));

  assert.match(html, /<h3 id="first-line-second-line">First <strong>line<\/strong>\nsecond line<\/h3>/u);
  assert.match(html, /<h2 id="nested-heading">Nested heading<\/h2>/u);
});

test("keeps autolink and literal-delimiter heading ids aligned with the outline", () => {
  const html = renderToStaticMarkup(createElement(MarkdownRenderer, {
    content: [
      "# Visit <https://example.test/a_b> or <person@example.test>",
      "## snake_case and 2 * 3 with *emphasis*",
    ].join("\n"),
  }));

  assert.match(
    html,
    /<h2 id="visit-httpsexampletesta_b-or-personexampletest">Visit <a href="https:\/\/example\.test\/a_b">https:\/\/example\.test\/a_b<\/a> or <a href="mailto:person@example\.test">person@example\.test<\/a><\/h2>/u,
  );
  assert.match(
    html,
    /<h3 id="snake_case-and-2-3-with-emphasis">snake_case and 2 \* 3 with <em>emphasis<\/em><\/h3>/u,
  );
});

test("keeps crossing delimiters and literal angle text aligned with rendered headings", () => {
  const html = renderToStaticMarkup(createElement(MarkdownRenderer, {
    content: "# *foo _bar* baz_\n## 1 < 2 > 0",
  }));

  assert.match(html, /<h2 id="foo-_bar-baz_"><em>foo _bar<\/em> baz_<\/h2>/u);
  assert.match(html, /<h3 id="1-2-0">1 &lt; 2 &gt; 0<\/h3>/u);
});

test("keeps task checkboxes read-only unless an editor callback is present", () => {
  const readHtml = renderToStaticMarkup(createElement(MarkdownRenderer, {
    content: "- [ ] Todo",
  }));
  const editHtml = renderToStaticMarkup(createElement(MarkdownRenderer, {
    content: "- [x] Todo",
    onToggleTask: () => undefined,
  }));

  assert.match(readHtml, /<input[^>]*type="checkbox"[^>]*disabled=""/u);
  assert.match(editHtml, /<input[^>]*type="checkbox"[^>]*data-source-line="1"/u);
  assert.match(editHtml, /<input[^>]*checked=""/u);
  assert.doesNotMatch(editHtml, /disabled=""/u);
});

test("enables task writeback when a loose list nests its checkbox in a paragraph", () => {
  const html = renderToStaticMarkup(createElement(MarkdownRenderer, {
    content: "- [ ] Todo\n\n  Supporting paragraph.",
    onToggleTask: () => undefined,
  }));

  assert.match(html, /<li[^>]*task-list-item[^>]*>\s*<p><input[^>]*type="checkbox"[^>]*data-source-line="1"/u);
  assert.doesNotMatch(html, /<input[^>]*disabled=""/u);
});

test("renders the complete editor and outline without a live preview", () => {
  const editorHtml = renderToStaticMarkup(createElement(MarkdownEditor, {
    label: "Content",
    name: "contentMd",
    value: "# Heading",
    onChange: () => undefined,
    uploadScheme: "test-upload",
    imagePreviews: new Map(),
    onStageImage: () => undefined,
    onImageError: () => undefined,
  }));
  const outlineHtml = renderToStaticMarkup(createElement(OutlinePanel, {
    content: "# Heading\n## Child",
    mode: "read",
  }));

  assert.match(editorHtml, /aria-label="Markdown formatting"/u);
  assert.match(editorHtml, /aria-label="Bold"/u);
  assert.match(editorHtml, /aria-keyshortcuts="Control\+B Meta\+B"/u);
  assert.match(editorHtml, /aria-keyshortcuts="Control\+I Meta\+I"/u);
  assert.match(editorHtml, />Add image<\/button>/u);
  assert.match(editorHtml, /<textarea[^>]*name="contentMd"[^>]*># Heading<\/textarea>/u);
  assert.doesNotMatch(editorHtml, /Live preview/u);
  assert.doesNotMatch(editorHtml, /preview-pane/u);
  assert.doesNotMatch(editorHtml, /class="markdown-body"/u);
  assert.doesNotMatch(editorHtml, /<h2 id="heading">Heading<\/h2>/u);
  assert.match(outlineHtml, /class="outline-panel"/u);
  assert.match(outlineHtml, />Heading<\/button>/u);
  assert.match(outlineHtml, /class="outline-level-2"/u);
});

test("retains preview-only props without rendering preview content", () => {
  const html = renderToStaticMarkup(createElement(MarkdownEditor, {
    label: "Content",
    name: "contentMd",
    value: "[[Missing]]",
    onChange: () => undefined,
    defaultWikilinkKind: "knowledge",
    onCreateFromWikilink: () => undefined,
  }));

  assert.match(html, /<textarea[^>]*>\[\[Missing\]\]<\/textarea>/u);
  assert.doesNotMatch(html, /data-wikilink-kind/u);
  assert.doesNotMatch(html, /babel-note:/u);
});

test("disables the textarea without rendering preview actions", () => {
  const html = renderToStaticMarkup(createElement(MarkdownEditor, {
    label: "Content",
    name: "contentMd",
    value: "[[Missing]]",
    onChange: () => undefined,
    disabled: true,
    onCreateFromWikilink: () => undefined,
  }));

  assert.match(html, /<textarea[^>]*disabled=""/u);
  assert.doesNotMatch(html, /class="wikilink/u);
  assert.doesNotMatch(html, /preview/u);
});
