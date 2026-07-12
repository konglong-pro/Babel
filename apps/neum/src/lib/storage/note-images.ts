import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  rm,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { entryImageUrl } from "@/lib/types";

import { ImageStorageError } from "./errors";

export const ENTRY_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const ENTRY_IMAGE_DIRECTORY = "data/uploads/entries";
export const ENTRY_UPLOAD_PLACEHOLDER_PREFIX = "neum-upload://";

/** @deprecated Use the entry-named constants. */
export const NOTE_IMAGE_MAX_BYTES = ENTRY_IMAGE_MAX_BYTES;
/** @deprecated Use the entry-named constants. */
export const NOTE_IMAGE_DIRECTORY = ENTRY_IMAGE_DIRECTORY;
/** @deprecated Use the entry-named constants. */
export const NOTE_UPLOAD_PLACEHOLDER_PREFIX = ENTRY_UPLOAD_PLACEHOLDER_PREFIX;

export const noteImageMimeTypes = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export type NoteImageMimeType = (typeof noteImageMimeTypes)[number];

export interface NoteImageUpload {
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface StoredNoteImage {
  data: Buffer;
  contentType: NoteImageMimeType;
  fileName: string;
  imagePath: string;
  size: number;
}

export interface StagedNoteImages {
  contentMd: string;
  imagePaths: string[];
}

export interface StagedEntryImages {
  notesMd: string;
  imagePaths: string[];
}

interface QuarantinedNoteImage {
  imagePath: string;
  originalPath: string;
  quarantinedPath: string;
}

export interface NoteImageQuarantine {
  stagingRoot: string;
  transactionDirectory: string | null;
  entries: readonly QuarantinedNoteImage[];
}

type ImageFormat = {
  contentType: NoteImageMimeType;
  extension: "png" | "jpg" | "webp" | "gif";
};

const formatsByMimeType: Record<NoteImageMimeType, ImageFormat> = {
  "image/png": { contentType: "image/png", extension: "png" },
  "image/jpeg": { contentType: "image/jpeg", extension: "jpg" },
  "image/webp": { contentType: "image/webp", extension: "webp" },
  "image/gif": { contentType: "image/gif", extension: "gif" },
};

const formatsByExtension: Readonly<Record<string, ImageFormat | undefined>> = {
  ".png": formatsByMimeType["image/png"],
  ".jpg": formatsByMimeType["image/jpeg"],
  ".jpeg": formatsByMimeType["image/jpeg"],
  ".webp": formatsByMimeType["image/webp"],
  ".gif": formatsByMimeType["image/gif"],
};

const uploadTokenPattern = /^[A-Za-z0-9_-]{1,128}$/;

export async function saveNoteImage(upload: NoteImageUpload): Promise<string> {
  const declaredType = upload.type.toLowerCase() as NoteImageMimeType;
  const declaredFormat = formatsByMimeType[declaredType];
  if (!declaredFormat) {
    throw new ImageStorageError(
      "INVALID_TYPE",
      "Entry images must be PNG, JPEG, WebP, or GIF.",
    );
  }
  if (!Number.isSafeInteger(upload.size) || upload.size < 0) {
    throw new ImageStorageError("INVALID_CONTENT", "Invalid image size.");
  }
  if (upload.size === 0) {
    throw new ImageStorageError("EMPTY_FILE", "The image file is empty.");
  }
  if (upload.size > NOTE_IMAGE_MAX_BYTES) {
    throw new ImageStorageError("FILE_TOO_LARGE", "Image files must not exceed 10 MB.");
  }

  const data = Buffer.from(await upload.arrayBuffer());
  if (data.byteLength === 0) {
    throw new ImageStorageError("EMPTY_FILE", "The image file is empty.");
  }
  if (data.byteLength > NOTE_IMAGE_MAX_BYTES) {
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
  const imagePath = `${NOTE_IMAGE_DIRECTORY}/${fileName}`;
  const absolutePath = resolveNoteImagePath(imagePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, data, { flag: "wx" });
  return imagePath;
}

export async function readNoteImage(
  imagePathOrFileName: string,
): Promise<StoredNoteImage> {
  const imagePath = normalizeStoredNoteImagePath(imagePathOrFileName);
  const absolutePath = resolveNoteImagePath(imagePath);
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
      throw new ImageStorageError("NOT_FOUND", "Entry image not found.");
    }
    throw error;
  }
}

