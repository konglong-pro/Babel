import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { TypstFormula } from "../src/react";

test("renders safe accessible source while the lazy worker is loading", () => {
  const html = renderToStaticMarkup(createElement(TypstFormula, {
    source: "x < y",
    display: "inline",
    sourceLine: 3,
    sourceColumn: 8,
  }));

  assert.match(html, /class="typst-formula typst-formula-inline"/u);
  assert.match(html, /aria-busy="true"/u);
  assert.match(html, /<code>x &lt; y<\/code>/u);
  assert.doesNotMatch(html, /<svg|dangerouslySetInnerHTML/u);
});
