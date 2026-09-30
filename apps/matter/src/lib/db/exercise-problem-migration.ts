import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rmdir,
  stat,
  unlink,
} from "node:fs/promises";
import path from "node:path";

import type BetterSqlite3 from "better-sqlite3";

const legacyLogicalPrefix = "data/uploads/exercises/";
const noteLogicalPrefix = "data/matter/uploads/notes/";
const migratedFilePrefix = "legacy-exercise-";
const stagingDirectoryName = ".exercise-problem-migration";
const migratedLogicalPathPattern =
  /^data\/matter\/uploads\/notes\/(legacy-exercise-(\d+)-([A-Za-z0-9._-]+))$/;
const migratedFileNamePattern =
  /^legacy-exercise-(\d+)-([A-Za-z0-9._-]+)$/;

type LegacyExercise = {
  id: number;
  image_path: string;
};

type MigratedExerciseImage = {
  id: number;
  image_path: string;
};

export async function prepareLegacyExerciseProblems(
  sqlite: BetterSqlite3.Database,
): Promise<number> {
  if (!tableExists(sqlite, "exercise")) return 0;

  const columns = tableColumns(sqlite, "exercise");
  if (!columns.has("image_path")) return 0;
  if (columns.has("problem_md")) {
    throw new Error(
      "Exercise migration found both image_path and problem_md; restore the pre-migration backup before retrying.",
    );
  }

  const rows = sqlite
    .prepare("SELECT id, image_path FROM exercise ORDER BY id")
    .all() as LegacyExercise[];
  if (rows.length === 0) return 0;

  const legacyRoot = resolveLegacyImageRoot();
  const noteRoot = resolveNoteImageRoot();
  const stagingRoot = migrationStagingRoot();
  await mkdir(stagingRoot, { recursive: true });

  for (const row of rows) {
    const legacyFileName = legacyFileNameFromPath(row.image_path);
    const migratedFileName = migratedFileNameFor(row.id, legacyFileName);
    const sourcePath = path.join(legacyRoot, legacyFileName);
    const stagedPath = path.join(stagingRoot, migratedFileName);
    const destinationPath = path.join(noteRoot, migratedFileName);
    await assertRegularFile(sourcePath, `Legacy exercise image for exercise ${row.id}`);
    if (await pathExists(destinationPath) && !(await isRegularFile(destinationPath))) {
      throw new Error(`Migration destination is not a regular file: ${destinationPath}`);
    }
    await copyOrVerify(sourcePath, stagedPath);
    // Put the final managed file in place before the database migration can
    // commit a problem_md reference to it. The staging copy remains as a
    // retry marker until finalize verifies the migrated ownership row.
    await copyOrVerify(sourcePath, destinationPath);
  }

  return rows.length;
}

export async function finalizeLegacyExerciseProblems(
  sqlite: BetterSqlite3.Database,
): Promise<number> {
  if (!tableExists(sqlite, "exercise")) return 0;

  const columns = tableColumns(sqlite, "exercise");
  if (!columns.has("problem_md")) return 0;

  const migratedImages = sqlite
    .prepare(
      `SELECT source_id AS id, image_path
       FROM note_image
       WHERE source_kind = 'exercise' AND image_path LIKE ?
       ORDER BY source_id`,
    )
    .all(`${noteLogicalPrefix}${migratedFilePrefix}%`) as MigratedExerciseImage[];

  const noteRoot = resolveNoteImageRoot();
  const stagingRoot = migrationStagingRoot();
  const legacyRoot = resolveLegacyImageRoot();
  const ownedMigratedFileNames = new Set<string>();
  await mkdir(noteRoot, { recursive: true });

  for (const row of migratedImages) {
    const match = migratedLogicalPathPattern.exec(row.image_path);
    if (!match || Number(match[2]) !== row.id) {
      throw new Error(`Exercise ${row.id} has an invalid migrated image ownership path.`);
    }

    const migratedFileName = match[1];
    const legacyFileName = match[3];
    ownedMigratedFileNames.add(migratedFileName);
    const destinationPath = path.join(noteRoot, migratedFileName);
    const stagedPath = path.join(stagingRoot, migratedFileName);
    const legacyPath = path.join(legacyRoot, legacyFileName);
    const stagedExists = await isRegularFile(stagedPath);
    const legacyExists = await isRegularFile(legacyPath);

    if (!stagedExists && !legacyExists && !(await isRegularFile(destinationPath))) {
      throw new Error(
        `Cannot recover the migrated image for exercise ${row.id}; restore the data backup before retrying.`,
      );
    }

    const verifiedSource = stagedExists ? stagedPath : legacyExists ? legacyPath : null;
    if (verifiedSource !== null) {
      await copyOrVerify(verifiedSource, destinationPath);
    }
    await assertRegularFile(
      destinationPath,
      `Migrated problem image for exercise ${row.id}`,
    );
    if (legacyExists) await assertSameContents(legacyPath, destinationPath);

    if (stagedExists) await unlink(stagedPath);
  }

  await removeUnownedStagingFiles(ownedMigratedFileNames);
  await removeEmptyStagingDirectory();
  return migratedImages.length;
}

