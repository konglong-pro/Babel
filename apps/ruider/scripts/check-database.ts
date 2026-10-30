import path from "node:path";

import { assertDatabaseMigrationsCurrent } from "@babel-apps/platform/db/readiness-snapshot";

import {
  appDatabaseReadinessOptions,
  resolveAppDatabasePath,
} from "../src/lib/db/readiness";

assertDatabaseMigrationsCurrent({
  ...appDatabaseReadinessOptions,
  databasePath: resolveAppDatabasePath(),
  migrationsFolder: path.resolve(process.cwd(), "drizzle"),
});
console.log("Ruider database is ready.");
