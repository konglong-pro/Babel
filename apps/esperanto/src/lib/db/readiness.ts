import path from "node:path";

import { resolveDatabasePath } from "@babel-apps/platform/db/client";
import { assertLiveDatabaseMigrationsCurrent } from "@babel-apps/platform/db/readiness";

const databasePathOptions = {
  envVar: "ESPERANTO_DATABASE_PATH",
  defaultPath: path.resolve(
    process.cwd(),
    "..",
    "..",
    "data",
    "esperanto",
    "sqlite.db",
  ),
};

export const appDatabaseReadinessOptions = {
  appName: "Esperanto",
  packageName: "@babel-apps/esperanto",
  expectedMigration: 1_783_933_005_010,
  requiredColumns: {
    note: ["parent_id"],
    note_link: ["source_note_id", "target_title_key", "target_note_id"],
  },
} as const;

export function resolveAppDatabasePath(): string {
  return resolveDatabasePath(databasePathOptions);
}

export function assertAppDatabaseReady(databasePath = resolveAppDatabasePath()): void {
  assertLiveDatabaseMigrationsCurrent({ ...appDatabaseReadinessOptions, databasePath });
}
