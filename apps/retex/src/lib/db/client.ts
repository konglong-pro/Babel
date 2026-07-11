import fs from "node:fs";
import path from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import * as schema from "@/lib/db/schema";

const configuredDatabasePath = process.env.RETEX_DATABASE_PATH;
export const databasePath =
  configuredDatabasePath === undefined
    ? path.resolve(process.cwd(), "..", "..", "data", "retex", "sqlite.db")
    : path.resolve(
        /*turbopackIgnore: true*/ configuredDatabasePath,
      );
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

type DatabaseState = {
  sqlite?: BetterSqlite3.Database;
  db?: BetterSQLite3Database<typeof schema>;
};

const globalForDatabase = globalThis as typeof globalThis & {
  __retexDatabase?: DatabaseState;
};

const state = globalForDatabase.__retexDatabase ?? {};
const sqlite = state.sqlite ?? new BetterSqlite3(databasePath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

const db = state.db ?? drizzle(sqlite, { schema });
state.sqlite = sqlite;
state.db = db;

if (process.env.NODE_ENV !== "production") {
  globalForDatabase.__retexDatabase = state;
}

export { db, sqlite };
