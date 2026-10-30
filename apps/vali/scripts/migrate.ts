import path from "node:path";

import { runMigrations } from "@babel-apps/platform/db/migrate";

import { db, sqlite } from "../src/lib/db/client";

runMigrations({
  appName: "Vali",
  db,
  sqlite,
  migrationsFolder: path.resolve(process.cwd(), "drizzle"),
});
