import assert from "node:assert/strict";
import test from "node:test";

import {
  extractOutline,
  outlineSlugs,
  sourceOffsetToTextareaOffset,
} from "@babel-apps/markdown/outline";

test("extracts ATX and Setext headings with source positions", () => {
  const markdown = [
    "# First",
    "body",
    "Setext **two**",
    "---",
    "> ## Quoted `code` [[Target|label]] ##",
  ].join("\r\n");

  assert.deepEqual(extractOutline(markdown), [
    { level: 1, text: "First", line: 1, offset: 0 },
    { level: 2, text: "body Setext two", line: 2, offset: 9 },
    { level: 2, text: "Quoted code label", line: 5, offset: 36 },
  ]);
});

test("ignores fenced pseudo-headings and honors nested blockquotes", () => {
  const markdown = [
    "```md",
    "# hidden",
    "Hidden setext",
    "---",
    "```",
    "> > # Visible",
    "> Quoted setext",
    "> ===",
  ].join("\n");

  assert.deepEqual(extractOutline(markdown), [
    { level: 1, text: "Visible", line: 6, offset: 37 },
    { level: 1, text: "Quoted setext", line: 7, offset: 51 },
  ]);
});

test("extracts a final heading immediately after a closed fence", () => {
  const markdown = "```\nhidden\n```\n# Visible";
  assert.deepEqual(extractOutline(markdown), [
    { level: 1, text: "Visible", line: 4, offset: 15 },
  ]);
});

test("extracts multiline Setext paragraphs from root and container blocks", () => {
  const markdown = [
    "First **line**",
    "second `line`",
    "---",
    "",
    "> Quoted [[Target|label]]",
    "> continuation",
    "> ===",
    "",
    "- Listed",
    "  continuation",
    "  ---",
  ].join("\n");

  assert.deepEqual(extractOutline(markdown), [
    { level: 2, text: "First line second line", line: 1, offset: 0 },
    {
      level: 1,
      text: "Quoted label continuation",
      line: 5,
      offset: markdown.indexOf("> Quoted"),
    },
    {
      level: 2,
      text: "Listed continuation",
      line: 9,
      offset: markdown.indexOf("- Listed"),
    },
  ]);
});

test("rejects thematic breaks, list items, and indented code as Setext text", () => {
  const markdown = [
    "    code",
    "---",
    "",
    "- item",
    "---",
    "",
    "---",
    "---",
  ].join("\n");

  assert.deepEqual(extractOutline(markdown), []);
});

test("does not treat link reference definitions as Setext heading text", () => {
  const markdown = [
    "[single]: /docs 'Single title'",
    "---",
    "",
    "[multiline]:",
    "  /docs/multiline",
    "  \"Multiline title\"",
    "---",
    "",
    "[before-heading]: /docs/heading",
    "Visible heading",
    "---",
    "",
    "- [listed]: /docs/listed",
    "  Listed heading",
    "  ---",
  ].join("\n");

  assert.deepEqual(extractOutline(markdown), [
    {
      level: 2,
      text: "Visible heading",
      line: 10,
      offset: markdown.indexOf("Visible heading"),
    },
    {
      level: 2,
      text: "Listed heading",
      line: 14,
      offset: markdown.indexOf("  Listed heading"),
    },
  ]);
});

test("keeps an incomplete link reference candidate available as Setext text", () => {
  assert.deepEqual(extractOutline("[missing]:\n---"), [
    { level: 2, text: "[missing]:", line: 1, offset: 0 },
  ]);
});

test("preserves visible autolinks and literal emphasis delimiters in labels", () => {
  const markdown = [
    "# Visit <https://example.test/a_b> or <person@example.test>",
    "## snake_case and 2 * 3 with *emphasis* and **strong**",
    "### <span>Raw tag</span>",
  ].join("\n");

  assert.deepEqual(extractOutline(markdown), [
    {
      level: 1,
      text: "Visit https://example.test/a_b or person@example.test",
      line: 1,
      offset: 0,
    },
    {
      level: 2,
      text: "snake_case and 2 * 3 with emphasis and strong",
      line: 2,
      offset: markdown.indexOf("## snake_case"),
    },
    {
      level: 3,
      text: "Raw tag",
      line: 3,
      offset: markdown.indexOf("### <span>"),
    },
  ]);
});

test("preserves crossing literal delimiters and non-HTML angle text", () => {
  const markdown = "# *foo _bar* baz_\n## 1 < 2 > 0";
  assert.deepEqual(extractOutline(markdown), [
    { level: 1, text: "foo _bar baz_", line: 1, offset: 0 },
    {
      level: 2,
      text: "1 < 2 > 0",
      line: 2,
      offset: markdown.indexOf("## 1"),
    },
  ]);
});

test("extracts ATX headings inside list and blockquote containers", () => {
  const markdown = [
    "- # Item heading",
    "  - ## Nested heading",
    "> - ### Quoted list heading",
  ].join("\n");

  assert.deepEqual(extractOutline(markdown), [
    { level: 1, text: "Item heading", line: 1, offset: 0 },
    {
      level: 2,
      text: "Nested heading",
      line: 2,
      offset: markdown.indexOf("  - ##"),
    },
    {
      level: 3,
      text: "Quoted list heading",
      line: 3,
      offset: markdown.indexOf("> - ###"),
    },
  ]);
});

test("ignores pseudo-headings in tilde fences", () => {
  const markdown = "~~~md\n# hidden\nHidden setext\n---\n~~~\n# Visible";
  assert.deepEqual(extractOutline(markdown), [
    { level: 1, text: "Visible", line: 6, offset: markdown.indexOf("# Visible") },
  ]);
});

test("ignores pseudo-headings inside multiline formulas", () => {
  const markdown = [
    "# First",
    String.raw`\[`,
    "# Formula ATX",
    "Formula setext",
    "---",
    String.raw`\]`,
    "# Real",
  ].join("\n");

  assert.deepEqual(extractOutline(markdown), [
    { level: 1, text: "First", line: 1, offset: 0 },
    {
      level: 1,
      text: "Real",
      line: 7,
      offset: markdown.indexOf("# Real"),
    },
  ]);
});

test("generates stable Unicode slugs with duplicate suffixes", () => {
  const outline = extractOutline("# Hello, 世界!\n## Hello 世界\n### !!!\n#### !!!");
  assert.deepEqual(outlineSlugs(outline), [
    "hello-世界",
    "hello-世界-1",
    "section",
    "section-1",
  ]);
});

test("maps source offsets to the textarea's normalized line endings", () => {
  const markdown = "# First\r\nbody\r\n## Target";
  const sourceOffset = markdown.indexOf("## Target");

  assert.equal(
    sourceOffsetToTextareaOffset(markdown, sourceOffset),
    "# First\nbody\n".length,
  );
  assert.equal(sourceOffsetToTextareaOffset(markdown, -1), 0);
  assert.equal(
    sourceOffsetToTextareaOffset(markdown, markdown.length + 10),
    markdown.replace(/\r\n/gu, "\n").length,
  );
});
