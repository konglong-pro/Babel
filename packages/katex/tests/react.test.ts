import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { KatexFormula } from "../src/react";

test("renders synchronous KaTeX markup with engine and display metadata", () => {
  const html = renderToStaticMarkup(createElement(KatexFormula, {
    source: String.raw`\frac{x}{2}`,
    display: "block",
  }));

  assert.match(html, /class="babel-formula babel-formula-block katex-formula katex-formula-block"/u);
  assert.match(html, /data-formula-engine="latex"/u);
  assert.match(html, /data-katex-display="block"/u);
  assert.match(html, /class="katex-display"/u);
  assert.match(html, /<math/u);
});

test("escapes invalid formula source in the error fallback", () => {
  const html = renderToStaticMarkup(createElement(KatexFormula, {
    source: String.raw`\frac{<script>`,
    sourceLine: 2,
    sourceColumn: 5,
  }));

  assert.match(html, /data-katex-error="true"/u);
  assert.match(html, /<code>\\frac\{&lt;script&gt;<\/code>/u);
  assert.doesNotMatch(html, /<script>/u);
  assert.match(html, /Line 2, column 5:/u);
});

test("keeps inline and block formulas moderately sized", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

  assert.match(css, /\.katex-formula-inline\s*\{\s*font-size:\s*0\.96em;/u);
  assert.match(css, /\.katex-formula-block\s*\{\s*font-size:\s*1\.15em;/u);
});
