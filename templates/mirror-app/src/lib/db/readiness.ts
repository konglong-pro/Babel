import path from "node:path";

import { resolveDatabasePath } from "@babel-apps/platform/db/client";
import { assertLiveDatabaseMigrationsCurrent } from "@babel-apps/platform/db/readiness";

const databasePathOptions = {
  envVar: "__APP_ENV_PREFIX___DATABASE_PATH",
  defaultPath: path.resolve(
    process.cwd(),
    "..",
    "..",
    "data",
    "__APP_ID__",
    "sqlite.db",
  ),
};

export const appDatabaseReadinessOptions = {
  appName: "__APP_NAME__",
  packageName: "@babel-apps/__APP_ID__",
  expectedMigration: 1_785_835_547_912,
  requiredColumns: {
    folder: ["position"],
    note: ["parent_id"],
    note_link: ["source_note_id", "target_title_key", "target_note_id"],
    note_search: ["title", "content_md", "tags"],
    note_template: ["name", "content_md", "created_at", "updated_at"],
  },
  requiredSchemaObjects: [
    {
      type: "table",
      name: "note_search",
      sqlIncludes: ["USING fts5", "content='note'", "tokenize='trigram'"],
    },
    { type: "trigger", name: "note_search_ai" },
    { type: "trigger", name: "note_search_ad" },
    { type: "trigger", name: "note_search_au" },
  ],
} as const;

export function resolveAppDatabasePath(): string {
  return resolveDatabasePath(databasePathOptions);
}

export function assertAppDatabaseReady(databasePath = resolveAppDatabasePath()): void {
  assertLiveDatabaseMigrationsCurrent({ ...appDatabaseReadinessOptions, databasePath });
}
