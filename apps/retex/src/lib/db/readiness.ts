import path from "node:path";

import { resolveDatabasePath } from "@babel-apps/platform/db/client";
import { assertLiveDatabaseMigrationsCurrent } from "@babel-apps/platform/db/readiness";

const databasePathOptions = {
  envVar: "RETEX_DATABASE_PATH",
  defaultPath: path.resolve(process.cwd(), "..", "..", "data", "retex", "sqlite.db"),
};

export const appDatabaseReadinessOptions = {
  appName: "ReTex",
  packageName: "@babel-apps/retex",
  expectedMigration: 1_785_835_475_578,
  requiredColumns: {
    knowledge_note: ["parent_id"],
    note_link: [
      "source_kind",
      "source_id",
      "target_title_key",
      "target_kind",
      "target_id",
    ],
    note_image: ["source_kind", "source_id", "image_path"],
    exercise: ["problem_md", "answer_md", "solution_md"],
    knowledge_search: ["title", "content_md", "tags"],
    exercise_search: ["title", "problem_md", "answer_md", "solution_md", "tags"],
    folder: ["position"],
  },
  requiredSchemaObjects: [
    {
      type: "table",
      name: "knowledge_search",
      sqlIncludes: [
        "USING fts5",
        "content='knowledge_note'",
        "tokenize='trigram'",
      ],
    },
    { type: "trigger", name: "knowledge_search_ai" },
    { type: "trigger", name: "knowledge_search_ad" },
    { type: "trigger", name: "knowledge_search_au" },
    {
      type: "table",
      name: "exercise_search",
      sqlIncludes: ["USING fts5", "content='exercise'", "tokenize='trigram'"],
    },
    { type: "trigger", name: "exercise_search_ai" },
    { type: "trigger", name: "exercise_search_ad" },
    { type: "trigger", name: "exercise_search_au" },
  ],
} as const;

export function resolveAppDatabasePath(): string {
  return resolveDatabasePath(databasePathOptions);
}

export function assertAppDatabaseReady(databasePath = resolveAppDatabasePath()): void {
  assertLiveDatabaseMigrationsCurrent({ ...appDatabaseReadinessOptions, databasePath });
}
