import path from "node:path";

import { defineConfig } from "drizzle-kit";

const configuredDatabasePath = process.env.__APP_ENV_PREFIX___DATABASE_PATH;
const databasePath =
  configuredDatabasePath === undefined
    ? path.resolve(process.cwd(), "..", "..", "data", "__APP_ID__", "sqlite.db")
    : path.resolve(configuredDatabasePath);

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: databasePath,
  },
  strict: true,
  verbose: true,
});
