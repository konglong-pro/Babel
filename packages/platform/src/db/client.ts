import fs from "node:fs";
import path from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

export type DatabasePathOptions = {
  envVar: string;
  defaultPath: string;
};

export type CreateDatabaseOptions<TSchema extends Record<string, unknown>> =
  DatabasePathOptions & {
    schema: TSchema;
    busyTimeoutMs?: number;
  };

export type DatabaseClient<TSchema extends Record<string, unknown>> = {
  databasePath: string;
  sqlite: BetterSqlite3.Database;
  db: BetterSQLite3Database<TSchema>;
};

type CachedDatabase = {
  databasePath: string;
  sqlite: BetterSqlite3.Database;
  db: unknown;
};

const globalForDatabase = globalThis as typeof globalThis & {
  __babelPlatformDatabases?: Map<string, CachedDatabase>;
};

export function resolveDatabasePath(options: DatabasePathOptions): string {
  const configuredDatabasePath = process.env[options.envVar];
  return path.resolve(configuredDatabasePath ?? options.defaultPath);
}

export function createDatabase<TSchema extends Record<string, unknown>>(
  options: CreateDatabaseOptions<TSchema>,
): DatabaseClient<TSchema> {
  const databasePath = resolveDatabasePath(options);
  const cacheKey = `${options.envVar}\0${databasePath}`;
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });

  if (process.env.NODE_ENV !== "production") {
    const cached = globalForDatabase.__babelPlatformDatabases?.get(cacheKey);
    if (cached !== undefined) {
      return cached as DatabaseClient<TSchema>;
    }
  }

  const sqlite = new BetterSqlite3(databasePath);
  if (options.busyTimeoutMs !== undefined) {
    sqlite.pragma(`busy_timeout = ${options.busyTimeoutMs}`);
  }
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const state: DatabaseClient<TSchema> = {
    databasePath,
    sqlite,
    db: drizzle(sqlite, { schema: options.schema }),
  };

  if (process.env.NODE_ENV !== "production") {
    const cache = globalForDatabase.__babelPlatformDatabases ?? new Map();
    cache.set(cacheKey, state);
    globalForDatabase.__babelPlatformDatabases = cache;
  }

  return state;
}