export async function deleteNoteImage(
  imagePathOrFileName: string,
): Promise<boolean> {
  const absolutePath = resolveNoteImagePath(imagePathOrFileName);
  try {
    await unlink(absolutePath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

export async function deleteNoteImages(imagePaths: readonly string[]): Promise<void> {
  await Promise.all(imagePaths.map((imagePath) => deleteNoteImage(imagePath)));
}

export async function quarantineNoteImages(
  imagePaths: readonly string[],
): Promise<NoteImageQuarantine> {
  const normalized = [...new Set(imagePaths.map(normalizeStoredNoteImagePath))];
  const uploadRoot = resolveNoteImageRoot();
  const stagingRoot = path.join(uploadRoot, ".staging");
  if (normalized.length === 0) {
    return { stagingRoot, transactionDirectory: null, entries: [] };
  }

  const transactionDirectory = path.join(stagingRoot, randomUUID());
  await mkdir(transactionDirectory, { recursive: true });
  const entries: QuarantinedNoteImage[] = [];

  try {
    for (const imagePath of normalized) {
      const originalPath = resolveNoteImagePath(imagePath);
      const quarantinedPath = path.join(
        transactionDirectory,
        path.basename(originalPath),
      );
      try {
        await rename(originalPath, quarantinedPath);
        entries.push({ imagePath, originalPath, quarantinedPath });
      } catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") continue;
        throw error;
      }
    }
  } catch (error) {
    const quarantine = { stagingRoot, transactionDirectory, entries };
    try {
      await restoreQuarantinedNoteImages(quarantine);
    } catch (restoreError) {
      throw new AggregateError(
        [error, restoreError],
        "Image quarantine failed and could not be fully restored.",
      );
    }
    throw error;
  }

  return { stagingRoot, transactionDirectory, entries };
}

export async function restoreQuarantinedNoteImages(
  quarantine: NoteImageQuarantine,
): Promise<void> {
  const results = await Promise.allSettled(
    [...quarantine.entries].reverse().map(async (entry) => {
      await mkdir(path.dirname(entry.originalPath), { recursive: true });
      await rename(entry.quarantinedPath, entry.originalPath);
    }),
  );
  const failures = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (failures.length > 0) {
    throw new AggregateError(failures, "Quarantined images could not be restored.");
  }
  await cleanupQuarantineDirectories(quarantine);
}

export async function finalizeQuarantinedNoteImages(
  quarantine: NoteImageQuarantine,
): Promise<void> {
  try {
    await cleanupQuarantineDirectories(quarantine);
  } catch (error) {
    // The database mutation has committed. A leftover quarantine is safer than
    // turning a successful request into a reported failure.
    console.error("Failed to finalize entry image quarantine.", error);
  }
}

export async function stageNoteImages(
  contentMd: string,
  uploads: ReadonlyMap<string, NoteImageUpload>,
): Promise<StagedNoteImages> {
  const tokens = uploadTokensInMarkdown(contentMd);
  if (tokens.size !== uploads.size || [...tokens].some((token) => !uploads.has(token))) {
    throw new ImageStorageError(
      "INVALID_CONTENT",
      "Every image upload must have one matching placeholder in the entry notes.",
    );
  }

  const entries = [...uploads.entries()];
  entries.forEach(([token]) => assertUploadToken(token));
  const results = await Promise.allSettled(
    entries.map(([, upload]) => saveNoteImage(upload)),
  );
  const imagePaths = results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  const failed = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failed) {
    let quarantine: NoteImageQuarantine;
    try {
      quarantine = await quarantineNoteImages(imagePaths);
    } catch (cleanupError) {
      throw new AggregateError(
        [failed.reason, cleanupError],
        "Image staging failed and completed uploads could not be quarantined.",
      );
    }
    await finalizeQuarantinedNoteImages(quarantine);
    throw failed.reason;
  }

  let updatedContent = contentMd;
  entries.forEach(([token], index) => {
    updatedContent = updatedContent.replaceAll(
      `${NOTE_UPLOAD_PLACEHOLDER_PREFIX}${token}`,
      entryImageUrl(imagePaths[index]),
    );
  });

  return { contentMd: updatedContent, imagePaths };
}

export async function stageEntryImages(
  notesMd: string,
  uploads: ReadonlyMap<string, EntryImageUpload>,
): Promise<StagedEntryImages> {
  const staged = await stageNoteImages(notesMd, uploads);
  return { notesMd: staged.contentMd, imagePaths: staged.imagePaths };
}

export function assertUploadToken(token: string): void {
  if (!uploadTokenPattern.test(token)) {
    throw new ImageStorageError("INVALID_CONTENT", "Invalid image upload token.");
  }
}

export function managedImagePathsInMarkdown(contentMd: string): Set<string> {
  const paths = new Set<string>();
  for (const destination of markdownDestinations(contentMd)) {
    const url = resolveMarkdownDestination(destination);
    if (url === null) continue;
    const match = /^\/api\/uploads\/entries\/([^/]+)$/.exec(url.pathname);
    if (!match) continue;

    let fileName: string;
    try {
      fileName = decodeURIComponent(match[1]);
    } catch {
      throw new ImageStorageError("INVALID_PATH", "Invalid managed image URL.");
    }
    paths.add(normalizeStoredNoteImagePath(fileName));
  }
  return paths;
}

export function normalizeStoredNoteImagePath(imagePathOrFileName: string): string {
  if (typeof imagePathOrFileName !== "string") {
    throw new ImageStorageError("INVALID_PATH", "Invalid image path.");
  }
  const normalized = imagePathOrFileName.trim().replaceAll("\\", "/");
  if (!normalized || normalized.includes("\0") || path.posix.isAbsolute(normalized)) {
    throw new ImageStorageError("INVALID_PATH", "Invalid image path.");
  }

  const prefix = `${NOTE_IMAGE_DIRECTORY}/`;
  const fileName = normalized.startsWith(prefix)
    ? normalized.slice(prefix.length)
    : !normalized.includes("/")
      ? normalized
      : null;
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

function uploadTokensInMarkdown(contentMd: string): Set<string> {
  const tokens = new Set<string>();
  const pattern = /neum-upload:\/\/([^\s)\]}'\"<>]+)/g;
  for (const match of contentMd.matchAll(pattern)) {
    assertUploadToken(match[1]);
    tokens.add(match[1]);
  }
  return tokens;
}

function resolveNoteImagePath(imagePathOrFileName: string): string {
  const imagePath = normalizeStoredNoteImagePath(imagePathOrFileName);
  const fileName = imagePath.slice(`${NOTE_IMAGE_DIRECTORY}/`.length);
  const uploadRoot = resolveNoteImageRoot();
  const absolutePath = path.resolve(uploadRoot, fileName);
  const relative = path.relative(uploadRoot, absolutePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ImageStorageError(
      "INVALID_PATH",
      "The image path is outside the entry uploads directory.",
    );
  }
  if (path.dirname(absolutePath) !== uploadRoot) {
    throw new ImageStorageError(
      "INVALID_PATH",
      "The image path is outside the entry uploads directory.",
    );
  }
  return absolutePath;
}

function resolveNoteImageRoot(): string {
  const configuredUploadDirectory = process.env.NEUM_UPLOAD_DIRECTORY;
  return configuredUploadDirectory === undefined
    ? path.resolve(
        process.cwd(),
        "..",
        "..",
        "data",
        "neum",
        "uploads",
        "entries",
      )
    : path.resolve(
        /*turbopackIgnore: true*/ configuredUploadDirectory,
      );
}

export function entryUploadDirectory(): string {
  return resolveNoteImageRoot();
}

async function cleanupQuarantineDirectories(
  quarantine: NoteImageQuarantine,
): Promise<void> {
  if (quarantine.transactionDirectory !== null) {
    await rm(quarantine.transactionDirectory, { recursive: true, force: true });
  }
  try {
    await rmdir(quarantine.stagingRoot);
  } catch (error) {
    if (
      isNodeError(error) &&
      (error.code === "ENOENT" || error.code === "ENOTEMPTY" || error.code === "EEXIST")
    ) {
      return;
    }
    throw error;
  }
}

const markdownBaseUrl = new URL("https://neum.invalid/entries");

function resolveMarkdownDestination(destination: string): URL | null {
  try {
    const resolved = new URL(destination, markdownBaseUrl);
    return resolved.origin === markdownBaseUrl.origin ? resolved : null;
  } catch {
    return null;
  }
}

function markdownDestinations(contentMd: string): string[] {
  const markdown = withoutMarkdownCode(contentMd);
  return [
    ...inlineMarkdownDestinations(markdown),
    ...referenceDefinitionDestinations(markdown),
  ];
}

function inlineMarkdownDestinations(markdown: string): string[] {
  const destinations: string[] = [];
  for (let index = 0; index < markdown.length; index += 1) {
    if (markdown[index] !== "[" || isEscaped(markdown, index)) continue;
    const labelEnd = findClosingBracket(markdown, index);
    if (labelEnd === -1 || markdown[labelEnd + 1] !== "(") continue;
    const parsed = parseInlineDestination(markdown, labelEnd + 2);
    if (parsed !== null) {
      destinations.push(parsed.destination);
      index = parsed.endIndex;
    }
  }
  return destinations;
}

function referenceDefinitionDestinations(markdown: string): string[] {
  const definitions = new Map<string, string>();
  const pattern = /^[ \t]{0,3}\[[^\]\r\n]+\]:[ \t]*(?:<([^>\r\n]+)>|([^\s]+))/gm;
  for (const match of markdown.matchAll(pattern)) {
    const labelMatch = /^[ \t]{0,3}\[([^\]\r\n]+)\]/.exec(match[0]);
    if (!labelMatch) continue;
    const label = normalizeReferenceLabel(labelMatch[1]);
    if (!definitions.has(label)) definitions.set(label, match[1] ?? match[2]);
  }
  return [...referencedLabels(markdown)].flatMap((label) => {
    const destination = definitions.get(label);
    return destination === undefined ? [] : [destination];
  });
}

