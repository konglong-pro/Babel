import path from "node:path";

import {
  createDatabase,
  type DatabaseClient,
} from "@babel-apps/platform/db/client";

import * as schema from "@/lib/db/schema";

const options = {
  envVar: "NEUM_DATABASE_PATH",
  defaultPath: path.resolve(
    process.cwd(),
    "..",
    "..",
    "data",
    "neum",
    "sqlite.db",
  ),
  schema,
  busyTimeoutMs: 5000,
} as const;

let database: DatabaseClient<typeof schema> | undefined;

export function getNeumDatabase(): DatabaseClient<typeof schema> {
  database ??= createDatabase(options);
  return database;
}
