import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { openDatabase } from "../src/lib/db/client";
import { valiDatabasePath } from "../src/lib/db/paths";

export const DEFAULT_DATABASE_PATH = valiDatabasePath();

export interface MigrateResult {
  migrated: true;
  database: string;
}

export function migrateDatabase(
  filename: string = DEFAULT_DATABASE_PATH,
): MigrateResult {
  const databasePath = resolveDatabasePath(filename);
  const database = openDatabase(databasePath);
  try {
    return { migrated: true, database: databasePath };
  } finally {
    database.close();
  }
}

export function parseMigrateArguments(args: readonly string[]): string {
  const { positionals, values } = parseArgs({
    args: [...args],
    allowPositionals: true,
    strict: true,
    options: {
      database: { type: "string" },
    },
  });
  if (positionals.length > (values.database === undefined ? 1 : 0)) {
    throw new Error("Usage: migrate.ts [database] [--database <path>]");
  }
  return values.database ?? positionals[0] ?? DEFAULT_DATABASE_PATH;
}

export function main(args: readonly string[] = process.argv.slice(2)): MigrateResult {
  const result = migrateDatabase(parseMigrateArguments(args));
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function resolveDatabasePath(filename: string): string {
  return filename === ":memory:" ? filename : path.resolve(filename);
}

function isMainModule(): boolean {
  const invokedPath = process.argv[1];
  return (
    invokedPath !== undefined &&
    pathToFileURL(path.resolve(invokedPath)).href === import.meta.url
  );
}

if (isMainModule()) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