function referencedLabels(markdown: string): Set<string> {
  const labels = new Set<string>();
  for (let index = 0; index < markdown.length; index += 1) {
    if (markdown[index] !== "[" || isEscaped(markdown, index)) continue;
    const labelEnd = findClosingBracket(markdown, index);
    if (labelEnd === -1) continue;
    const text = markdown.slice(index + 1, labelEnd);
    const next = markdown[labelEnd + 1];
    if (next === "(" || next === ":") {
      index = labelEnd;
      continue;
    }
    if (next === "[") {
      const referenceEnd = findClosingBracket(markdown, labelEnd + 1);
      if (referenceEnd !== -1) {
        const explicit = markdown.slice(labelEnd + 2, referenceEnd);
        labels.add(normalizeReferenceLabel(explicit || text));
        index = referenceEnd;
      }
      continue;
    }
    labels.add(normalizeReferenceLabel(text));
    index = labelEnd;
  }
  return labels;
}

function normalizeReferenceLabel(label: string): string {
  return label
    .replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, "$1")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function parseInlineDestination(
  markdown: string,
  startIndex: number,
): { destination: string; endIndex: number } | null {
  let index = startIndex;
  while (index < markdown.length && /[ \t\r\n]/.test(markdown[index])) index += 1;
  if (markdown[index] === "<") {
    const end = findUnescaped(markdown, ">", index + 1);
    if (end === -1) return null;
    return { destination: markdown.slice(index + 1, end), endIndex: end };
  }

  let destination = "";
  let nestedParentheses = 0;
  for (; index < markdown.length; index += 1) {
    const character = markdown[index];
    if (character === "\\" && index + 1 < markdown.length) {
      destination += markdown[index + 1];
      index += 1;
      continue;
    }
    if (character === "(" ) {
      nestedParentheses += 1;
      destination += character;
      continue;
    }
    if (character === ")") {
      if (nestedParentheses === 0) {
        return destination ? { destination, endIndex: index } : null;
      }
      nestedParentheses -= 1;
      destination += character;
      continue;
    }
    if (/\s/.test(character)) {
      const closing = findUnescaped(markdown, ")", index);
      return destination && closing !== -1
        ? { destination, endIndex: closing }
        : null;
    }
    destination += character;
  }
  return null;
}

