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
  expectedMigration: 1_783_669_000_000,
  requiredColumns: {
    note: ["parent_id"],
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
  },
} as const;

export function resolveAppDatabasePath(): string {
  return resolveDatabasePath(databasePathOptions);
}

export function assertAppDatabaseReady(databasePath = resolveAppDatabasePath()): void {
  assertLiveDatabaseMigrationsCurrent({ ...appDatabaseReadinessOptions, databasePath });
}
