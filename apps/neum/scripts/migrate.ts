import path from "node:path";

import { runMigrations } from "@babel-apps/platform/db/migrate";

import { getNeumDatabase } from "../src/lib/db/client";

const { db, sqlite } = getNeumDatabase();

runMigrations({
  appName: "Neum",
  db,
  sqlite,
  migrationsFolder: path.resolve(process.cwd(), "drizzle"),
});
