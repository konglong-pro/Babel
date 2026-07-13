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
  expectedMigration: 1_783_911_803_345,
  requiredColumns: { note: ["parent_id"] },
} as const;

export function resolveAppDatabasePath(): string {
  return resolveDatabasePath(databasePathOptions);
}

export function assertAppDatabaseReady(databasePath = resolveAppDatabasePath()): void {
  assertLiveDatabaseMigrationsCurrent({ ...appDatabaseReadinessOptions, databasePath });
}
