import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type BetterSqlite3 from "better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import {
  SEARCH_BENCHMARK_BODY_BYTES,
  SEARCH_BENCHMARK_FANOUT_QUERY,
  SEARCH_BENCHMARK_PAGE_LIMIT,
  SEARCH_BENCHMARK_RANKING_QUERY,
  SEARCH_BENCHMARK_RECORDS,
  fixedSearchBody,
  restoreEnvironment,
  runSearchBenchmark,
  type NeedlePosition,
} from "../../../scripts/search-benchmark";

const RANKING_QUERY = SEARCH_BENCHMARK_RANKING_QUERY;
const FANOUT_QUERY = SEARCH_BENCHMARK_FANOUT_QUERY;

async function main(): Promise<void> {
const previousDatabasePath = process.env.MATTER_DATABASE_PATH;
const previousUploadDirectory = process.env.MATTER_NOTE_UPLOAD_DIRECTORY;
const temporaryDirectory = await mkdtemp(
  path.join(os.tmpdir(), "babel-matter-search-benchmark-"),
);
const databasePath = path.join(temporaryDirectory, "sqlite.db");
let closeDatabase: (() => void) | undefined;

try {
  process.env.MATTER_DATABASE_PATH = databasePath;
  process.env.MATTER_NOTE_UPLOAD_DIRECTORY = path.join(
    temporaryDirectory,
    "uploads",
    "notes",
  );
  const database = await import("../src/lib/db/client");
  closeDatabase = () => database.sqlite.close();
  if (path.resolve(database.databasePath) !== path.resolve(databasePath)) {
    throw new Error("Search benchmark refused to use a non-temporary database.");
  }
  migrate(database.db, {
    migrationsFolder: path.resolve(import.meta.dirname, "..", "drizzle"),
  });
  seedArchive(database.sqlite);
  const repositories = await import("../src/lib/repositories");

  await runSearchBenchmark({
    app: "matter",
    workspace: "@babel-apps/matter",
    entityCounts: {
      knowledge: SEARCH_BENCHMARK_RECORDS / 2,
      exercises: SEARCH_BENCHMARK_RECORDS / 2,
    },
    scenarios: [
      scenario("ranking-sparse-8", RANKING_QUERY, 8),
      scenario("body-fanout-50", FANOUT_QUERY, 50),
    ],
  });

  function scenario(
    id: "ranking-sparse-8" | "body-fanout-50",
    query: string,
    expectedTotal: number,
  ) {
    return {
      id,
      query,
      expectedTotal,
      limitScope: "per-stream" as const,
      orderScope: "grouped-streams" as const,
      run() {
        const result = repositories.searchArchive(query, {
          limit: SEARCH_BENCHMARK_PAGE_LIMIT,
        });
        return {
          total: result.knowledgeTotal + result.exerciseTotal,
          keys: [
            ...result.knowledge.map(({ id: itemId }) => `knowledge:${itemId}`),
            ...result.exercises.map(({ id: itemId }) => `exercise:${itemId}`),
          ],
        };
      },
    };
  }
} finally {
  closeDatabase?.();
  await rm(temporaryDirectory, { recursive: true, force: true });
  restoreEnvironment("MATTER_DATABASE_PATH", previousDatabasePath);
  restoreEnvironment("MATTER_NOTE_UPLOAD_DIRECTORY", previousUploadDirectory);
}
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

function seedArchive(sqlite: BetterSqlite3.Database): void {
  const perKind = SEARCH_BENCHMARK_RECORDS / 2;
  sqlite
    .prepare("INSERT INTO folder (type, name) VALUES (?, ?), (?, ?)")
    .run(
      "knowledge",
      "Benchmark knowledge",
      "exercise",
      "Benchmark exercises",
    );
  const knowledgeFolder = sqlite
    .prepare("SELECT id FROM folder WHERE type = 'knowledge' ORDER BY id LIMIT 1")
    .get() as { id: number } | undefined;
  const exerciseFolder = sqlite
    .prepare("SELECT id FROM folder WHERE type = 'exercise' ORDER BY id LIMIT 1")
    .get() as { id: number } | undefined;
  if (!knowledgeFolder || !exerciseFolder) {
    throw new Error("Search benchmark migration did not seed both folder types.");
  }
  const insertKnowledge = sqlite.prepare(
    "INSERT INTO knowledge_note (folder_id, title, content_md, tags) VALUES (?, ?, ?, ?)",
  );
  const insertExercise = sqlite.prepare(
    "INSERT INTO exercise (folder_id, title, problem_md, answer_md, solution_md, tags) VALUES (?, ?, ?, ?, ?, ?)",
  );

  sqlite.transaction(() => {
    for (let index = 0; index < perKind; index += 1) {
      let knowledgeTitle = `Synthetic knowledge ${String(index + 1).padStart(5, "0")}`;
      let knowledgeTags: string[] = ["synthetic"];
      let knowledgeBody = fixedSearchBody("", "none");
      if (index === 0) knowledgeTitle = RANKING_QUERY;
      if (index === 1) knowledgeTitle = `${RANKING_QUERY} prefix`;
      if (index === 2) knowledgeTags = [RANKING_QUERY];
      if (index === 3) knowledgeBody = fixedSearchBody(RANKING_QUERY, "middle");
      if (index >= 4 && index < 29) {
        knowledgeBody = fixedSearchBody(
          FANOUT_QUERY,
          (["start", "middle", "end"] as const)[index % 3]!,
        );
      }
      insertKnowledge.run(
        knowledgeFolder.id,
        knowledgeTitle,
        knowledgeBody,
        JSON.stringify(knowledgeTags),
      );

      let exerciseTitle = `Synthetic exercise ${String(index + 1).padStart(5, "0")}`;
      let exerciseTags: string[] = ["synthetic"];
      let exerciseBodies = exerciseBody();
      if (index === 0) exerciseTitle = RANKING_QUERY;
      if (index === 1) exerciseTags = [RANKING_QUERY];
      if (index === 2) exerciseBodies = exerciseBody(RANKING_QUERY, "problem", "start");
      if (index === 3) exerciseBodies = exerciseBody(RANKING_QUERY, "solution", "end");
      if (index >= 4 && index < 29) {
        const field = (["problem", "answer", "solution"] as const)[index % 3]!;
        const position = (["start", "middle", "end"] as const)[index % 3]!;
        exerciseBodies = exerciseBody(FANOUT_QUERY, field, position);
      }
      insertExercise.run(
        exerciseFolder.id,
        exerciseTitle,
        exerciseBodies.problem,
        exerciseBodies.answer,
        exerciseBodies.solution,
        JSON.stringify(exerciseTags),
      );
    }
  })();
}

function exerciseBody(
  query = "",
  field: "problem" | "answer" | "solution" = "problem",
  position: NeedlePosition = "none",
): { problem: string; answer: string; solution: string } {
  const remainingBytes = SEARCH_BENCHMARK_BODY_BYTES - 1;
  if (field === "problem") {
    return {
      problem: fixedSearchBody(query, position, SEARCH_BENCHMARK_BODY_BYTES),
      answer: "",
      solution: "",
    };
  }
  return {
    problem: "x",
    answer: field === "answer"
      ? fixedSearchBody(query, position, remainingBytes)
      : "",
    solution: field === "solution"
      ? fixedSearchBody(query, position, remainingBytes)
      : "",
  };
}
