import { lstat, mkdir, rename, rm, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import Database from "better-sqlite3";

import { DEFAULT_DATABASE_PATH } from "./migrate";

export const DEFAULT_CHECKPOINT_DIRECTORY = path.join("output", "checkpoints");

export interface CheckpointResult {
  checkpointed: true;
  database: string;
  destination: string;
  totalPages: number;
  remainingPages: number;
}

export async function checkpointDatabase(
  databaseFilename: string = DEFAULT_DATABASE_PATH,
  destinationFilename?: string,
  now: Date = new Date(),
): Promise<CheckpointResult> {
  const databasePath = path.resolve(databaseFilename);
  const destinationPath = path.resolve(
    destinationFilename ?? defaultCheckpointPath(databasePath, now),
  );
  if (samePath(databasePath, destinationPath)) {
    throw new Error("Checkpoint destination must differ from the database");
  }
  await assertExistingFile(databasePath, "Database");
  await assertMissing(destinationPath, "Checkpoint destination already exists");
  await mkdir(path.dirname(destinationPath), { recursive: true });

  const temporaryPath = `${destinationPath}.tmp-${process.pid}-${randomUUID()}`;
  const database = new Database(databasePath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    const metadata = await database.backup(temporaryPath);
    await rename(temporaryPath, destinationPath);
    return {
      checkpointed: true,
      database: databasePath,
      destination: destinationPath,
      totalPages: metadata.totalPages,
      remainingPages: metadata.remainingPages,
    };
  } finally {
    database.close();
    await rm(temporaryPath, { force: true });
  }
}

export function defaultCheckpointPath(databasePath: string, now: Date): string {
  const parsed = path.parse(databasePath);
  const extension = parsed.ext || ".db";
  const timestamp = now
    .toISOString()
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(/\.\d{3}Z$/, "Z");
  return path.join(
    DEFAULT_CHECKPOINT_DIRECTORY,
    `${parsed.name}-${timestamp}${extension}`,
  );
}

export function parseCheckpointArguments(args: readonly string[]): {
  database: string;
  destination?: string;
} {
  const { positionals, values } = parseArgs({
    args: [...args],
    allowPositionals: true,
    strict: true,
    options: {
      database: { type: "string" },
      destination: { type: "string" },
    },
  });
  let positionalIndex = 0;
  const database = values.database ?? positionals[positionalIndex++] ?? DEFAULT_DATABASE_PATH;
  const destination = values.destination ?? positionals[positionalIndex++];
  if (positionalIndex < positionals.length) {
    throw new Error(
      "Usage: checkpoint-database.ts [database] [destination] [--database <path>] [--destination <path>]",
    );
  }
  return { database, destination };
}

export async function main(
  args: readonly string[] = process.argv.slice(2),
): Promise<CheckpointResult> {
  const { database, destination } = parseCheckpointArguments(args);
  const result = await checkpointDatabase(database, destination);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function assertExistingFile(filename: string, label: string): Promise<void> {
  let fileStat;
  try {
    fileStat = await stat(filename);
  } catch (error) {
    if (isMissingPath(error)) {
      throw new Error(`${label} does not exist: ${filename}`);
    }
    throw error;
  }
  if (!fileStat.isFile()) {
    throw new Error(`${label} is not a file: ${filename}`);
  }
}

async function assertMissing(filename: string, message: string): Promise<void> {
  try {
    await lstat(filename);
  } catch (error) {
    if (isMissingPath(error)) {
      return;
    }
    throw error;
  }
  throw new Error(`${message}: ${filename}`);
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
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
