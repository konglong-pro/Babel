import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import { countLiteralOccurrences, highlightLiteral } from "../packages/platform/src/search/text";

// Dense matches expose repeated whole-string folding that sparse search misses.
const body = "Ab".repeat(4_096);
const samples: number[] = [];
for (let index = 0; index < 7; index += 1) {
  const start = performance.now();
  const count = countLiteralOccurrences(body, "a");
  const parts = highlightLiteral(body, "a");
  const elapsed = performance.now() - start;
  assert.equal(count, 4_096);
  assert.equal(parts.filter(({ highlighted }) => highlighted).length, 4_096);
  assert.equal(parts.map(({ text }) => text).join(""), body);
  if (index >= 2) samples.push(elapsed);
}
samples.sort((left, right) => left - right);
const medianMs = samples[2]!;
const medianMsMax = 100;
assert.ok(medianMs <= medianMsMax, `Dense text search took ${medianMs.toFixed(3)} ms; limit ${medianMsMax} ms.`);
console.log(JSON.stringify({ suite: "babel-search-text", profile: "dense-ascii-8k-v1",
  characters: body.length, matches: 4_096, medianMs: Number(medianMs.toFixed(3)), medianMsMax }));
