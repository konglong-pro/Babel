import assert from "node:assert/strict";
import test from "node:test";

import { prepareFormulaMath } from "../src/formula-math";

test("extracts native Typst and explicit LaTeX delimiters", () => {
  const prepared = prepareFormulaMath([
    String.raw`Typst $a_b * c$ and LaTeX \(\frac{a}{b}\).`,
    "",
    String.raw`\[\sum_{i=1}^{n} i\]`,
    "",
    String.raw`$$\begin{bmatrix}a&b\\c&d\end{bmatrix}$$`,
  ].join("\n"));

  assert.deepEqual(
    prepared.occurrences.map(({ engine, source, display, sourceLine, sourceColumn }) => ({
      engine,
      source,
      display,
      sourceLine,
      sourceColumn,
    })),
    [
      {
        engine: "typst",
        source: "a_b * c",
        display: "inline",
        sourceLine: 1,
        sourceColumn: 8,
      },
      {
        engine: "latex",
        source: String.raw`\frac{a}{b}`,
        display: "inline",
        sourceLine: 1,
        sourceColumn: 29,
      },
      {
        engine: "latex",
        source: String.raw`\sum_{i=1}^{n} i`,
        display: "block",
        sourceLine: 3,
        sourceColumn: 3,
      },
      {
        engine: "latex",
        source: String.raw`\begin{bmatrix}a&b\\c&d\end{bmatrix}`,
        display: "block",
        sourceLine: 5,
        sourceColumn: 3,
      },
    ],
  );
  assert.doesNotMatch(prepared.content, /a_b|frac|sum_|bmatrix/u);
});

test("routes recognizable LaTeX inside single dollars to KaTeX compatibility", () => {
  const prepared = prepareFormulaMath([
    String.raw`Half: $\frac{b}{2a}$.`,
    String.raw`Squared: $\left(\frac{b}{2a}\right)^2 = \frac{b^2}{4a^2}$.`,
    String.raw`Braced script: $x_{i+1}^2$.`,
    String.raw`Implicit product: $b^2 - 4ac < 0$.`,
    String.raw`Native Typst stays native: $sum_(i=1)^n i$.`,
  ].join("\n"));

  assert.deepEqual(
    prepared.occurrences.map(({ engine, source, display }) => ({
      engine,
      source,
      display,
    })),
    [
      {
        engine: "latex",
        source: String.raw`\frac{b}{2a}`,
        display: "inline",
      },
      {
        engine: "latex",
        source: String.raw`\left(\frac{b}{2a}\right)^2 = \frac{b^2}{4a^2}`,
        display: "inline",
      },
      {
        engine: "latex",
        source: "x_{i+1}^2",
        display: "inline",
      },
      {
        engine: "latex",
        source: "b^2 - 4ac < 0",
        display: "inline",
      },
      {
        engine: "typst",
        source: "sum_(i=1)^n i",
        display: "inline",
      },
    ],
  );
});

test("keeps standalone single-dollar layout when compatibility selects LaTeX", () => {
  const prepared = prepareFormulaMath(String.raw`$ \frac{a}{b} $`);

  assert.equal(prepared.occurrences[0]?.engine, "latex");
  assert.equal(prepared.occurrences[0]?.display, "block");
});

test("supports multiline LaTeX display formulas", () => {
  const prepared = prepareFormulaMath(String.raw`\[
  \begin{aligned}
  a &= b + c \\
  d &= e + f
  \end{aligned}
\]`);

  assert.equal(prepared.occurrences.length, 1);
  assert.equal(prepared.occurrences[0]?.engine, "latex");
  assert.equal(prepared.occurrences[0]?.display, "block");
  assert.equal(prepared.occurrences[0]?.sourceLine, 2);
  assert.equal(prepared.occurrences[0]?.sourceColumn, 3);
  assert.match(prepared.occurrences[0]?.source ?? "", /begin\{aligned\}/u);
});

