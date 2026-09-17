import { createHash } from "node:crypto";
import os from "node:os";
import { performance } from "node:perf_hooks";

const smokeMode =
  process.env.BABEL_SEARCH_BENCHMARK_SMOKE === "1" ||
  process.argv.includes("--smoke");

export const SEARCH_BENCHMARK_PROFILE = smokeMode
  ? "search-smoke-v2"
  : "search-10k-16k-v2";
export const SEARCH_BENCHMARK_RANKING_QUERY = "BABEL_SEARCH_RANKING_2037";
export const SEARCH_BENCHMARK_FANOUT_QUERY = "BABEL_SEARCH_BODY_FANOUT";
export const SEARCH_BENCHMARK_SHORT_QUERY = "Qz";
export const SEARCH_BENCHMARK_CJK_QUERY = "知识";
export const SEARCH_BENCHMARK_RECORDS = smokeMode ? 100 : 10_000;
export const SEARCH_BENCHMARK_BODY_BYTES = smokeMode ? 1_024 : 16 * 1_024;
export const SEARCH_BENCHMARK_WARMUPS = smokeMode ? 1 : 2;
export const SEARCH_BENCHMARK_RUNS = smokeMode ? 2 : 5;
export const SEARCH_BENCHMARK_PAGE_LIMIT = 50;

export type NeedlePosition = "none" | "start" | "middle" | "end";

export interface BenchmarkSearchResult {
  total: number;
  keys: readonly string[];
}

export interface SearchBenchmarkScenario {
  id: "ranking-sparse-8" | "body-fanout-50" | "short-ascii-fanout-50" | "cjk-fanout-50";
  query: string;
  expectedTotal: number;
  limitScope?: "global" | "per-stream";
  orderScope?: "global-ranked-page" | "grouped-streams";
  run: (query: string) => BenchmarkSearchResult;
}

export interface SearchBenchmarkConfig {
  app: string;
  workspace: string;
  entityCounts: Readonly<Record<string, number>>;
  scenarios: readonly SearchBenchmarkScenario[];
}

export async function runSearchBenchmark(
  config: SearchBenchmarkConfig,
): Promise<void> {
  const expandedScenarios = [...config.scenarios];
  const fanout = config.scenarios.find(({ id }) => id === "body-fanout-50");
  if (fanout !== undefined) {
    expandedScenarios.push(
      { ...fanout, id: "short-ascii-fanout-50", query: SEARCH_BENCHMARK_SHORT_QUERY },
      { ...fanout, id: "cjk-fanout-50", query: SEARCH_BENCHMARK_CJK_QUERY },
    );
  }
  const scenarios = expandedScenarios.map((scenario) =>
    measureScenario(scenario)
  );
  const report = {
    schemaVersion: 1,
    suite: "babel-search",
    profile: SEARCH_BENCHMARK_PROFILE,
    app: config.app,
    workspace: config.workspace,
    generatedAt: new Date().toISOString(),
    revision: process.env.GITHUB_SHA ?? null,
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      logicalCpuCount: os.cpus().length,
    },
    measurement: {
      boundary: "repository",
      warmupRuns: SEARCH_BENCHMARK_WARMUPS,
      measuredRuns: SEARCH_BENCHMARK_RUNS,
    },
    dataset: {
      records: SEARCH_BENCHMARK_RECORDS,
      entityCounts: config.entityCounts,
      targetBodyBytesPerRecord: SEARCH_BENCHMARK_BODY_BYTES,
      searchableBodyBytesTotal:
        SEARCH_BENCHMARK_RECORDS * SEARCH_BENCHMARK_BODY_BYTES,
    },
    scenarios,
  };
  console.log(JSON.stringify(report));
}

export function fixedSearchBody(
  query: string,
  position: NeedlePosition,
  targetBytes = SEARCH_BENCHMARK_BODY_BYTES,
): string {
  if (position === "none") return "x".repeat(targetBytes);
  const queryBytes = Buffer.byteLength(query, "utf8");
  if (queryBytes > targetBytes) {
    throw new Error("Search benchmark query exceeds the body byte target.");
  }
  const remaining = targetBytes - queryBytes;
  const before = position === "start"
    ? 0
    : position === "end"
      ? remaining
      : Math.floor(remaining / 2);
  const padding = (bytes: number) => {
    if (query !== SEARCH_BENCHMARK_FANOUT_QUERY) return "x".repeat(bytes);
    const repeated = `${SEARCH_BENCHMARK_SHORT_QUERY}${SEARCH_BENCHMARK_CJK_QUERY}`;
    const repeatedBytes = Buffer.byteLength(repeated, "utf8");
    return repeated.repeat(Math.floor(bytes / repeatedBytes)) + "x".repeat(bytes % repeatedBytes);
  };
  return `${padding(before)}${query}${padding(remaining - before)}`;
}

