import path from "node:path";

import { createDatabase } from "@babel-apps/platform/db/client";

import * as schema from "@/lib/db/schema";

const database = createDatabase({
  envVar: "MATTER_DATABASE_PATH",
  defaultPath: path.resolve(process.cwd(), "..", "..", "data", "matter", "sqlite.db"),
  schema,
});

export const databasePath = database.databasePath;
export const db = database.db;
export const sqlite = database.sqlite;
