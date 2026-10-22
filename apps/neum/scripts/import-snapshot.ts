import { lstat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import BetterSqlite3 from "better-sqlite3";

import {
  defaultNeumDatabasePath,
  defaultNeumUploadDirectory,
  importNeumSnapshot,
  SnapshotError,
} from "../src/lib/exchange";

export interface ImportSnapshotCliOptions {
  database: string;
  uploadDirectory: string;
  bundle: string;
  apply: boolean;
}

export function parseImportSnapshotArguments(
  args: readonly string[],
): ImportSnapshotCliOptions {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...args],
      allowPositionals: true,
      strict: true,
      options: {
        database: { type: "string" },
        uploads: { type: "string" },
        bundle: { type: "string" },
        apply: { type: "boolean", default: false },
      },
    });
  } catch (error) {
    throw usageError(error);
  }
  if (parsed.positionals.length > 1) throw usageError();
  if (parsed.values.bundle !== undefined && parsed.positionals.length === 1) {
    throw new SnapshotError(
      "INVALID_ARGUMENT",
      "Specify the snapshot bundle either positionally or with --bundle, not both.",
    );
  }
  const bundle = parsed.values.bundle ?? parsed.positionals[0];
  if (bundle === undefined) throw usageError();
  return {
    database: path.resolve(parsed.values.database ?? defaultNeumDatabasePath()),
    uploadDirectory: path.resolve(
      parsed.values.uploads ?? defaultNeumUploadDirectory(),
    ),
    bundle: path.resolve(bundle),
    apply: parsed.values.apply ?? false,
  };
}

export async function main(
  args: readonly string[] = process.argv.slice(2),
): Promise<void> {
  const options = parseImportSnapshotArguments(args);
  console.error("Safety: stop Neum before validating or importing a snapshot.");
  await assertDatabaseFile(options.database);
  const sqlite = new BetterSqlite3(options.database, { fileMustExist: true });
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  try {
    const result = await importNeumSnapshot({ sqlite, ...options });
    console.log(
      JSON.stringify(
        {
          valid: true,
          applied: result.applied,
          mode: result.applied ? "apply" : "dry-run",
          database: options.database,
          uploadDirectory: options.uploadDirectory,
          bundle: result.bundle,
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
      `Target Neum database does not exist: ${filename}. Run migrations first.`,
      { cause: error },
    );
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new SnapshotError(
      "INVALID_DATABASE",
      `Target Neum database is not a regular file: ${filename}.`,
    );
  }
}

function usageError(cause?: unknown): SnapshotError {
  return new SnapshotError(
    "INVALID_ARGUMENT",
    "Usage: snapshot:import <bundle-dir> [--apply] [--database <sqlite.db>] [--uploads <entries-dir>]",
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
