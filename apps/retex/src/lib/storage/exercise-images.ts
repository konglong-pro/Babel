import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { ImageStorageError } from "./errors";

export const EXERCISE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const EXERCISE_IMAGE_DIRECTORY = "data/uploads/exercises";

export const exerciseImageMimeTypes = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export type ExerciseImageMimeType = (typeof exerciseImageMimeTypes)[number];

export interface ExerciseImageUpload {
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface StoredExerciseImage {
  data: Buffer;
  contentType: ExerciseImageMimeType;
  fileName: string;
  imagePath: string;
  size: number;
}

type ImageFormat = {
  contentType: ExerciseImageMimeType;
  extension: "png" | "jpg" | "webp" | "gif";
};

const formatsByMimeType: Record<ExerciseImageMimeType, ImageFormat> = {
  "image/png": { contentType: "image/png", extension: "png" },
  "image/jpeg": { contentType: "image/jpeg", extension: "jpg" },
  "image/webp": { contentType: "image/webp", extension: "webp" },
  "image/gif": { contentType: "image/gif", extension: "gif" },
};

const formatsByExtension: Record<string, ImageFormat | undefined> = {
  ".png": formatsByMimeType["image/png"],
  ".jpg": formatsByMimeType["image/jpeg"],
  ".jpeg": formatsByMimeType["image/jpeg"],
  ".webp": formatsByMimeType["image/webp"],
  ".gif": formatsByMimeType["image/gif"],
};

export async function saveExerciseImage(
  upload: ExerciseImageUpload,
): Promise<string> {
  const declaredType = upload.type.toLowerCase() as ExerciseImageMimeType;
  const declaredFormat = formatsByMimeType[declaredType];

  if (!declaredFormat) {
    throw new ImageStorageError(
      "INVALID_TYPE",
      "Exercise images must be PNG, JPEG, WebP, or GIF.",
    );
  }

  if (!Number.isSafeInteger(upload.size) || upload.size < 0) {
    throw new ImageStorageError("INVALID_CONTENT", "Invalid image size.");
  }

  if (upload.size === 0) {
    throw new ImageStorageError("EMPTY_FILE", "The image file is empty.");
  }

  if (upload.size > EXERCISE_IMAGE_MAX_BYTES) {
    throw new ImageStorageError("FILE_TOO_LARGE", "Image files must not exceed 10 MB.");
  }

  const data = Buffer.from(await upload.arrayBuffer());
  if (data.byteLength === 0) {
    throw new ImageStorageError("EMPTY_FILE", "The image file is empty.");
  }

  if (data.byteLength > EXERCISE_IMAGE_MAX_BYTES) {
    throw new ImageStorageError("FILE_TOO_LARGE", "Image files must not exceed 10 MB.");
  }

  if (data.byteLength !== upload.size) {
    throw new ImageStorageError(
      "INVALID_CONTENT",
      "The image size does not match its upload metadata.",
    );
  }

  const detectedFormat = detectImageFormat(data);
  if (!detectedFormat || detectedFormat.contentType !== declaredFormat.contentType) {
    throw new ImageStorageError(
      "INVALID_CONTENT",
      "The file contents do not match the declared image type.",
    );
  }

  const fileName = `${randomUUID()}.${detectedFormat.extension}`;
  const imagePath = `${EXERCISE_IMAGE_DIRECTORY}/${fileName}`;
  const absolutePath = resolveExerciseImagePath(imagePath);

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, data, { flag: "wx" });

  return imagePath;
}

export async function readExerciseImage(
  imagePathOrFileName: string,
): Promise<StoredExerciseImage> {
  const imagePath = normalizeStoredExerciseImagePath(imagePathOrFileName);
  const absolutePath = resolveExerciseImagePath(imagePath);
  const fileName = path.basename(absolutePath);
  const format = formatFromFileName(fileName);

  try {
    const data = await readFile(absolutePath);
    return {
      data,
      contentType: format.contentType,
      fileName,
      imagePath,
      size: data.byteLength,
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new ImageStorageError("NOT_FOUND", "Exercise image not found.");
    }

    throw error;
  }
}

