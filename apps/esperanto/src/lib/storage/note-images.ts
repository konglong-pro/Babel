import { randomUUID } from "node:crypto";
import {
  mkdir,
  lstat,
  readdir,
  readFile,
  rename,
  rm,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import {
  NOTE_CONTENT_MAX_BYTES,
  NOTE_IMAGE_MAX_BYTES,
  NOTE_NEW_IMAGE_MAX_COUNT,
  NOTE_SAVE_MAX_BYTES,
  utf8ByteLength,
} from "@/lib/note-limits";
import { noteImageUrl } from "@/lib/types";

import { ImageStorageError } from "./errors";

export {
  NOTE_CONTENT_MAX_BYTES,
  NOTE_IMAGE_MAX_BYTES,
  NOTE_MULTIPART_WIRE_MAX_BYTES,
  NOTE_NEW_IMAGE_MAX_COUNT,
  NOTE_SAVE_MAX_BYTES,
} from "@/lib/note-limits";
export const NOTE_IMAGE_DIRECTORY = "data/uploads/notes";
export const NOTE_UPLOAD_PLACEHOLDER_PREFIX = "esperanto-upload://";

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
const generatedImageFileNamePattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:png|jpg|webp|gif)$/;
const generatedTransactionDirectoryPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export async function saveNoteImage(upload: NoteImageUpload): Promise<string> {
  const declaredType = upload.type.toLowerCase() as NoteImageMimeType;
  const declaredFormat = formatsByMimeType[declaredType];
  if (!declaredFormat) {
    throw new ImageStorageError(
      "INVALID_TYPE",
      "Note images must be PNG, JPEG, WebP, or GIF.",
    );
  }
  assertDeclaredImageSize(upload.size);
  if (upload.size === 0) {
    throw new ImageStorageError("EMPTY_FILE", "The image file is empty.");
  }

  const data = Buffer.from(await upload.arrayBuffer());
  if (data.byteLength === 0) {
    throw new ImageStorageError("EMPTY_FILE", "The image file is empty.");
  }
  if (data.byteLength > NOTE_IMAGE_MAX_BYTES) {
    throw new ImageStorageError("FILE_TOO_LARGE", "Image files must not exceed 10 MiB.");
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
      throw new ImageStorageError("NOT_FOUND", "Note image not found.");
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

export async function reconcileNoteImageStorage(
  ownedImagePaths: ReadonlySet<string>,
): Promise<void> {
  const uploadRoot = resolveNoteImageRoot();
  const stagingRoot = path.join(uploadRoot, ".staging");
  await mkdir(uploadRoot, { recursive: true });

  const transactions = await readDirectoryEntries(stagingRoot);
  for (const transaction of transactions) {
    if (
      !transaction.isDirectory() ||
      !generatedTransactionDirectoryPattern.test(transaction.name)
    ) {
      continue;
    }
    const transactionDirectory = path.join(stagingRoot, transaction.name);
    const stagedFiles = await readDirectoryEntries(transactionDirectory);
    for (const stagedFile of stagedFiles) {
      if (
        !stagedFile.isFile() ||
        !generatedImageFileNamePattern.test(stagedFile.name)
      ) {
        continue;
      }
      const imagePath = `${NOTE_IMAGE_DIRECTORY}/${stagedFile.name}`;
      const stagedPath = path.join(transactionDirectory, stagedFile.name);
      if (!ownedImagePaths.has(imagePath)) {
        await unlinkIfPresent(stagedPath);
        continue;
      }

      const finalPath = path.join(uploadRoot, stagedFile.name);
      if (await fileExists(finalPath)) {
        await unlinkIfPresent(stagedPath);
      } else {
        await rename(stagedPath, finalPath);
      }
    }
    await removeDirectoryIfEmpty(transactionDirectory);
  }
  await removeDirectoryIfEmpty(stagingRoot);

  const finalEntries = await readDirectoryEntries(uploadRoot);
  for (const entry of finalEntries) {
    if (!entry.isFile() || !generatedImageFileNamePattern.test(entry.name)) continue;
    const imagePath = `${NOTE_IMAGE_DIRECTORY}/${entry.name}`;
    if (!ownedImagePaths.has(imagePath)) {
      await unlinkIfPresent(path.join(uploadRoot, entry.name));
    }
  }
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
    console.error("Failed to finalize note image quarantine.", error);
  }
}

export async function stageNoteImages(
  contentMd: string,
  uploads: ReadonlyMap<string, NoteImageUpload>,
): Promise<StagedNoteImages> {
  assertNoteSaveLimits(contentMd, uploads);
  const tokens = uploadTokensInMarkdown(contentMd);
  if (tokens.size !== uploads.size || [...tokens].some((token) => !uploads.has(token))) {
    throw new ImageStorageError(
      "INVALID_CONTENT",
      "Every image upload must have one matching placeholder in the note content.",
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
    await discardStagedNoteImages(imagePaths, failed.reason);
  }

  let updatedContent = contentMd;
  entries.forEach(([token], index) => {
    updatedContent = updatedContent.replaceAll(
      `${NOTE_UPLOAD_PLACEHOLDER_PREFIX}${token}`,
      noteImageUrl(imagePaths[index]),
    );
  });

  try {
    assertNoteSaveLimits(updatedContent, uploads);
  } catch (error) {
    await discardStagedNoteImages(imagePaths, error);
  }

  return { contentMd: updatedContent, imagePaths };
}

export function assertNoteSaveLimits(
  contentMd: string,
  uploads: ReadonlyMap<string, NoteImageUpload>,
): void {
  const contentBytes = assertNoteContentSize(contentMd);
  if (uploads.size > NOTE_NEW_IMAGE_MAX_COUNT) {
    throw new ImageStorageError(
      "TOO_MANY_IMAGES",
      "A note save may include at most 50 new images.",
    );
  }

  let logicalBytes = contentBytes;
  for (const upload of uploads.values()) {
    assertDeclaredImageSize(upload.size);
    logicalBytes += upload.size;
    if (logicalBytes > NOTE_SAVE_MAX_BYTES) {
      throw new ImageStorageError(
        "REQUEST_TOO_LARGE",
        "Markdown content and new images must not exceed 100 MiB in total.",
      );
    }
  }
}

function assertNoteContentSize(contentMd: string): number {
  const bytes = utf8ByteLength(contentMd);
  if (bytes > NOTE_CONTENT_MAX_BYTES) {
    throw new ImageStorageError(
      "CONTENT_TOO_LARGE",
      "Markdown content must not exceed 10 MiB.",
    );
  }
  return bytes;
}

function assertDeclaredImageSize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new ImageStorageError("INVALID_CONTENT", "Invalid image size.");
  }
  if (size > NOTE_IMAGE_MAX_BYTES) {
    throw new ImageStorageError("FILE_TOO_LARGE", "Image files must not exceed 10 MiB.");
  }
}