function tableExists(sqlite: BetterSqlite3.Database, tableName: string): boolean {
  return sqlite
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) !== undefined;
}

function tableColumns(
  sqlite: BetterSqlite3.Database,
  tableName: string,
): Set<string> {
  const rows = sqlite.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
    name: string;
  }>;
  return new Set(rows.map(({ name }) => name));
}

function legacyFileNameFromPath(imagePath: string): string {
  const normalized = imagePath.trim().replaceAll("\\", "/");
  if (!normalized.startsWith(legacyLogicalPrefix)) {
    throw new Error(`Unsupported legacy exercise image path: ${imagePath}`);
  }
  const fileName = normalized.slice(legacyLogicalPrefix.length);
  if (
    fileName.length === 0 ||
    fileName !== path.posix.basename(fileName) ||
    !/^[A-Za-z0-9._-]+\.(?:png|jpe?g|webp|gif)$/i.test(fileName)
  ) {
    throw new Error(`Invalid legacy exercise image path: ${imagePath}`);
  }
  return fileName;
}

function migratedFileNameFor(exerciseId: number, legacyFileName: string): string {
  return `${migratedFilePrefix}${exerciseId}-${legacyFileName}`;
}

function resolveLegacyImageRoot(): string {
  return process.env.MATTER_UPLOAD_DIRECTORY === undefined
    ? path.resolve(process.cwd(), "..", "..", "data", "matter", "uploads", "exercises")
    : path.resolve(process.env.MATTER_UPLOAD_DIRECTORY);
}

function resolveNoteImageRoot(): string {
  return process.env.MATTER_NOTE_UPLOAD_DIRECTORY === undefined
    ? path.resolve(process.cwd(), "..", "..", "data", "matter", "uploads", "notes")
    : path.resolve(process.env.MATTER_NOTE_UPLOAD_DIRECTORY);
}

function migrationStagingRoot(): string {
  return path.join(resolveNoteImageRoot(), stagingDirectoryName);
}

async function copyOrVerify(sourcePath: string, destinationPath: string): Promise<void> {
  await mkdir(path.dirname(destinationPath), { recursive: true });
  try {
    await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL);
  } catch (error) {
    if (!isNodeError(error) || error.code !== "EEXIST") throw error;
  }
  await assertSameContents(sourcePath, destinationPath);
}

async function assertSameContents(leftPath: string, rightPath: string): Promise<void> {
  const [left, right] = await Promise.all([readFile(leftPath), readFile(rightPath)]);
  const leftHash = createHash("sha256").update(left).digest("hex");
  const rightHash = createHash("sha256").update(right).digest("hex");
  if (leftHash !== rightHash) {
    throw new Error(`Image verification failed for ${rightPath}.`);
  }
}

async function assertRegularFile(filePath: string, label: string): Promise<void> {
  if (!(await isRegularFile(filePath))) {
    throw new Error(`${label} is missing or is not a regular file: ${filePath}`);
  }
}

async function isRegularFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

async function removeEmptyStagingDirectory(): Promise<void> {
  const stagingRoot = migrationStagingRoot();
  try {
    if ((await readdir(stagingRoot)).length === 0) await rmdir(stagingRoot);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    throw error;
  }
}

async function removeUnownedStagingFiles(
  ownedMigratedFileNames: ReadonlySet<string>,
): Promise<void> {
  const stagingRoot = migrationStagingRoot();
  try {
    const entries = await readdir(stagingRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !migratedFileNamePattern.test(entry.name)) {
        throw new Error(`Unexpected entry in exercise migration staging: ${entry.name}`);
      }
      if (!ownedMigratedFileNames.has(entry.name)) {
        await unlink(path.join(stagingRoot, entry.name));
      }
    }
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