function findClosingBracket(markdown: string, startIndex: number): number {
  let depth = 0;
  for (let index = startIndex; index < markdown.length; index += 1) {
    if (isEscaped(markdown, index)) continue;
    if (markdown[index] === "[") depth += 1;
    if (markdown[index] === "]") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function findUnescaped(markdown: string, target: string, startIndex: number): number {
  for (let index = startIndex; index < markdown.length; index += 1) {
    if (markdown[index] === target && !isEscaped(markdown, index)) return index;
  }
  return -1;
}

function isEscaped(markdown: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && markdown[cursor] === "\\"; cursor -= 1) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

function withoutMarkdownCode(markdown: string): string {
  const lines = markdown.split("\n");
  let fence: { marker: string; length: number } | null = null;
  return lines
    .map((line) => {
      const opening = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(line);
      if (fence !== null) {
        if (
          opening &&
          opening[1][0] === fence.marker &&
          opening[1].length >= fence.length
        ) {
          fence = null;
        }
        return "";
      }
      if (opening) {
        fence = { marker: opening[1][0], length: opening[1].length };
        return "";
      }
      if (/^(?: {4}|\t)/.test(line)) return "";
      return line.replace(/(`+)(.*?)\1/g, "");
    })
    .join("\n");
}

function formatFromFileName(fileName: string): ImageFormat {
  const format = formatsByExtension[path.extname(fileName).toLowerCase()];
  if (!format) {
    throw new ImageStorageError(
      "INVALID_TYPE",
      "Entry images must be PNG, JPEG, WebP, or GIF.",
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
  ) return formatsByMimeType["image/png"];
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
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
  ) return formatsByMimeType["image/webp"];
  return null;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export const entryImageMimeTypes = noteImageMimeTypes;
export type EntryImageMimeType = NoteImageMimeType;
export type EntryImageUpload = NoteImageUpload;
export type StoredEntryImage = StoredNoteImage;
export type EntryImageQuarantine = NoteImageQuarantine;
export const saveEntryImage = saveNoteImage;
export const readEntryImage = readNoteImage;
export const deleteEntryImage = deleteNoteImage;
export const deleteEntryImages = deleteNoteImages;
export const quarantineEntryImages = quarantineNoteImages;
export const restoreQuarantinedEntryImages = restoreQuarantinedNoteImages;
export const finalizeQuarantinedEntryImages = finalizeQuarantinedNoteImages;
export const normalizeStoredEntryImagePath = normalizeStoredNoteImagePath;