async function discardStagedNoteImages(
  imagePaths: readonly string[],
  cause: unknown,
): Promise<never> {
  let quarantine: NoteImageQuarantine;
  try {
    quarantine = await quarantineNoteImages(imagePaths);
  } catch (cleanupError) {
    throw new AggregateError(
      [cause, cleanupError],
      "Image staging failed and completed uploads could not be quarantined.",
    );
  }
  await finalizeQuarantinedNoteImages(quarantine);
  throw cause;
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
    const match = /^\/api\/uploads\/notes\/([^/]+)$/.exec(url.pathname);
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
  const pattern = /esperanto-upload:\/\/([^\s)\]}'\"<>]+)/g;
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
      "The image path is outside the note uploads directory.",
    );
  }
  if (path.dirname(absolutePath) !== uploadRoot) {
    throw new ImageStorageError(
      "INVALID_PATH",
      "The image path is outside the note uploads directory.",
    );
  }
  return absolutePath;
}

function resolveNoteImageRoot(): string {
  const configuredUploadDirectory = process.env.ESPERANTO_UPLOAD_DIRECTORY;
  return configuredUploadDirectory === undefined
    ? path.resolve(
        process.cwd(),
        "..",
        "..",
        "data",
        "esperanto",
        "uploads",
        "notes",
      )
    : path.resolve(
        /*turbopackIgnore: true*/ configuredUploadDirectory,
      );
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

const markdownBaseUrl = new URL("https://esperanto.invalid/notes");

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
      "Note images must be PNG, JPEG, WebP, or GIF.",
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

async function readDirectoryEntries(directory: string) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const entry = await lstat(filePath);
    if (!entry.isFile()) {
      throw new ImageStorageError(
        "INVALID_PATH",
        "A managed image path is occupied by a non-file entry.",
      );
    }
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

async function unlinkIfPresent(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    throw error;
  }
}

async function removeDirectoryIfEmpty(directory: string): Promise<void> {
  try {
    await rmdir(directory);
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