export async function deleteExerciseImage(
  imagePathOrFileName: string,
): Promise<boolean> {
  const absolutePath = resolveExerciseImagePath(imagePathOrFileName);

  try {
    await unlink(absolutePath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

export function normalizeStoredExerciseImagePath(
  imagePathOrFileName: string,
): string {
  if (typeof imagePathOrFileName !== "string") {
    throw new ImageStorageError("INVALID_PATH", "Invalid image path.");
  }

  const normalized = imagePathOrFileName.trim().replaceAll("\\", "/");
  if (!normalized || normalized.includes("\0") || path.posix.isAbsolute(normalized)) {
    throw new ImageStorageError("INVALID_PATH", "Invalid image path.");
  }

  const prefix = `${EXERCISE_IMAGE_DIRECTORY}/`;
  let fileName: string;

  if (normalized.startsWith(prefix)) {
    fileName = normalized.slice(prefix.length);
  } else if (!normalized.includes("/")) {
    fileName = normalized;
  } else {
    throw new ImageStorageError(
      "INVALID_PATH",
      "The image path is outside the exercise uploads directory.",
    );
  }

  if (
    !fileName ||
    fileName === "." ||
    fileName === ".." ||
    fileName !== path.posix.basename(fileName) ||
    !/^[A-Za-z0-9._-]+$/.test(fileName)
  ) {
    throw new ImageStorageError("INVALID_PATH", "Invalid image file name.");
  }

  formatFromFileName(fileName);
  return `${prefix}${fileName}`;
}

function resolveExerciseImagePath(imagePathOrFileName: string): string {
  const imagePath = normalizeStoredExerciseImagePath(imagePathOrFileName);
  const fileName = imagePath.slice(`${EXERCISE_IMAGE_DIRECTORY}/`.length);
  const uploadRoot = resolveExerciseImageRoot();
  const absolutePath = path.resolve(uploadRoot, fileName);
  const relative = path.relative(uploadRoot, absolutePath);

  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    if (!relative) {
      throw new ImageStorageError("INVALID_PATH", "The image path must refer to a file.");
    }

    throw new ImageStorageError(
      "INVALID_PATH",
      "The image path is outside the exercise uploads directory.",
    );
  }

  if (path.dirname(absolutePath) !== uploadRoot) {
    throw new ImageStorageError(
      "INVALID_PATH",
      "The image path is outside the exercise uploads directory.",
    );
  }

  return absolutePath;
}

function resolveExerciseImageRoot(): string {
  const configuredUploadDirectory = process.env.RETEX_UPLOAD_DIRECTORY;
  return configuredUploadDirectory === undefined
    ? path.resolve(
        process.cwd(),
        "..",
        "..",
        "data",
        "retex",
        "uploads",
        "exercises",
      )
    : path.resolve(
        /*turbopackIgnore: true*/ configuredUploadDirectory,
      );
}

function formatFromFileName(fileName: string): ImageFormat {
  const format = formatsByExtension[path.extname(fileName).toLowerCase()];
  if (!format) {
    throw new ImageStorageError(
      "INVALID_TYPE",
      "Exercise images must be PNG, JPEG, WebP, or GIF.",
    );
  }

  return format;
}

function detectImageFormat(data: Buffer): ImageFormat | null {
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
    return formatsByMimeType["image/png"];
  }

  if (
    data.length >= 3 &&
    data[0] === 0xff &&
    data[1] === 0xd8 &&
    data[2] === 0xff
  ) {
    return formatsByMimeType["image/jpeg"];
  }

  if (data.length >= 6) {
    const signature = data.subarray(0, 6).toString("ascii");
    if (signature === "GIF87a" || signature === "GIF89a") {
      return formatsByMimeType["image/gif"];
    }
  }

  if (
    data.length >= 12 &&
    data.subarray(0, 4).toString("ascii") === "RIFF" &&
    data.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return formatsByMimeType["image/webp"];
  }

  return null;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
