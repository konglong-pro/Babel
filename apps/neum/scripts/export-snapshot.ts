import { lstat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import BetterSqlite3 from "better-sqlite3";

import {
  defaultNeumDatabasePath,
  defaultNeumUploadDirectory,
  exportNeumSnapshot,
  SnapshotError,
} from "../src/lib/exchange";

export interface ExportSnapshotCliOptions {
  database: string;
  uploadDirectory: string;
  destination: string;
}

export function parseExportSnapshotArguments(
  args: readonly string[],
): ExportSnapshotCliOptions {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...args],
      allowPositionals: true,
      strict: true,
      options: {
        database: { type: "string" },
        uploads: { type: "string" },
        destination: { type: "string" },
      },
    });
  } catch (error) {
    throw usageError(error);
  }
  if (parsed.positionals.length > 1) throw usageError();
  if (parsed.values.destination !== undefined && parsed.positionals.length === 1) {
    throw new SnapshotError(
      "INVALID_ARGUMENT",
      "Specify the export destination either positionally or with --destination, not both.",
    );
  }
  const destination = parsed.values.destination ?? parsed.positionals[0];
  if (destination === undefined) throw usageError();
  return {
    database: path.resolve(parsed.values.database ?? defaultNeumDatabasePath()),
    uploadDirectory: path.resolve(
      parsed.values.uploads ?? defaultNeumUploadDirectory(),
    ),
    destination: path.resolve(destination),
  };
}

export async function main(
  args: readonly string[] = process.argv.slice(2),
): Promise<void> {
  const options = parseExportSnapshotArguments(args);
  console.error("Safety: stop Neum before exporting a snapshot.");
  await assertDatabaseFile(options.database);
  const sqlite = new BetterSqlite3(options.database, {
    readonly: true,
    fileMustExist: true,
  });
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  try {
    const result = await exportNeumSnapshot({ sqlite, ...options });
    console.log(
      JSON.stringify(
        {
          exported: true,
          database: options.database,
          uploadDirectory: options.uploadDirectory,
          destination: result.destination,
          folders: result.manifest.folders.length,
          entries: result.manifest.entries.length,
          trash: result.manifest.trash.length,
          images: result.manifest.images.length,
        },
        null,
        2,
      ),
    );
  } finally {
    sqlite.close();
  }
}

async function assertDatabaseFile(filename: string): Promise<void> {
  let stats;
  try {
    stats = await lstat(filename);
  } catch (error) {
    throw new SnapshotError(
      "INVALID_DATABASE",
      `Neum database does not exist: ${filename}.`,
      { cause: error },
    );
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new SnapshotError(
      "INVALID_DATABASE",
      `Neum database is not a regular file: ${filename}.`,
    );
  }
}

function usageError(cause?: unknown): SnapshotError {
  return new SnapshotError(
    "INVALID_ARGUMENT",
    "Usage: snapshot:export <output-dir> [--database <sqlite.db>] [--uploads <entries-dir>]",
    cause === undefined ? undefined : { cause },
  );
}

function isMainModule(): boolean {
  const invoked = process.argv[1];
  return invoked !== undefined && pathToFileURL(path.resolve(invoked)).href === import.meta.url;
}

if (isMainModule()) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
