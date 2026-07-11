import { mkdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { valiMigrationsPath } from "./paths";
import * as schema from "./schema";

export type ValiDatabase = Database.Database;

const CORE_TABLES = [
  "category",
  "vault_config",
  "entry",
  "entry_alias",
  "reflection",
  "trash_entry",
] as const;

export function openDatabase(filename: string): ValiDatabase {
  if (filename !== ":memory:") {
    mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  }
  const database = new Database(filename);
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");
  if (filename !== ":memory:") {
    database.pragma("journal_mode = WAL");
    database.pragma("synchronous = FULL");
  }

  const client = drizzle(database, { schema });
  migrate(client, { migrationsFolder: valiMigrationsPath() });
  return database;
}

export function assertDatabaseFileReady(filename: string): void {
  if (filename === ":memory:") {
    throw new Error("The in-memory Vali database is not initialized");
  }

  const database = new Database(filename, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    database.pragma("busy_timeout = 5000");
    assertDatabaseConnectionReady(database);
  } finally {
    database.close();
  }
}

export function assertDatabaseConnectionReady(database: ValiDatabase): void {
  for (const table of CORE_TABLES) {
    database.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get();
  }

  const config = database
    .prepare(
      `SELECT schema_version AS schemaVersion,
              default_category_id AS defaultCategoryId
       FROM vault_config
       WHERE id = 1`,
    )
    .get() as { schemaVersion: number; defaultCategoryId: string } | undefined;

  if (!config || config.schemaVersion !== 1) {
    throw new Error("Vali database configuration is missing or unsupported");
  }

  const defaultCategory = database
    .prepare("SELECT 1 FROM category WHERE id = ?")
    .get(config.defaultCategoryId);
  if (!defaultCategory) {
    throw new Error("Vali default category is missing");
  }
}
