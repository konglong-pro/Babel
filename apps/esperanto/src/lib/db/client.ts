import fs from "node:fs";
import path from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import * as schema from "@/lib/db/schema";

const configuredDatabasePath = process.env.ESPERANTO_DATABASE_PATH;
export const databasePath =
  configuredDatabasePath === undefined
    ? path.resolve(
        process.cwd(),
        "..",
        "..",
        "data",
        "esperanto",
        "sqlite.db",
      )
    : path.resolve(
        /*turbopackIgnore: true*/ configuredDatabasePath,
      );
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

type DatabaseState = {
  path: string;
  sqlite: BetterSqlite3.Database;
  db: BetterSQLite3Database<typeof schema>;
};

const globalForDatabase = globalThis as typeof globalThis & {
  __esperantoDatabase?: DatabaseState;
};

const cached = globalForDatabase.__esperantoDatabase;
const state =
  cached?.path === databasePath
    ? cached
    : (() => {
        const sqlite = new BetterSqlite3(databasePath);
        sqlite.pragma("journal_mode = WAL");
        sqlite.pragma("foreign_keys = ON");
        sqlite.pragma("busy_timeout = 5000");
        return {
          path: databasePath,
          sqlite,
          db: drizzle(sqlite, { schema }),
        };
      })();

if (process.env.NODE_ENV !== "production") {
  globalForDatabase.__esperantoDatabase = state;
}

export const db = state.db;
export const sqlite = state.sqlite;