test("preserves explicit LaTeX copied from rendered math DOMs", () => {
  const markdown = [
    String.raw`The series is \(\tan x \approx x + \frac{x^3}{3} + \cdots\).`,
    "",
    String.raw`\[`,
    String.raw`\left.\frac{d}{dx}\tan x\right|_{x=0} = 1,`,
    String.raw`\left.\frac{d}{dx}x^3\right|_{x=0} = 0.`,
    String.raw`\]`,
  ].join("\n");
  const prepared = prepareFormulaMath(markdown);

  assert.deepEqual(
    prepared.occurrences.map(({ engine, source, display }) => ({
      engine,
      source,
      display,
    })),
    [
      {
        engine: "latex",
        source: String.raw`\tan x \approx x + \frac{x^3}{3} + \cdots`,
        display: "inline",
      },
      {
        engine: "latex",
        source: [
          String.raw`\left.\frac{d}{dx}\tan x\right|_{x=0} = 1,`,
          String.raw`\left.\frac{d}{dx}x^3\right|_{x=0} = 0.`,
        ].join("\n"),
        display: "block",
      },
    ],
  );
});

test("renders multiline copied TeX only with block delimiters", () => {
  const markdown = [
    String.raw`\[`,
    String.raw`\sin x`,
    String.raw`\underbrace{x}_{\text{main term}}`,
    String.raw`\underbrace{\frac{x^3}{6}}_{\text{correction}}`,
    String.raw`\]`,
  ].join("\n");
  const prepared = prepareFormulaMath(markdown);

  assert.deepEqual(
    prepared.occurrences.map(({ engine, source, display }) => ({
      engine,
      source,
      display,
    })),
    [
      {
        engine: "latex",
        source: [
          String.raw`\sin x`,
          String.raw`\underbrace{x}_{\text{main term}}`,
          String.raw`\underbrace{\frac{x^3}{6}}_{\text{correction}}`,
        ].join("\n"),
        display: "block",
      },
    ],
  );
});

test("preserves source line positions when replacing multiline formulas", () => {
  for (const newline of ["\n", "\r\n"]) {
    const markdown = [
      "# Before",
      "",
      "$$",
      String.raw`\begin{aligned}`,
      "a &= b + c",
      String.raw`\end{aligned}`,
      "$$",
      "",
      "## After",
    ].join(newline);
    const prepared = prepareFormulaMath(markdown);
    const lineOfAfter = (value: string) => {
      return value.slice(0, value.indexOf("## After")).split(/\r\n|\r|\n/u).length;
    };

    assert.equal(lineOfAfter(prepared.content), lineOfAfter(markdown));
    assert.equal(
      (prepared.content.match(/\r\n|\r|\n/gu) ?? []).join(""),
      (markdown.match(/\r\n|\r|\n/gu) ?? []).join(""),
    );
  }
});

test("keeps escaped delimiters and code regions literal", () => {
  const markdown = [
    String.raw`\\(not math\\) and \$not-typst$`,
    "`\\(inline_code\\) $$also_code$$`",
    "```latex",
    String.raw`\[fenced\]`,
    "```",
  ].join("\n");
  const prepared = prepareFormulaMath(markdown);

  assert.equal(prepared.occurrences.length, 0);
  assert.equal(prepared.content, markdown);
});

test("can preserve the legacy Typst-only feature boundary", () => {
  const markdown = String.raw`$x$ $\frac{a}{b}$ \(y\) $$z$$`;
  const prepared = prepareFormulaMath(markdown, { typst: true, latex: false });

  assert.deepEqual(prepared.occurrences.map(({ engine, source }) => ({ engine, source })), [
    { engine: "typst", source: "x" },
    { engine: "typst", source: String.raw`\frac{a}{b}` },
  ]);
  assert.match(prepared.content, /\\\(y\\\) \$\$z\$\$/u);
});

test("shields Markdown and wikilink punctuation inside both engines", () => {
  const prepared = prepareFormulaMath(
    String.raw`$a_b + [[typst]]$ and \(a_b + \text{[[latex]]}\) and *emphasis*`,
  );

  assert.equal(prepared.occurrences[0]?.source, "a_b + [[typst]]");
  assert.equal(prepared.occurrences[1]?.source, String.raw`a_b + \text{[[latex]]}`);
  assert.doesNotMatch(prepared.content, /\[\[(?:typst|latex)\]\]/u);
  assert.match(prepared.content, /and \*emphasis\*/u);
});
