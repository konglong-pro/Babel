import { constants as fsConstants } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import type BetterSqlite3 from "better-sqlite3";

import {
  assertPristineNeumTarget,
  readNeumDatabaseSnapshot,
  restoreNeumDatabaseSnapshotRows,
} from "./database";
import { SnapshotError } from "./errors";
import {
  assertBundleImageInventory,
  assertInspectedImageMatches,
  inspectManagedImage,
  resolveManagedImageFile,
} from "./image-files";
import {
  NEUM_SNAPSHOT_APP_ID,
  NEUM_SNAPSHOT_SCHEMA_VERSION,
  type NeumSnapshotManifest,
} from "./types";
import {
  parseSnapshotManifest,
  referencedSnapshotImagePaths,
  snapshotImageFileName,
  validateSnapshotManifest,
} from "./validation";

const MANIFEST_FILE = "manifest.json";
const IMAGES_DIRECTORY = "images";
const MAX_MANIFEST_BYTES = 50 * 1024 * 1024;

export interface ExportNeumSnapshotOptions {
  sqlite: BetterSqlite3.Database;
  uploadDirectory: string;
  destination: string;
  exportedAt?: string;
}

export interface ExportNeumSnapshotResult {
  destination: string;
  manifest: NeumSnapshotManifest;
}

export interface ImportNeumSnapshotOptions {
  sqlite: BetterSqlite3.Database;
  uploadDirectory: string;
  bundle: string;
  apply?: boolean;
}

export interface ImportNeumSnapshotResult {
  bundle: string;
  applied: boolean;
  manifest: NeumSnapshotManifest;
}

export async function exportNeumSnapshot(
  options: ExportNeumSnapshotOptions,
): Promise<ExportNeumSnapshotResult> {
  const destination = path.resolve(options.destination);
  const destinationExisted = await assertEmptyExportDestination(destination);
  const databaseSnapshot = readNeumDatabaseSnapshot(options.sqlite);
  const imagePaths = [...referencedSnapshotImagePaths(databaseSnapshot)].sort();
  const images = [];
  const imageData = new Map<string, Buffer>();
  for (const imagePath of imagePaths) {
    const inspected = await inspectManagedImage(
      resolveManagedImageFile(options.uploadDirectory, imagePath),
      imagePath,
    );
    const { data, ...metadata } = inspected;
    images.push(metadata);
    imageData.set(imagePath, data);
  }

  const manifest = validateSnapshotManifest({
    appId: NEUM_SNAPSHOT_APP_ID,
    schemaVersion: NEUM_SNAPSHOT_SCHEMA_VERSION,
    exportedAt: options.exportedAt ?? new Date().toISOString(),
    ...databaseSnapshot,
    images,
  });

  const imagesDirectory = path.join(destination, IMAGES_DIRECTORY);
  try {
    await mkdir(imagesDirectory, { recursive: true });
    for (const image of manifest.images) {
      const data = imageData.get(image.imagePath);
      if (data === undefined) {
        throw new SnapshotError(
          "INVALID_IMAGE",
          `Image data disappeared during export: ${image.imagePath}.`,
        );
      }
      await writeFile(
        path.join(imagesDirectory, snapshotImageFileName(image.imagePath)),
        data,
        { flag: "wx" },
      );
    }
    await writeFile(
      path.join(destination, MANIFEST_FILE),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" },
    );
  } catch (error) {
    await cleanupFailedExport(destination, destinationExisted);
    throw error;
  }
  return { destination, manifest };
}

