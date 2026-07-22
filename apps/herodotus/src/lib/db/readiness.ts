import path from "node:path";

import { resolveDatabasePath } from "@babel-apps/platform/db/client";
import { assertLiveDatabaseMigrationsCurrent } from "@babel-apps/platform/db/readiness";

const databasePathOptions = {
  envVar: "HERODOTUS_DATABASE_PATH",
  defaultPath: path.resolve(
    process.cwd(),
    "..",
    "..",
    "data",
    "herodotus",
    "sqlite.db",
  ),
};

export const appDatabaseReadinessOptions = {
  appName: "Herodotus",
  packageName: "@babel-apps/herodotus",
  expectedMigration: 1_784_684_003_455,
  requiredColumns: {
    note: ["parent_id"],
    note_link: ["source_note_id", "target_title_key", "target_note_id"],
    note_template: ["name", "content_md", "created_at", "updated_at"],
    note_search: ["title", "content_md", "tags"],
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
