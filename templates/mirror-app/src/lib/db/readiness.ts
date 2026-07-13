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
  expectedMigration: 1_783_669_000_000,
  requiredColumns: { note: ["parent_id"] },
} as const;

export function resolveAppDatabasePath(): string {
  return resolveDatabasePath(databasePathOptions);
}

export function assertAppDatabaseReady(databasePath = resolveAppDatabasePath()): void {
  assertLiveDatabaseMigrationsCurrent({ ...appDatabaseReadinessOptions, databasePath });
}
