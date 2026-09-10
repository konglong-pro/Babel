import path from "node:path";

import { createDatabase } from "@babel-apps/platform/db/client";

import * as schema from "@/lib/db/schema";

const database = createDatabase({
  envVar: "RUIDER_DATABASE_PATH",
  defaultPath: path.resolve(
    process.cwd(),
    "..",
    "..",
    "data",
    "ruider",
    "sqlite.db",
  ),
  schema,
  busyTimeoutMs: 5000,
});

export const databasePath = database.databasePath;
export const db = database.db;
export const sqlite = database.sqlite;