export async function importNeumSnapshot(
  options: ImportNeumSnapshotOptions,
): Promise<ImportNeumSnapshotResult> {
  const bundle = path.resolve(options.bundle);
  const uploadDirectory = path.resolve(options.uploadDirectory);
  const manifest = await readAndVerifyBundle(bundle);
  assertPristineNeumTarget(options.sqlite);
  const uploadDirectoryExisted = await assertEmptyUploadDirectory(uploadDirectory);

  if (options.apply !== true) {
    return { bundle, applied: false, manifest };
  }

  await mkdir(uploadDirectory, { recursive: true });
  const stagingDirectory = path.join(
    uploadDirectory,
    `.snapshot-import-${randomUUID()}`,
  );
  const movedFiles: string[] = [];
  let transactionStarted = false;
  try {
    await mkdir(stagingDirectory, { recursive: false });
    for (const image of manifest.images) {
      const fileName = snapshotImageFileName(image.imagePath);
      const source = path.join(bundle, IMAGES_DIRECTORY, fileName);
      const staged = path.join(stagingDirectory, fileName);
      await copyFile(source, staged, fsConstants.COPYFILE_EXCL);
      const stagedImage = await inspectManagedImage(staged, image.imagePath);
      assertInspectedImageMatches(stagedImage, image);
    }

    options.sqlite.exec("BEGIN IMMEDIATE");
    transactionStarted = true;
    restoreNeumDatabaseSnapshotRows(options.sqlite, manifest);
    for (const image of manifest.images) {
      const fileName = snapshotImageFileName(image.imagePath);
      const finalPath = path.join(uploadDirectory, fileName);
      await rename(path.join(stagingDirectory, fileName), finalPath);
      movedFiles.push(finalPath);
    }
    options.sqlite.exec("COMMIT");
    transactionStarted = false;
  } catch (error) {
    const cleanupErrors: unknown[] = [];
    if (transactionStarted) {
      try {
        options.sqlite.exec("ROLLBACK");
      } catch (rollbackError) {
        cleanupErrors.push(rollbackError);
      }
    }
    for (const filename of movedFiles.reverse()) {
      try {
        await rm(filename, { force: true });
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    try {
      await rm(stagingDirectory, { recursive: true, force: true });
      if (!uploadDirectoryExisted) await removeEmptyDirectory(uploadDirectory);
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        "Snapshot import failed and could not be completely cleaned up.",
      );
    }
    throw error;
  }

  try {
    await rm(stagingDirectory, { recursive: true, force: true });
  } catch (error) {
    // The database and image files are committed. A leftover empty staging
    // directory is safer than reporting the successful import as failed.
    console.error("Failed to remove Neum snapshot staging directory.", error);
  }
  return { bundle, applied: true, manifest };
}

export async function readAndVerifyBundle(
  bundle: string,
): Promise<NeumSnapshotManifest> {
  const bundlePath = path.resolve(bundle);
  let bundleStats;
  try {
    bundleStats = await lstat(bundlePath);
  } catch (error) {
    throw new SnapshotError("INVALID_BUNDLE", "Snapshot bundle does not exist.", {
      cause: error,
    });
  }
  if (!bundleStats.isDirectory() || bundleStats.isSymbolicLink()) {
    throw new SnapshotError("INVALID_BUNDLE", "Snapshot bundle must be a real directory.");
  }

  const rootEntries = await readdir(bundlePath, { withFileTypes: true });
  const rootNames = new Set(rootEntries.map(({ name }) => name));
  const expectedRootNames = new Set([MANIFEST_FILE, IMAGES_DIRECTORY]);
  const unexpected = [...rootNames].filter((name) => !expectedRootNames.has(name));
  const missing = [...expectedRootNames].filter((name) => !rootNames.has(name));
  if (unexpected.length > 0 || missing.length > 0) {
    throw new SnapshotError(
      "INVALID_BUNDLE",
      `Snapshot bundle inventory mismatch (missing: ${missing.join(", ") || "none"}; extra: ${unexpected.join(", ") || "none"}).`,
    );
  }

  const manifestPath = path.join(bundlePath, MANIFEST_FILE);
  const manifestStats = await lstat(manifestPath);
  if (
    !manifestStats.isFile() ||
    manifestStats.isSymbolicLink() ||
    manifestStats.size <= 0 ||
    manifestStats.size > MAX_MANIFEST_BYTES
  ) {
    throw new SnapshotError(
      "INVALID_BUNDLE",
      "manifest.json must be a non-empty regular file no larger than 50 MB.",
    );
  }
  const manifest = parseSnapshotManifest(await readFile(manifestPath, "utf8"));
  const imagesDirectory = path.join(bundlePath, IMAGES_DIRECTORY);
  await assertBundleImageInventory(imagesDirectory, manifest.images);
  for (const image of manifest.images) {
    const inspected = await inspectManagedImage(
      path.join(imagesDirectory, snapshotImageFileName(image.imagePath)),
      image.imagePath,
    );
    assertInspectedImageMatches(inspected, image);
  }
  return manifest;
}

async function assertEmptyExportDestination(destination: string): Promise<boolean> {
  let stats;
  try {
    stats = await lstat(destination);
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new SnapshotError(
      "INVALID_DESTINATION",
      `Export destination is not a real directory: ${destination}.`,
    );
  }
  if ((await readdir(destination)).length !== 0) {
    throw new SnapshotError(
      "INVALID_DESTINATION",
      `Export destination is not empty: ${destination}.`,
    );
  }
  return true;
}

async function assertEmptyUploadDirectory(uploadDirectory: string): Promise<boolean> {
  let stats;
  try {
    stats = await lstat(uploadDirectory);
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new SnapshotError(
      "TARGET_NOT_PRISTINE",
      "The target Neum upload path is not a real directory.",
    );
  }
  if ((await readdir(uploadDirectory)).length !== 0) {
    throw new SnapshotError(
      "TARGET_NOT_PRISTINE",
      "Snapshot import requires an empty Neum entry-image upload directory.",
    );
  }
  return true;
}

async function cleanupFailedExport(
  destination: string,
  destinationExisted: boolean,
): Promise<void> {
  await rm(path.join(destination, IMAGES_DIRECTORY), { recursive: true, force: true });
  await rm(path.join(destination, MANIFEST_FILE), { force: true });
  if (!destinationExisted) await rm(destination, { recursive: true, force: true });
}

async function removeEmptyDirectory(directory: string): Promise<void> {
  try {
    await rmdir(directory);
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
}

function isMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
