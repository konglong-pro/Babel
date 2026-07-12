import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { SnapshotError } from "./errors";
import type { SnapshotImage, SnapshotImageContentType } from "./types";
import {
  ENTRY_IMAGE_MAX_BYTES,
  normalizeSnapshotImagePath,
  snapshotImageFileName,
} from "./validation";

export interface InspectedSnapshotImage extends SnapshotImage {
  data: Buffer;
}

export async function inspectManagedImage(
  filename: string,
  imagePath: string,
): Promise<InspectedSnapshotImage> {
  const normalizedPath = normalizeSnapshotImagePath(imagePath);
  let fileStats;
  try {
    fileStats = await lstat(filename);
  } catch (error) {
    throw new SnapshotError(
      "INVALID_IMAGE",
      `Managed image is missing: ${normalizedPath}.`,
      { cause: error },
    );
  }
  if (!fileStats.isFile() || fileStats.isSymbolicLink()) {
    throw new SnapshotError(
      "INVALID_IMAGE",
      `Managed image must be a regular file: ${normalizedPath}.`,
    );
  }
  if (fileStats.size <= 0 || fileStats.size > ENTRY_IMAGE_MAX_BYTES) {
    throw new SnapshotError(
      "INVALID_IMAGE",
      `Managed image has an invalid size: ${normalizedPath}.`,
    );
  }
  const data = await readFile(filename);
  if (data.byteLength !== fileStats.size) {
    throw new SnapshotError(
      "INVALID_IMAGE",
      `Managed image changed while it was being read: ${normalizedPath}.`,
    );
  }
  const contentType = detectImageContentType(data);
  if (contentType === null || !extensionMatches(contentType, normalizedPath)) {
    throw new SnapshotError(
      "INVALID_IMAGE",
      `Managed image signature does not match its extension: ${normalizedPath}.`,
    );
  }
  return {
    imagePath: normalizedPath,
    contentType,
    size: data.byteLength,
    sha256: createHash("sha256").update(data).digest("hex"),
    data,
  };
}

export function assertInspectedImageMatches(
  actual: SnapshotImage,
  expected: SnapshotImage,
): void {
  if (
    actual.imagePath !== expected.imagePath ||
    actual.contentType !== expected.contentType ||
    actual.size !== expected.size ||
    actual.sha256 !== expected.sha256
  ) {
    throw new SnapshotError(
      "INVALID_IMAGE",
      `Image metadata or SHA-256 does not match manifest.json: ${expected.imagePath}.`,
    );
  }
}

export function resolveManagedImageFile(
  uploadDirectory: string,
  imagePath: string,
): string {
  const root = path.resolve(uploadDirectory);
  const filename = snapshotImageFileName(imagePath);
  const resolved = path.resolve(root, filename);
  if (path.dirname(resolved) !== root) {
    throw new SnapshotError(
      "INVALID_IMAGE",
      `Managed image path escapes the upload directory: ${imagePath}.`,
    );
  }
  return resolved;
}

export async function assertBundleImageInventory(
  imagesDirectory: string,
  images: readonly SnapshotImage[],
): Promise<void> {
  let rootStats;
  try {
    rootStats = await lstat(imagesDirectory);
  } catch (error) {
    throw new SnapshotError("INVALID_BUNDLE", "Snapshot images/ directory is missing.", {
      cause: error,
    });
  }
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new SnapshotError(
      "INVALID_BUNDLE",
      "Snapshot images/ must be a real directory.",
    );
  }

  const expectedNames = new Set(images.map(({ imagePath }) => snapshotImageFileName(imagePath)));
  const entries = await readdir(imagesDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new SnapshotError(
        "INVALID_BUNDLE",
        `Unexpected non-file in snapshot images/: ${entry.name}.`,
      );
    }
  }
  const actualNames = new Set(entries.map(({ name }) => name));
  const missing = [...expectedNames].filter((name) => !actualNames.has(name));
  const extra = [...actualNames].filter((name) => !expectedNames.has(name));
  if (missing.length > 0 || extra.length > 0) {
    throw new SnapshotError(
      "INVALID_BUNDLE",
      `Snapshot image inventory mismatch (missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"}).`,
    );
  }
}

function detectImageContentType(data: Buffer): SnapshotImageContentType | null {
  if (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a
  ) {
    return "image/png";
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return "image/jpeg";
  }
  if (data.length >= 6) {
    const signature = data.subarray(0, 6).toString("ascii");
    if (signature === "GIF87a" || signature === "GIF89a") return "image/gif";
  }
  if (
    data.length >= 12 &&
    data.subarray(0, 4).toString("ascii") === "RIFF" &&
    data.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function extensionMatches(
  contentType: SnapshotImageContentType,
  imagePath: string,
): boolean {
  const extension = path.posix.extname(imagePath).toLowerCase();
  if (contentType === "image/png") return extension === ".png";
  if (contentType === "image/jpeg") return extension === ".jpg" || extension === ".jpeg";
  if (contentType === "image/webp") return extension === ".webp";
  return extension === ".gif";
}
