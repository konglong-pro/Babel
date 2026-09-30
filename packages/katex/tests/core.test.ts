import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultKatexRuntimeConfig,
  renderKatexFormula,
} from "../src/core";

test("renders accessible HTML and MathML with bounded safe defaults", () => {
  const result = renderKatexFormula({
    source: String.raw`\frac{x^2}{2}`,
    display: "block",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.html, /class="katex-display"/u);
  assert.match(result.html, /class="katex-mathml"/u);
  assert.match(result.html, /<math/u);
  assert.match(result.html, /class="katex-html" aria-hidden="true"/u);
});

test("rejects invalid and oversized formula sources with localized diagnostics", () => {
  const invalid = renderKatexFormula({
    source: String.raw`\frac{`,
    sourceLine: 4,
    sourceColumn: 7,
  });
  const oversized = renderKatexFormula({
    source: "x".repeat(defaultKatexRuntimeConfig.maxSourceLength + 1),
  });

  assert.equal(invalid.ok, false);
  assert.equal(invalid.diagnostics[0]?.sourceLine, 4);
  assert.equal(invalid.diagnostics[0]?.sourceColumn, 7);
  assert.match(invalid.diagnostics[0]?.message ?? "", /parse error|expected|end of input/iu);
  assert.equal(oversized.ok, false);
  assert.match(oversized.diagnostics[0]?.message ?? "", /exceeds/u);
});

test("recovers a stray backslash before an undefined one-letter variable", () => {
  const recovered = renderKatexFormula({
    source: String.raw`x + \frac{b}{2a} = \frac{\pm\sqrt{\b^2 - 4ac}}{2a}`,
    sourceLine: 3,
    sourceColumn: 5,
  });
  const unknownCommand = renderKatexFormula({
    source: String.raw`\bogus + x`,
  });

  assert.equal(recovered.ok, true);
  if (!recovered.ok) return;
  assert.match(recovered.html, /\\sqrt\{b\^2 - 4ac\}/u);
  assert.doesNotMatch(recovered.html, /\\b\^2/u);
  assert.deepEqual(recovered.diagnostics, [{
    severity: "warning",
    message: String.raw`Treated undefined \b as the variable b.`,
    sourceLine: 3,
    sourceColumn: 5,
  }]);
  assert.equal(unknownCommand.ok, false);
  assert.match(unknownCommand.diagnostics[0]?.message ?? "", /undefined control sequence/iu);
});

test("does not create trusted HTML or executable links", () => {
  const result = renderKatexFormula({
    source: String.raw`\href{javascript:alert(1)}{unsafe}\htmlClass{owned}{x}`,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.doesNotMatch(result.html, /<a\b|\shref=/iu);
  assert.doesNotMatch(result.html, /class="owned"|<script/iu);
  assert.match(result.html, /<annotation encoding="application\/x-tex">/u);
});
