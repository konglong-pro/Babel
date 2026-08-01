import assert from "node:assert/strict";
import test from "node:test";

import {
  appendSearchFocus,
  literalSourceLine,
  searchFocusFromParams,
} from "../src/search/focus";

test("search focus validates fields and round-trips through URL parameters", () => {
  const fields = new Set(["title", "content"] as const);
  assert.deepEqual(
    searchFocusFromParams({ search: " needle ", searchField: "content" }, fields),
    { query: "needle", field: "content" },
  );
  assert.equal(
    searchFocusFromParams({ search: "needle", searchField: "unknown" }, fields),
    null,
  );

  const params = new URLSearchParams({ note: "7" });
  appendSearchFocus(params, { query: "a+b & c", field: "content" });
  assert.equal(params.toString(), "note=7&search=a%2Bb+%26+c&searchField=content");
});

test("literal source lines handle CRLF, LF, and missing matches", () => {
  assert.equal(literalSourceLine("first\r\nsecond\nneedle", "needle"), 3);
  assert.equal(literalSourceLine("missing", "needle"), undefined);
});