export function benchmarkDate(index: number, startYear = 2050): string {
  const date = new Date(Date.UTC(startYear, 0, 1 + index));
  return date.toISOString().slice(0, 10);
}

export function restoreEnvironment(
  name: string,
  value: string | undefined,
): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function measureScenario(scenario: SearchBenchmarkScenario) {
  let referenceKeys: readonly string[] | undefined;
  for (let index = 0; index < SEARCH_BENCHMARK_WARMUPS; index += 1) {
    const result = scenario.run(scenario.query);
    assertScenarioResult(scenario, result);
    referenceKeys = assertStableOrder(scenario, referenceKeys, result.keys);
  }

  const samples: number[] = [];
  const rssBefore = process.memoryUsage().rss;
  let correctness: BenchmarkSearchResult | undefined;
  for (let index = 0; index < SEARCH_BENCHMARK_RUNS; index += 1) {
    const startedAt = performance.now();
    const result = scenario.run(scenario.query);
    samples.push(Number((performance.now() - startedAt).toFixed(3)));
    assertScenarioResult(scenario, result);
    referenceKeys = assertStableOrder(scenario, referenceKeys, result.keys);
    correctness ??= { total: result.total, keys: [...result.keys] };
  }
  const rssAfter = process.memoryUsage().rss;
  const orderedSamples = [...samples].sort((left, right) => left - right);
  const middle = Math.floor(orderedSamples.length / 2);
  const median = orderedSamples.length % 2 === 0
    ? (orderedSamples[middle - 1]! + orderedSamples[middle]!) / 2
    : orderedSamples[middle]!;

  // Generous regression guard for varied CI hardware, not an interactive latency target.
  const medianMsMax = smokeMode ? 1_000 : 5_000;
  if (median > medianMsMax) {
    throw new Error(`${scenario.id} median ${median.toFixed(3)} ms exceeds ${medianMsMax} ms.`);
  }

  return {
    id: scenario.id,
    query: scenario.query,
    requestedLimit: SEARCH_BENCHMARK_PAGE_LIMIT,
    limitScope: scenario.limitScope ?? "global",
    orderScope: scenario.orderScope ?? "global-ranked-page",
    correctness: {
      passed: true,
      totalMatches: correctness!.total,
      returned: correctness!.keys.length,
      orderDigest: `sha256:${
        createHash("sha256").update(correctness!.keys.join("\0")).digest("hex")
      }`,
    },
    timingMs: {
      samples,
      min: orderedSamples[0]!,
      median: Number(median.toFixed(3)),
      max: orderedSamples.at(-1)!,
    },
    memory: {
      rssDeltaBytes: rssAfter - rssBefore,
    },
    thresholds: {
      medianMsMax,
      rssDeltaBytesMax: null,
    },
  };
}

function assertScenarioResult(
  scenario: SearchBenchmarkScenario,
  result: BenchmarkSearchResult,
): void {
  if (result.total !== scenario.expectedTotal) {
    throw new Error(
      `${scenario.id} expected ${scenario.expectedTotal} matches, found ${result.total}.`,
    );
  }
  const expectedReturned = Math.min(
    SEARCH_BENCHMARK_PAGE_LIMIT,
    scenario.expectedTotal,
  );
  if (result.keys.length !== expectedReturned) {
    throw new Error(
      `${scenario.id} expected ${expectedReturned} returned rows, found ${result.keys.length}.`,
    );
  }
  if (new Set(result.keys).size !== result.keys.length) {
    throw new Error(`${scenario.id} returned duplicate result keys.`);
  }
}

function assertStableOrder(
  scenario: SearchBenchmarkScenario,
  reference: readonly string[] | undefined,
  keys: readonly string[],
): readonly string[] {
  if (reference === undefined) return [...keys];
  if (
    reference.length !== keys.length ||
    reference.some((key, index) => key !== keys[index])
  ) {
    throw new Error(`${scenario.id} returned a different order between runs.`);
  }
  return reference;
}
