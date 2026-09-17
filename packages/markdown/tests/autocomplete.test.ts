import assert from "node:assert/strict";
import test from "node:test";

import { findAutocompleteQuery } from "../src/autocomplete";

test("finds the active wikilink query at a collapsed selection", () => {
  assert.deepEqual(findAutocompleteQuery("Before [[Café", 13, 13), {
    openingIndex: 7,
    query: "Café",
  });
  assert.deepEqual(findAutocompleteQuery("[[", 2, 2), {
    openingIndex: 0,
    query: "",
  });
  assert.equal(findAutocompleteQuery("[[Title", 2, 5), null);
});

test("does not autocomplete completed, multiline, escaped, embed, or code links", () => {
  const inlineCode = "`[[inside]]`";
  const cursorInsideCode = inlineCode.indexOf("]]");

  assert.equal(findAutocompleteQuery("[[Done]]", 8, 8), null);
  assert.equal(findAutocompleteQuery("[[line\r\nbreak", 13, 13), null);
  assert.equal(findAutocompleteQuery(String.raw`\[[Literal`, 10, 10), null);
  assert.equal(findAutocompleteQuery("![[image", 8, 8), null);
  assert.equal(findAutocompleteQuery(inlineCode, cursorInsideCode, cursorInsideCode), null);
  assert.equal(findAutocompleteQuery("[[`code`", 8, 8), null);
  assert.equal(findAutocompleteQuery("```\n[[fenced\n```", 13, 13), null);
});
