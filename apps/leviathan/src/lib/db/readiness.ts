import path from "node:path";

import { resolveDatabasePath } from "@babel-apps/platform/db/client";
import { assertLiveDatabaseMigrationsCurrent } from "@babel-apps/platform/db/readiness";

const databasePathOptions = {
  envVar: "LEVIATHAN_DATABASE_PATH",
  defaultPath: path.resolve(
    process.cwd(),
    "..",
    "..",
    "data",
    "leviathan",
    "sqlite.db",
  ),
};

export const appDatabaseReadinessOptions = {
  appName: "Leviathan",
  packageName: "@babel-apps/leviathan",
  expectedMigration: 1_783_935_760_283,
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
