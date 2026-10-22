import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MarkdownRenderer } from "@babel-apps/markdown/react";

test("renders copied table line breaks in headers and formatted cells", () => {
  const variants = ["<br>", "<br/>", "<br />", "<BR>", "<Br/>", "<bR />"];
  const html = renderToStaticMarkup(createElement(MarkdownRenderer, {
    content: [
      "| Heading<br>subtitle |",
      "| --- |",
      ...variants.map((tag) => `| First${tag}**Second** |`),
      "| *Emphasized<br>line* and [linked<br>line](https://example.test) |",
    ].join("\n"),
  }));

  assert.match(html, /<th>Heading<br\/>\nsubtitle<\/th>/u);
  assert.equal((html.match(/<td>First<br\/>\n<strong>Second<\/strong><\/td>/gu) ?? []).length, variants.length);
  assert.match(html, /<em>Emphasized<br\/>\nline<\/em>/u);
  assert.match(html, /<a href="https:\/\/example\.test">linked<br\/>\nline<\/a>/u);
});

test("keeps other HTML, attributes, escaped tags, and breaks outside tables literal", () => {
  const html = renderToStaticMarkup(createElement(MarkdownRenderer, {
    content: [
      "Outside<br>paragraph.",
      "",
      "| Case | Text |",
      "| --- | --- |",
      '| HTML | <strong>literal</strong><script>alert(1)</script><img src="x" onerror="alert(1)"> |',
      '| Attributes | a<br onclick="alert(1)">b<br data-value="x">c |',
      String.raw`| Escaped | a\<br>b &lt;br&gt;c |`,
      "| Other tags | a</br>b<brx>c |",
    ].join("\n"),
  }));

  assert.match(html, /<p>Outside&lt;br&gt;paragraph\.<\/p>/u);
  assert.match(html, /&lt;strong&gt;literal&lt;\/strong&gt;/u);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/u);
  assert.match(html, /&lt;img src=&quot;x&quot; onerror=&quot;alert\(1\)&quot;&gt;/u);
  assert.match(html, /a&lt;br onclick=&quot;alert\(1\)&quot;&gt;b&lt;br data-value=&quot;x&quot;&gt;c/u);
  assert.match(html, /a&lt;br&gt;b &lt;br&gt;c/u);
  assert.match(html, /a&lt;\/br&gt;b&lt;brx&gt;c/u);
  assert.doesNotMatch(html, /<(?:br|brx|script|strong|img)(?:\s|\/?>)/iu);
});

test("preserves table break text inside inline code, fenced code, and both formula engines", () => {
  const html = renderToStaticMarkup(createElement(MarkdownRenderer, {
    content: [
      "```html",
      "First<br>Second",
      "```",
      "",
      "| Code | Typst | LaTeX | Text |",
      "| --- | --- | --- | --- |",
      "| `First<br>Second` | $text(\"<br>\")$ | \\(\\text{<br>}\\) | First<br>Second |",
    ].join("\n"),
    remarkFeatures: ["gfm", "formula-math"],
  }));

  assert.match(html, /<pre[^>]*><code class="language-html">First&lt;br&gt;Second\n<\/code><\/pre>/u);
  assert.match(html, /<td><code>First&lt;br&gt;Second<\/code><\/td>/u);
  assert.match(html, /<code>text\(&quot;&lt;br&gt;&quot;\)<\/code>/u);
  assert.match(html, /<annotation encoding="application\/x-tex">\\text\{&lt;br&gt;\}<\/annotation>/u);
  assert.equal((html.match(/<br\/>/gu) ?? []).length, 1);
  assert.doesNotMatch(html, /data-katex-error="true"/u);
});
