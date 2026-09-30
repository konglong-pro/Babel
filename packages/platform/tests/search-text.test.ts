import assert from "node:assert/strict";
import test from "node:test";

import {
  countLiteralOccurrences,
  createCodeSnippet,
  createTextSnippet,
  highlightLiteral,
  literalIndexOf,
  literalTextPosition,
} from "../src/search/text";

test("literal search fragments follow SQLite ASCII case behavior and remain plain text", () => {
  assert.equal(literalIndexOf("C++ Étage 🧠", "c++ Étage"), 0);
  assert.equal(literalIndexOf("Étage", "étage"), -1);
  assert.deepEqual(
    highlightLiteral("<script>C++ & C++</script>", "c++"),
    [
      { text: "<script>", highlighted: false },
      { text: "C++", highlighted: true },
      { text: " & ", highlighted: false },
      { text: "C++", highlighted: true },
      { text: "</script>", highlighted: false },
    ],
  );
  assert.deepEqual(highlightLiteral("plain", ""), [
    { text: "plain", highlighted: false },
  ]);
});

test("literal occurrence counts are non-overlapping and ASCII case-insensitive", () => {
  assert.equal(countLiteralOccurrences("C++ c++ C++", "c++"), 3);
  assert.equal(countLiteralOccurrences("aaaaaa", "aa"), 3);
  assert.equal(countLiteralOccurrences("Étage étage", "Étage"), 1);
  assert.equal(countLiteralOccurrences("anything", ""), 0);
});

test("literal text positions count Unicode code points instead of UTF-16 units", () => {
  assert.equal(literalTextPosition("😀😀😀needle", "needle"), 3);
  assert.equal(literalTextPosition("xxxxxneedle", "needle"), 5);
  assert.equal(literalTextPosition("missing", "needle"), -1);
});

test("Markdown snippets fold whitespace, preserve graphemes, and report both cut edges", () => {
  const familyEmoji = "👨‍👩‍👧‍👦";
  const query = `snippet needle ${familyEmoji}`;
  const snippet = createTextSnippet(
    `${"prefix ".repeat(40)}\n\n${query}\n\n${"suffix ".repeat(40)}`,
    query,
  );
  const text = snippet.parts.map((part) => part.text).join("");

  assert.equal(snippet.truncatedStart, true);
  assert.equal(snippet.truncatedEnd, true);
  assert.match(text, /^prefix /);
  assert.match(text, / suffix$/);
  assert.equal(text.includes("\n"), false);
  assert.ok(
    snippet.parts.some(
      (part) => part.highlighted && part.text === query,
    ),
  );
  assert.ok(
    [...new Intl.Segmenter("und", { granularity: "grapheme" }).segment(text)].length
      <= 200,
  );

  const atStart = createTextSnippet(`${query} ${"tail ".repeat(50)}`, query);
  assert.equal(atStart.truncatedStart, false);
  assert.equal(atStart.truncatedEnd, true);
  const atEnd = createTextSnippet(`${"lead ".repeat(50)}${query}`, query);
  assert.equal(atEnd.truncatedStart, true);
  assert.equal(atEnd.truncatedEnd, false);
});

test("code snippets preserve original line endings and include at most three lines", () => {
  const query = "C++ needle";
  const snippet = createCodeSnippet(
    [
      "line zero",
      "line one",
      `const language = \"${query}\";`,
      "line three",
      "line four",
    ].join("\r\n"),
    query,
  );
  const text = snippet.parts.map((part) => part.text).join("");

  assert.equal(snippet.truncatedStart, true);
  assert.equal(snippet.truncatedEnd, true);
  assert.equal(text, `line one\r\nconst language = \"${query}\";\r\nline three`);
  assert.equal(text.split("\r\n").length, 3);
  assert.ok(
    snippet.parts.some(
      (part) => part.highlighted && part.text === query,
    ),
  );
});
