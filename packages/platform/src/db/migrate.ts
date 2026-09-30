import type BetterSqlite3 from "better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

export type RunMigrationsOptions<TSchema extends Record<string, unknown>> = {
  appName: string;
  db: BetterSQLite3Database<TSchema>;
  sqlite: BetterSqlite3.Database;
  migrationsFolder: string;
};

export function runMigrations<TSchema extends Record<string, unknown>>(
  options: RunMigrationsOptions<TSchema>,
): void {
  migrate(options.db, { migrationsFolder: options.migrationsFolder });
  options.sqlite.close();
  console.log(`${options.appName} database is up to date.`);
}
