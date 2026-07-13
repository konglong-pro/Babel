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
  expectedMigration: 1_783_911_773_028,
  requiredColumns: { knowledge_note: ["parent_id"] },
} as const;

export function resolveAppDatabasePath(): string {
  return resolveDatabasePath(databasePathOptions);
}

export function assertAppDatabaseReady(databasePath = resolveAppDatabasePath()): void {
  assertLiveDatabaseMigrationsCurrent({ ...appDatabaseReadinessOptions, databasePath });
}
