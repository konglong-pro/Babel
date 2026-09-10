import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type BetterSqlite3 from "better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import {
  SEARCH_BENCHMARK_PAGE_LIMIT,
  SEARCH_BENCHMARK_FANOUT_QUERY,
  SEARCH_BENCHMARK_RANKING_QUERY,
  SEARCH_BENCHMARK_RECORDS,
  fixedSearchBody,
  restoreEnvironment,
  runSearchBenchmark,
  type BenchmarkSearchResult,
  type NeedlePosition,
} from "./search-benchmark";

interface StandardSearchResult {
  notes: Array<{ id: number }>;
  total: number;
}

export interface StandardNoteSearchBenchmarkOptions {
  app: string;
  workspace: string;
  databaseEnv: string;
  uploadEnv: string;
  migrationsFolder: string;
  importDatabase: () => Promise<{
    databasePath: string;
    db: Parameters<typeof migrate>[0];
    sqlite: BetterSqlite3.Database;
  }>;
  importRepositories: () => Promise<{
    searchNotes: (
      query: string,
      options: { limit: number; offset: number },
    ) => StandardSearchResult;
  }>;
}

export async function runStandardNoteSearchBenchmark(
  options: StandardNoteSearchBenchmarkOptions,
): Promise<void> {
  const previousDatabasePath = process.env[options.databaseEnv];
  const previousUploadDirectory = process.env[options.uploadEnv];
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), `babel-${options.app}-search-benchmark-`),
  );
  const databasePath = path.join(temporaryDirectory, "sqlite.db");
  let sqlite: BetterSqlite3.Database | undefined;

  try {
    process.env[options.databaseEnv] = databasePath;
    process.env[options.uploadEnv] = path.join(temporaryDirectory, "uploads");
    const database = await options.importDatabase();
    sqlite = database.sqlite;
    if (path.resolve(database.databasePath) !== path.resolve(databasePath)) {
      throw new Error("Search benchmark refused to use a non-temporary database.");
    }
    migrate(database.db, { migrationsFolder: options.migrationsFolder });
    seedStandardNotes(sqlite);
    const repositories = await options.importRepositories();
    const rankingQuery = SEARCH_BENCHMARK_RANKING_QUERY;
    const fanoutQuery = SEARCH_BENCHMARK_FANOUT_QUERY;

    await runSearchBenchmark({
      app: options.app,
      workspace: options.workspace,
      entityCounts: { notes: SEARCH_BENCHMARK_RECORDS },
      scenarios: [
        {
          id: "ranking-sparse-8",
          query: rankingQuery,
          expectedTotal: 8,
          run: (query: string) => toBenchmarkResult(
            repositories.searchNotes(query, {
              limit: SEARCH_BENCHMARK_PAGE_LIMIT,
              offset: 0,
            }),
          ),
        },
        {
          id: "body-fanout-50",
          query: fanoutQuery,
          expectedTotal: 50,
          run: (query: string) => toBenchmarkResult(
            repositories.searchNotes(query, {
              limit: SEARCH_BENCHMARK_PAGE_LIMIT,
              offset: 0,
            }),
          ),
        },
      ],
    });
  } finally {
    sqlite?.close();
    await rm(temporaryDirectory, { recursive: true, force: true });
    restoreEnvironment(options.databaseEnv, previousDatabasePath);
    restoreEnvironment(options.uploadEnv, previousUploadDirectory);
  }
}

function seedStandardNotes(
  sqlite: BetterSqlite3.Database,
): void {
  const folder = sqlite
    .prepare("SELECT id FROM folder ORDER BY id LIMIT 1")
    .get() as { id: number } | undefined;
  if (!folder) throw new Error("Search benchmark migration did not seed a folder.");

  const insert = sqlite.prepare(
    "INSERT INTO note (folder_id, title, content_md, tags) VALUES (?, ?, ?, ?)",
  );
  const seed = sqlite.transaction(() => {
    for (let index = 0; index < SEARCH_BENCHMARK_RECORDS; index += 1) {
      const rankingQuery = SEARCH_BENCHMARK_RANKING_QUERY;
      const fanoutQuery = SEARCH_BENCHMARK_FANOUT_QUERY;
      let title = `Synthetic note ${String(index + 1).padStart(5, "0")}`;
      let tags: string[] = ["synthetic"];
      let bodyQuery = "";
      let bodyPosition: NeedlePosition = "none";

      if (index === 0) title = rankingQuery;
      if (index === 1) title = `${rankingQuery} prefix`;
      if (index === 2) title = `Before ${rankingQuery} after`;
      if (index === 3) tags = [rankingQuery];
      if (index === 4) tags = [`topic-${rankingQuery}-more`];
      if (index >= 5 && index <= 7) {
        bodyQuery = rankingQuery;
        bodyPosition = (["start", "middle", "end"] as const)[index - 5]!;
      }
      if (index >= 8 && index < 58) {
        bodyQuery = fanoutQuery;
        bodyPosition = (["start", "middle", "end"] as const)[index % 3]!;
      }
      insert.run(
        folder.id,
        title,
        fixedSearchBody(bodyQuery, bodyPosition),
        JSON.stringify(tags),
      );
    }
  });
  seed();
}

function toBenchmarkResult(result: StandardSearchResult): BenchmarkSearchResult {
  return {
    total: result.total,
    keys: result.notes.map(({ id }) => String(id)),
  };
}
