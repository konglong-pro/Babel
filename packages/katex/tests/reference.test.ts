import assert from "node:assert/strict";
import test from "node:test";

import { renderKatexFormula } from "../src/core";
import {
  KATEX_REFERENCE_VERSION,
  KATEX_VERSION,
  katexMathReferenceGroups,
  katexMathReferenceRows,
} from "../src/reference";

test("publishes a structured versioned reference with renderable examples", () => {
  assert.equal(KATEX_VERSION, "0.16.22");
  assert.equal(KATEX_REFERENCE_VERSION, "katex-0.16.22");
  assert.ok(katexMathReferenceGroups.length >= 5);
  assert.ok(katexMathReferenceRows.length >= 20);
  assert.equal(new Set(katexMathReferenceRows.map(({ id }) => id)).size, katexMathReferenceRows.length);

  const failures = katexMathReferenceRows
    .filter((row) => !renderKatexFormula({
      source: row.example,
      display: row.display ?? "inline",
    }).ok)
    .map((row) => row.id);
  assert.deepEqual(failures, []);
});
