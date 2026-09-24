import path from "node:path";

import { resolveDatabasePath } from "@babel-apps/platform/db/client";
import { assertLiveDatabaseMigrationsCurrent } from "@babel-apps/platform/db/readiness";

const databasePathOptions = {
  envVar: "RUIDER_DATABASE_PATH",
  defaultPath: path.resolve(
    process.cwd(),
    "..",
    "..",
    "data",
    "ruider",
    "sqlite.db",
  ),
};

export const appDatabaseReadinessOptions = {
  appName: "Ruider",
  packageName: "@babel-apps/ruider",
  expectedMigration: 1790167363080,
  requiredColumns: {
    canvas: ["title", "scene", "updated_at"],
    note: ["parent_id", "position"],
    note_link: ["source_note_id", "target_title_key", "target_note_id"],
    note_search: ["title", "content_md", "tags"],
    note_template: ["name", "content_md", "created_at", "updated_at"],
    folder: ["position"],
    reader_underline: ["source_note_id", "field_key", "color", "start_offset", "end_offset", "exact_text", "prefix_text", "suffix_text"],
    reader_underline_note: ["underline_id", "note_id"],
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
