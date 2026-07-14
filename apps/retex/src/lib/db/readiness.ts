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
  expectedMigration: 1_784_005_693_799,
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
  },
} as const;

export function resolveAppDatabasePath(): string {
  return resolveDatabasePath(databasePathOptions);
}

export function assertAppDatabaseReady(databasePath = resolveAppDatabasePath()): void {
  assertLiveDatabaseMigrationsCurrent({ ...appDatabaseReadinessOptions, databasePath });
}
