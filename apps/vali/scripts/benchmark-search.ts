import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import {
  SEARCH_BENCHMARK_PAGE_LIMIT,
  SEARCH_BENCHMARK_FANOUT_QUERY,
  SEARCH_BENCHMARK_RANKING_QUERY,
  SEARCH_BENCHMARK_RECORDS,
  benchmarkDate,
  fixedSearchBody,
  restoreEnvironment,
  runSearchBenchmark,
} from "../../../scripts/search-benchmark";

const RANKING_QUERY = SEARCH_BENCHMARK_RANKING_QUERY;
const FANOUT_QUERY = SEARCH_BENCHMARK_FANOUT_QUERY;

async function main(): Promise<void> {
const previousDatabasePath = process.env.VALI_DATABASE_PATH;
const previousUploadDirectory = process.env.VALI_UPLOAD_DIRECTORY;
const temporaryDirectory = await mkdtemp(
  path.join(os.tmpdir(), "babel-vali-search-benchmark-"),
);
const databasePath = path.join(temporaryDirectory, "sqlite.db");
let closeDatabase: (() => void) | undefined;

try {
  process.env.VALI_DATABASE_PATH = databasePath;
  process.env.VALI_UPLOAD_DIRECTORY = path.join(temporaryDirectory, "uploads");
  const database = await import("../src/lib/db/client");
  closeDatabase = () => database.sqlite.close();
  if (path.resolve(database.databasePath) !== path.resolve(databasePath)) {
    throw new Error("Search benchmark refused to use a non-temporary database.");
  }
  migrate(database.db, {
    migrationsFolder: path.resolve(import.meta.dirname, "..", "drizzle"),
  });
  seedDocuments(database.sqlite);
  const repositories = await import("../src/lib/repositories");

  await runSearchBenchmark({
    app: "vali",
    workspace: "@babel-apps/vali",
    entityCounts: {
      notes: SEARCH_BENCHMARK_RECORDS / 2,
      reflections: SEARCH_BENCHMARK_RECORDS / 2,
    },
    scenarios: [
      {
        id: "ranking-sparse-8",
        query: RANKING_QUERY,
        expectedTotal: 8,
        run: () => {
          const result = repositories.searchDocuments(RANKING_QUERY, {
            limit: SEARCH_BENCHMARK_PAGE_LIMIT,
            offset: 0,
          });
          return {
            total: result.total,
            keys: result.results.map((item) =>
              item.kind === "note" ? `note:${item.id}` : `reflection:${item.date}`
            ),
          };
        },
      },
      {
        id: "body-fanout-50",
        query: FANOUT_QUERY,
        expectedTotal: 50,
        run: () => {
          const result = repositories.searchDocuments(FANOUT_QUERY, {
            limit: SEARCH_BENCHMARK_PAGE_LIMIT,
            offset: 0,
          });
          return {
            total: result.total,
            keys: result.results.map((item) =>
              item.kind === "note" ? `note:${item.id}` : `reflection:${item.date}`
            ),
          };
        },
      },
    ],
  });
} finally {
  closeDatabase?.();
  await rm(temporaryDirectory, { recursive: true, force: true });
  restoreEnvironment("VALI_DATABASE_PATH", previousDatabasePath);
  restoreEnvironment("VALI_UPLOAD_DIRECTORY", previousUploadDirectory);
}
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

function seedDocuments(sqlite: import("better-sqlite3").Database): void {
  const perKind = SEARCH_BENCHMARK_RECORDS / 2;
  const folder = sqlite
    .prepare("SELECT id FROM folder ORDER BY id LIMIT 1")
    .get() as { id: number } | undefined;
  if (!folder) throw new Error("Search benchmark migration did not seed a folder.");
  const insertNote = sqlite.prepare(
    "INSERT INTO note (folder_id, title, content_md, tags) VALUES (?, ?, ?, ?)",
  );
  const insertReflection = sqlite.prepare(
    "INSERT INTO reflection (date, content_md) VALUES (?, ?)",
  );

  sqlite.transaction(() => {
    for (let index = 0; index < perKind; index += 1) {
      let title = `Synthetic note ${String(index + 1).padStart(5, "0")}`;
      let tags: string[] = ["synthetic"];
      let body = fixedSearchBody("", "none");
      if (index === 0) title = RANKING_QUERY;
      if (index === 1) title = `${RANKING_QUERY} prefix`;
      if (index === 2) tags = [RANKING_QUERY];
      if (index === 3) body = fixedSearchBody(RANKING_QUERY, "middle");
      if (index >= 4 && index < 29) {
        body = fixedSearchBody(FANOUT_QUERY, (["start", "middle", "end"] as const)[index % 3]!);
      }
      insertNote.run(folder.id, title, body, JSON.stringify(tags));

      const date = benchmarkDate(index);
      let reflectionBody = fixedSearchBody("", "none");
      if (index <= 3) {
        reflectionBody = fixedSearchBody(
          RANKING_QUERY,
          (["start", "middle", "end", "middle"] as const)[index]!,
        );
      }
      if (index >= 4 && index < 29) {
        reflectionBody = fixedSearchBody(
          FANOUT_QUERY,
          (["start", "middle", "end"] as const)[index % 3]!,
        );
      }
      insertReflection.run(date, reflectionBody);
    }
  })();
}
