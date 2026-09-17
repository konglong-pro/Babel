import assert from "node:assert/strict";
import test from "node:test";

import {
  collectRankedSearchPage,
  normalizeSearchPage,
  trigramFtsQuery,
} from "../src/search/page";

test("search pagination normalizes invalid and oversized inputs", () => {
  assert.deepEqual(normalizeSearchPage(), { limit: 50, offset: 0 });
  assert.deepEqual(normalizeSearchPage({ limit: 0, offset: -1 }), {
    limit: 50,
    offset: 0,
  });
  assert.deepEqual(normalizeSearchPage({ limit: 1_000, offset: 12 }), {
    limit: 100,
    offset: 12,
  });
});

test("ranked search pages retain only the requested prefix and preserve ties", () => {
  const page = collectRankedSearchPage(
    [
      { id: 1, score: 2 },
      { id: 2, score: 1 },
      { id: 3, score: 1 },
      { id: 4, score: 3 },
    ],
    (row) => row,
    (left, right) => left.score - right.score || left.id - right.id,
    { limit: 2, offset: 1 },
  );

  assert.deepEqual(page, {
    items: [
      { id: 3, score: 1 },
      { id: 1, score: 2 },
    ],
    total: 4,
    limit: 2,
    offset: 1,
  });
});

test("trigram candidates are used only for safe queries of at least three characters", () => {
  assert.equal(trigramFtsQuery("abc"), '"abc"');
  assert.equal(trigramFtsQuery("古罗马"), '"古罗马"');
  assert.equal(trigramFtsQuery("ab"), undefined);
  assert.equal(trigramFtsQuery('a"b'), undefined);
  assert.equal(trigramFtsQuery("a\\b"), undefined);
});
