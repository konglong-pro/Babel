import path from "node:path";

import { resolveDatabasePath } from "@babel-apps/platform/db/client";
import { assertLiveDatabaseMigrationsCurrent } from "@babel-apps/platform/db/readiness";

const databasePathOptions = {
  envVar: "VALI_DATABASE_PATH",
  defaultPath: path.resolve(
    process.cwd(),
    "..",
    "..",
    "data",
    "vali",
    "sqlite.db",
  ),
};

export const appDatabaseReadinessOptions = {
  appName: "Vali",
  packageName: "@babel-apps/vali",
  expectedMigration: 1_790_167_342_629,
  requiredColumns: {
    canvas: ["title", "scene", "updated_at"],
    note: ["parent_id", "position"],
    note_template: ["name", "content_md", "created_at", "updated_at"],
    reflection: ["date", "content_md"],
    note_link: [
      "source_note_id",
      "target_title_key",
      "target_note_id",
      "target_reflection_date",
    ],
    reflection_link: [
      "source_reflection_date",
      "target_title_key",
      "target_note_id",
      "target_reflection_date",
    ],
    document_image: ["note_id", "reflection_date", "image_path"],
    note_search: ["title", "content_md", "tags"],
    reflection_search: ["date", "content_md"],
    folder: ["position"],
    reader_underline: ["id", "source_note_id", "source_reflection_date", "field_key", "color", "anchor_start", "anchor_end", "anchor_exact", "anchor_prefix", "anchor_suffix"],
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
    {
      type: "table",
      name: "reflection_search",
      sqlIncludes: ["USING fts5", "tokenize='trigram'"],
    },
    { type: "trigger", name: "reflection_search_ai" },
    { type: "trigger", name: "reflection_search_ad" },
    { type: "trigger", name: "reflection_search_au" },
  ],
} as const;

export function resolveAppDatabasePath(): string {
  return resolveDatabasePath(databasePathOptions);
}

export function assertAppDatabaseReady(databasePath = resolveAppDatabasePath()): void {
  assertLiveDatabaseMigrationsCurrent({ ...appDatabaseReadinessOptions, databasePath });
}
