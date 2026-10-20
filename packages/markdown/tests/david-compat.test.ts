import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MarkdownRenderer } from "@babel-apps/markdown/react";

test("renders the synthetic David export with roles, math, nested code, tables, tasks and literal text intact", async () => {
  const markdown = await readFile(new URL("./fixtures/david-conversation.md", import.meta.url), "utf8");
  const html = renderToStaticMarkup(createElement(MarkdownRenderer, {
    content: markdown, remarkFeatures: ["gfm", "formula-math"],
  }));

  assert.match(html, /<h3[^>]*>User<\/h3>/u);
  assert.match(html, /<h3[^>]*>Assistant<\/h3>/u);
  assert.match(html, /<h4[^>]*>Format fixture<\/h4>/u);
  assert.match(html, /Literal cost \$5 and \$10\. &lt;br&gt; &lt;script&gt;literal&lt;\/script&gt; \*\*plain\*\* \[\[literal\]\]/u);
  assert.match(html, /<annotation encoding="application\/x-tex">x_1 \+ \\frac\{a\}\{b\}<\/annotation>/u);
  assert.match(html, /<annotation encoding="application\/x-tex">\|a\| \+ \\\|b\\\|<\/annotation>/u);
  assert.match(html, /<ol start="9">/u);
  assert.match(html, /<code class="language-python">first = 1\n\ntext = &quot;```&quot;\n<\/code>/u);
  assert.match(html, /<code class="language-js"> {2}keepIndent\(\);\nnext\(\);\n<\/code>/u);
  assert.match(html, /<td>First<br\/>\nSecond<\/td>/u);
  assert.match(html, /<td>&lt;br&gt; &amp; &lt;b&gt;literal&lt;\/b&gt;<\/td>/u);
  assert.match(html, /<td>left \| right and <code>a\|b<\/code><\/td>/u);
  assert.match(html, /type="checkbox"[^>]*checked=""/u);
  assert.equal((html.match(/type="checkbox"/gu) ?? []).length, 2);
  assert.match(html, /href="https:\/\/example\.invalid\/a\(b\)\?signed=1&amp;v=two%20words"/u);
  assert.match(html, /src="https:\/\/example\.invalid\/user\(a\)\.png\?key=1&amp;v=2"/u);
  assert.ok(html.includes('alt="Remote [image]"'), "Literal image brackets must not become formula markers.");
  assert.ok(html.includes("[Image unavailable: Local image]"));
  assert.ok(!html.includes("\uE000formula"), "Formula placeholders must never leak into text or image attributes.");
  assert.match(html, /<code class="language-mermaid">graph TD\n {2}A--&gt;B\n<\/code>/u);
  assert.doesNotMatch(html, /data-katex-error="true"|<script\b|babel-note:\/\/|href="javascript:/u);
});
