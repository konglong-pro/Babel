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
  expectedMigration: 1_783_940_858_762,
  requiredColumns: {
    knowledge_note: ["parent_id"],
    note_link: [
      "source_kind",
      "source_id",
      "target_title_key",
      "target_kind",
      "target_id",
    ],
  },
} as const;

export function resolveAppDatabasePath(): string {
  return resolveDatabasePath(databasePathOptions);
}

export function assertAppDatabaseReady(databasePath = resolveAppDatabasePath()): void {
  assertLiveDatabaseMigrationsCurrent({ ...appDatabaseReadinessOptions, databasePath });
}
