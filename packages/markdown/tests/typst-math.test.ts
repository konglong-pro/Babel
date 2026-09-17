import assert from "node:assert/strict";
import test from "node:test";

import { prepareTypstMath } from "../src/typst-math";

test("extracts native Typst inline and standalone display delimiters", () => {
  const prepared = prepareTypstMath([
    "Before $a_b * c$ after",
    "",
    "$ sum_(i=1)^n i $",
  ].join("\n"));

  assert.deepEqual(
    prepared.occurrences.map(({ source, display, sourceLine, sourceColumn }) => ({
      source,
      display,
      sourceLine,
      sourceColumn,
    })),
    [
      { source: "a_b * c", display: "inline", sourceLine: 1, sourceColumn: 9 },
      { source: "sum_(i=1)^n i", display: "block", sourceLine: 3, sourceColumn: 3 },
    ],
  );
  assert.doesNotMatch(prepared.content, /a_b|sum_/u);
});

test("keeps escaped dollars, code, fences, and incompatible double dollars literal", () => {
  const markdown = [
    String.raw`\$not-math$`,
    "`$inline_code$`",
    "~~~typst",
    "$ fenced $",
    "~~~",
    "$$legacy$$",
  ].join("\n");
  const prepared = prepareTypstMath(markdown);

  assert.equal(prepared.occurrences.length, 0);
  assert.equal(prepared.content, markdown);
});

test("does not expose Markdown emphasis, underscores, or wikilinks inside formulas", () => {
  const prepared = prepareTypstMath("$a_b * c + [[not-a-link]]$ and *emphasis*");

  assert.equal(prepared.occurrences[0]?.source, "a_b * c + [[not-a-link]]");
  assert.doesNotMatch(prepared.content, /a_b|not-a-link/u);
  assert.match(prepared.content, /and \*emphasis\*/u);
});

test("records the first formula token's exact source line and column", () => {
  const prepared = prepareTypstMath("heading\n  $ bad + #read(\"x\") $");

  assert.equal(prepared.occurrences[0]?.sourceLine, 2);
  assert.equal(prepared.occurrences[0]?.sourceColumn, 5);
});
