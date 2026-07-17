import assert from "node:assert/strict";
import test from "node:test";

import {
  SEARCH_BENCHMARK_BODY_BYTES,
  benchmarkDate,
  fixedSearchBody,
} from "./search-benchmark";

test("search benchmark bodies preserve their byte target and requested position", () => {
  const query = "BABEL_SEARCH_NEEDLE";
  for (const position of ["none", "start", "middle", "end"] as const) {
    const body = fixedSearchBody(query, position);
    assert.equal(Buffer.byteLength(body, "utf8"), SEARCH_BENCHMARK_BODY_BYTES);
    assert.equal(body.includes(query), position !== "none");
    if (position === "start") assert.equal(body.startsWith(query), true);
    if (position === "end") assert.equal(body.endsWith(query), true);
  }
});

test("search benchmark dates are deterministic and sortable", () => {
  assert.equal(benchmarkDate(0), "2050-01-01");
  assert.equal(benchmarkDate(1), "2050-01-02");
  assert.ok(benchmarkDate(10) > benchmarkDate(2));
});
