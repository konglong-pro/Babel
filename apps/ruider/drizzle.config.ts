import path from "node:path";

import { defineConfig } from "drizzle-kit";

const configuredDatabasePath = process.env.RUIDER_DATABASE_PATH;
const databasePath =
  configuredDatabasePath === undefined
    ? path.resolve(process.cwd(), "..", "..", "data", "ruider", "sqlite.db")
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
