import path from "node:path";

import { runMigrations } from "@babel-apps/platform/db/migrate";

import { db, sqlite } from "../src/lib/db/client";

runMigrations({
  appName: "Leviathan",
  db,
  sqlite,
  migrationsFolder: path.resolve(process.cwd(), "drizzle"),
});
