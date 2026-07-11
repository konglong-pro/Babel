import { lstat, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { openDatabase } from "../src/lib/db/client";
import { readDatabaseSnapshot } from "../src/lib/exchange/database";
import { writeLegacyVault } from "../src/lib/exchange/markdown-writer";
import type { VaultSnapshot } from "../src/lib/exchange/types";
import { DEFAULT_DATABASE_PATH } from "./migrate";

export const DEFAULT_EXPORT_PATH = path.join("output", "migration-export");

export interface ExportOptions {
  database?: string;
  destination?: string;
}

export interface ExportResult {
  exported: true;
  database: string;
  destination: string;
}

export async function assertExportDestinationReady(
  destination: string,
): Promise<string> {
  const destinationPath = path.resolve(destination);
  let destinationStat;
  try {
    destinationStat = await lstat(destinationPath);
  } catch (error) {
    if (isMissingPath(error)) {
      return destinationPath;
    }
    throw error;
  }

  if (!destinationStat.isDirectory()) {
    throw new Error(`Export destination is not a directory: ${destinationPath}`);
  }
  if ((await readdir(destinationPath)).length > 0) {
    throw new Error(`Export destination is not empty: ${destinationPath}`);
  }
  return destinationPath;
}

export async function writeSnapshotExport(
  snapshot: VaultSnapshot,
  destination: string = DEFAULT_EXPORT_PATH,
): Promise<string> {
  const destinationPath = await assertExportDestinationReady(destination);
  await writeLegacyVault(snapshot, destinationPath);
  return destinationPath;
}

export async function exportVault(
  options: ExportOptions = {},
): Promise<ExportResult> {
  const databasePath = resolveDatabasePath(
    options.database ?? DEFAULT_DATABASE_PATH,
  );
  const destinationPath = await assertExportDestinationReady(
    options.destination ?? DEFAULT_EXPORT_PATH,
  );
  await assertDatabaseFile(databasePath);

  const database = openDatabase(databasePath);
  let snapshot: VaultSnapshot;
  try {
    snapshot = readDatabaseSnapshot(database);
  } finally {
    database.close();
  }

  await writeSnapshotExport(snapshot, destinationPath);
  return { exported: true, database: databasePath, destination: destinationPath };
}

export function parseExportArguments(args: readonly string[]): Required<ExportOptions> {
  const { positionals, values } = parseArgs({
    args: [...args],
    allowPositionals: true,
    strict: true,
    options: {
      database: { type: "string" },
      source: { type: "string" },
      destination: { type: "string" },
      export: { type: "string" },
    },
  });
  const databaseOption = oneOf(values.database, values.source, "database/source");
  const destinationOption = oneOf(
    values.destination,
    values.export,
    "destination/export",
  );
  let positionalIndex = 0;
  const database = databaseOption ?? positionals[positionalIndex++] ?? DEFAULT_DATABASE_PATH;
  const destination =
    destinationOption ?? positionals[positionalIndex++] ?? DEFAULT_EXPORT_PATH;
  if (positionalIndex < positionals.length) {
    throw new Error(
      "Usage: export-vault.ts [database] [destination] [--database <path>] [--destination <path>]",
    );
  }
  return { database, destination };
}

export async function main(
  args: readonly string[] = process.argv.slice(2),
): Promise<ExportResult> {
  const result = await exportVault(parseExportArguments(args));
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function resolveDatabasePath(filename: string): string {
  return filename === ":memory:" ? filename : path.resolve(filename);
}

async function assertDatabaseFile(filename: string): Promise<void> {
  if (filename === ":memory:") {
    return;
  }
  let sourceStat;
  try {
    sourceStat = await stat(filename);
  } catch (error) {
    if (isMissingPath(error)) {
      throw new Error(`Database does not exist: ${filename}`);
    }
    throw error;
  }
  if (!sourceStat.isFile()) {
    throw new Error(`Database is not a file: ${filename}`);
  }
}

function oneOf(
  first: string | undefined,
  second: string | undefined,
  label: string,
): string | undefined {
  if (first !== undefined && second !== undefined) {
    throw new Error(`Specify only one ${label} option`);
  }
  return first ?? second;
}

function isMissingPath(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function isMainModule(): boolean {
  const invokedPath = process.argv[1];
  return (
    invokedPath !== undefined &&
    pathToFileURL(path.resolve(invokedPath)).href === import.meta.url
  );
}

if (isMainModule()) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
