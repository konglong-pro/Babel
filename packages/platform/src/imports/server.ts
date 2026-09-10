import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import {
  MARKDOWN_FOLDER_MAX_FILES,
  MARKDOWN_FOLDER_MAX_IMAGE_BYTES,
  MARKDOWN_FOLDER_MAX_IMAGE_FILE_BYTES,
  MARKDOWN_FOLDER_MAX_MARKDOWN_BYTES,
  MARKDOWN_FOLDER_MAX_NOTE_BYTES,
  MarkdownFolderImportError,
  analyzeMarkdownFolder,
  folderImportPathKey,
  normalizeFolderImportRelativePath,
  normalizeFolderImportTitle,
  renderMarkdownFolderNote,
  type FolderImportFileLike,
  type MarkdownFolderCommitManifest,
  type MarkdownFolderReviewRecord,
} from "./core";

const sessionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const sessionTtlMs = 60 * 60 * 1_000;
const metadataVersion = 1;

export interface FolderImportSessionFile {
  path: string;
  kind: "markdown" | "image";
  size: number;
  type: string;
  storedName: string;
  absolutePath: string;
}

export interface FolderImportSessionSnapshot {
  id: string;
  createdAt: string;
  files: FolderImportSessionFile[];
}

export interface PreparedMarkdownFolderRecord extends MarkdownFolderReviewRecord {
  contentMd: string;
  images: Array<{
    path: string;
    token: string;
    file: FolderImportSessionFile;
  }>;
}

interface StoredSessionMetadata {
  version: number;
  id: string;
  createdAt: string;
  files: Array<{
    path: string;
    kind: "markdown" | "image";
    size: number;
    type: string;
    storedName: string;
  }>;
}

const sessionLocks = new Map<string, Promise<void>>();

export async function createMarkdownFolderImportSession(
  stagingRoot: string,
): Promise<{ id: string; expiresAt: string }> {
  const root = normalizeStagingRoot(stagingRoot);
  await mkdir(root, { recursive: true });
  await cleanupExpiredMarkdownFolderImportSessions(root);
  const id = randomUUID();
  const createdAt = new Date();
  const directory = sessionDirectory(root, id);
  await mkdir(path.join(directory, "files"), { recursive: true });
  await writeMetadata(directory, {
    version: metadataVersion,
    id,
    createdAt: createdAt.toISOString(),
    files: [],
  });
  return { id, expiresAt: new Date(createdAt.getTime() + sessionTtlMs).toISOString() };
}

export async function uploadMarkdownFolderImportFile(
  stagingRoot: string,
  sessionId: string,
  sourcePath: string,
  kind: "markdown" | "image",
  file: FolderImportFileLike,
): Promise<{ path: string; size: number }> {
  const root = normalizeStagingRoot(stagingRoot);
  const normalizedPath = normalizeFolderImportRelativePath(sourcePath);
  return withSessionLock(root, sessionId, async () => {
    const directory = sessionDirectory(root, sessionId);
    const metadata = await readMetadata(directory, sessionId);
    assertSessionActive(metadata);
    validateUpload(normalizedPath, kind, file);
    if (metadata.files.some((entry) => folderImportPathKey(entry.path) === folderImportPathKey(normalizedPath))) {
      throw new MarkdownFolderImportError(
        "DUPLICATE_PATH",
        `The path ${normalizedPath} was already uploaded.`,
        { path: normalizedPath },
        409,
      );
    }

    const nextFiles = [...metadata.files, {
      path: normalizedPath,
      kind,
      size: file.size,
      type: file.type || contentTypeForPath(normalizedPath),
      storedName: storedFileName(normalizedPath),
    }];
    assertBatchUploadLimits(nextFiles);
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.byteLength !== file.size) {
      throw new MarkdownFolderImportError(
        "INVALID_CONTENT",
        `The uploaded size for ${normalizedPath} changed while reading it.`,
        { path: normalizedPath },
      );
    }
    const storedPath = path.join(directory, "files", nextFiles.at(-1)!.storedName);
    await writeFile(storedPath, bytes, { flag: "wx" });
    try {
      await writeMetadata(directory, { ...metadata, files: nextFiles });
    } catch (error) {
      await rm(storedPath, { force: true });
      throw error;
    }
    return { path: normalizedPath, size: bytes.byteLength };
  });
}

export async function readMarkdownFolderImportSession(
  stagingRoot: string,
  sessionId: string,
): Promise<FolderImportSessionSnapshot> {
  const root = normalizeStagingRoot(stagingRoot);
  const directory = sessionDirectory(root, sessionId);
  const metadata = await readMetadata(directory, sessionId);
  assertSessionActive(metadata);
  const files: FolderImportSessionFile[] = [];
  for (const entry of metadata.files) {
    const absolutePath = path.join(directory, "files", entry.storedName);
    const fileStat = await stat(absolutePath).catch(() => null);
    if (!fileStat?.isFile() || fileStat.size !== entry.size) {
      throw new MarkdownFolderImportError(
        "INVALID_SESSION",
        `Staged file ${entry.path} is missing or changed.`,
        { path: entry.path },
        409,
      );
    }
    files.push({ ...entry, absolutePath });
  }
  return { id: metadata.id, createdAt: metadata.createdAt, files };
}

export async function prepareMarkdownFolderImport(
  stagingRoot: string,
  sessionId: string,
  rawManifest: unknown,
  options: {
    existingTitles: readonly string[];
    uploadPlaceholderPrefix: string;
  },
): Promise<{
  manifest: MarkdownFolderCommitManifest;
  records: PreparedMarkdownFolderRecord[];
}> {
  const manifest = parseManifest(rawManifest);
  const session = await readMarkdownFolderImportSession(stagingRoot, sessionId);
  const markdownFiles = session.files.filter(({ kind }) => kind === "markdown");
  const availableFiles = session.files.map((file) => ({
    path: file.path,
    size: file.size,
    type: file.type,
  }));
  const sources = [];
  for (const file of markdownFiles) {
    const bytes = await readFile(file.absolutePath);
    let contentMd: string;
    try {
      contentMd = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new MarkdownFolderImportError(
        "INVALID_UTF8",
        `${file.path} is not valid UTF-8 Markdown.`,
        { path: file.path },
      );
    }
    if (contentMd.startsWith("\uFEFF")) contentMd = contentMd.slice(1);
    sources.push({ path: file.path, contentMd, size: bytes.byteLength });
  }

  const analysis = analyzeMarkdownFolder(sources, availableFiles);
  const blockingIssues = [
    ...analysis.issues,
    ...analysis.notes.flatMap((note) => note.issues.filter(({ blocking }) => blocking)),
  ];
  if (blockingIssues.length > 0) {
    throw new MarkdownFolderImportError(
      "PREFLIGHT_FAILED",
      blockingIssues[0].message,
      { issues: blockingIssues },
    );
  }

  const recordsByKey = new Map(manifest.records.map((record) => [
    folderImportPathKey(record.sourcePath),
    record,
  ]));
  if (
    recordsByKey.size !== manifest.records.length ||
    recordsByKey.size !== analysis.notes.length ||
    analysis.notes.some((note) => !recordsByKey.has(folderImportPathKey(note.sourcePath)))
  ) {
    throw new MarkdownFolderImportError(
      "INVALID_MANIFEST",
      "The reviewed file list does not match the staged Markdown files.",
    );
  }

  const uploadedImageKeys = new Set(
    session.files.filter(({ kind }) => kind === "image").map(({ path }) => folderImportPathKey(path)),
  );
  const referencedImageKeys = new Set(analysis.assets.map(({ path }) => folderImportPathKey(path)));
  if (
    uploadedImageKeys.size !== referencedImageKeys.size ||
    [...uploadedImageKeys].some((key) => !referencedImageKeys.has(key))
  ) {
    throw new MarkdownFolderImportError(
      "INVALID_MANIFEST",
      "The staged images do not exactly match the images referenced by the Markdown files.",
    );
  }

  assertUniqueTitles(manifest.records, options.existingTitles);
  const titlesBySourcePath = new Map(
    manifest.records.map((record) => [record.sourcePath, record.title.trim()]),
  );
  const filesByKey = new Map(session.files.map((file) => [folderImportPathKey(file.path), file]));
  const records: PreparedMarkdownFolderRecord[] = analysis.notes.map((note) => {
    const record = recordsByKey.get(folderImportPathKey(note.sourcePath))!;
    for (const linkIssue of note.linkIssues) {
      const decision = record.linkDecisions[linkIssue.id];
      if (
        decision !== "preserve" &&
        (typeof decision !== "string" || !linkIssue.candidateSourcePaths.includes(decision))
      ) {
        throw new MarkdownFolderImportError(
          "AMBIGUOUS_LINK",
          `Wikilink “${linkIssue.target}” in ${note.sourcePath} needs an explicit decision.`,
          linkIssue,
        );
      }
    }
    const rendered = renderMarkdownFolderNote({
      sourcePath: note.sourcePath,
      contentMd: note.contentMd,
      titlesBySourcePath,
      linkDecisions: record.linkDecisions,
      uploadPlaceholderPrefix: options.uploadPlaceholderPrefix,
    });
    return {
      ...record,
      contentMd: rendered.contentMd,
      images: rendered.images.map((image) => {
        const file = filesByKey.get(folderImportPathKey(image.path));
        if (!file || file.kind !== "image") {
          throw new MarkdownFolderImportError(
            "IMAGE_NOT_FOUND",
            `Staged image ${image.path} is missing.`,
            { sourcePath: note.sourcePath, path: image.path },
          );
        }
        return { ...image, file };
      }),
    };
  });
  return { manifest, records };
}

export function folderImportImageUpload(file: FolderImportSessionFile): FolderImportFileLike {
  return {
    name: path.basename(file.path),
    size: file.size,
    type: file.type || contentTypeForPath(file.path),
    async arrayBuffer() {
      const buffer = await readFile(file.absolutePath);
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    },
  };
}

export async function deleteMarkdownFolderImportSession(
  stagingRoot: string,
  sessionId: string,
): Promise<void> {
  const root = normalizeStagingRoot(stagingRoot);
  const directory = sessionDirectory(root, sessionId);
  await rm(directory, { recursive: true, force: true });
}

/** Best-effort rollback boundary: malformed ids cannot name a filesystem target. */
export async function cleanupMarkdownFolderImportSession(
  stagingRoot: string,
  sessionId: string,
): Promise<void> {
  if (!sessionIdPattern.test(sessionId)) return;
  const root = normalizeStagingRoot(stagingRoot);
  await rm(sessionDirectory(root, sessionId), { recursive: true, force: true });
}

export async function cleanupExpiredMarkdownFolderImportSessions(
  stagingRoot: string,
): Promise<void> {
  const root = normalizeStagingRoot(stagingRoot);
  const entries = await readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const now = Date.now();
  for (const entry of entries) {
    if (!entry.isDirectory() || !sessionIdPattern.test(entry.name)) continue;
    const directory = sessionDirectory(root, entry.name);
    try {
      const metadata = await readMetadata(directory, entry.name);
      if (now - Date.parse(metadata.createdAt) <= sessionTtlMs) continue;
    } catch {
      // Invalid session directories use the same UUID-only deletion boundary.
    }
    await rm(directory, { recursive: true, force: true });
  }
}

/** Runs every rollback step and preserves both the original failure and cleanup failures. */
export async function rethrowAfterMarkdownFolderImportCleanup(
  cause: unknown,
  cleanupSteps: ReadonlyArray<() => Promise<void>>,
): Promise<never> {
  const failures: unknown[] = [];
  for (const cleanup of cleanupSteps) {
    try {
      await cleanup();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(
      [cause, ...failures],
      "Folder import failed and one or more rollback steps also failed.",
    );
  }
  throw cause;
}

function parseManifest(value: unknown): MarkdownFolderCommitManifest {
  if (!isRecord(value) || !isPositiveInteger(value.baseFolderId) || !Array.isArray(value.records)) {
    throw new MarkdownFolderImportError("INVALID_MANIFEST", "Invalid folder-import manifest.");
  }
  const records = value.records.map(parseReviewRecord);
  return { baseFolderId: value.baseFolderId, records };
}

function parseReviewRecord(value: unknown): MarkdownFolderReviewRecord {
  if (!isRecord(value)) throw new MarkdownFolderImportError("INVALID_MANIFEST", "Invalid import record.");
  const sourcePath = typeof value.sourcePath === "string"
    ? normalizeFolderImportRelativePath(value.sourcePath)
    : invalidManifest("Invalid source path.");
  const title = typeof value.title === "string" && value.title.trim()
    ? value.title.trim()
    : invalidManifest(`A title is required for ${sourcePath}.`);
  const folder = parseTarget(value.folder);
  const parent = parseParent(value.parent);
  if (!Array.isArray(value.tags) || value.tags.some((tag) => typeof tag !== "string")) {
    return invalidManifest(`Invalid tags for ${sourcePath}.`);
  }
  const tags = [...new Set(value.tags.map((tag) => tag.trim()).filter(Boolean))];
  if (!isRecord(value.linkDecisions) || Object.values(value.linkDecisions).some((item) => typeof item !== "string")) {
    return invalidManifest(`Invalid link decisions for ${sourcePath}.`);
  }
  return {
    sourcePath,
    title,
    folder,
    parent,
    tags,
    linkDecisions: value.linkDecisions as Record<string, string>,
  };
}

function parseTarget(value: unknown): MarkdownFolderReviewRecord["folder"] {
  if (!isRecord(value)) return invalidManifest("Invalid destination folder.");
  if (value.kind === "existing" && isPositiveInteger(value.folderId)) {
    return { kind: "existing", folderId: value.folderId };
  }
  if (value.kind === "mapped" && typeof value.path === "string") {
    const mappedPath = value.path === "" ? "" : normalizeFolderImportRelativePath(value.path);
    return { kind: "mapped", path: mappedPath };
  }
  return invalidManifest("Invalid destination folder.");
}

function parseParent(value: unknown): MarkdownFolderReviewRecord["parent"] {
  if (value === null) return null;
  if (!isRecord(value)) return invalidManifest("Invalid parent page.");
  if (value.kind === "existing" && isPositiveInteger(value.id)) {
    return { kind: "existing", id: value.id };
  }
  if (value.kind === "batch" && typeof value.sourcePath === "string") {
    return { kind: "batch", sourcePath: normalizeFolderImportRelativePath(value.sourcePath) };
  }
  return invalidManifest("Invalid parent page.");
}

function assertUniqueTitles(
  records: readonly MarkdownFolderReviewRecord[],
  existingTitles: readonly string[],
): void {
  const occupied = new Set(existingTitles.map(normalizeFolderImportTitle));
  for (const record of records) {
    const key = normalizeFolderImportTitle(record.title);
    if (!key || occupied.has(key)) {
      throw new MarkdownFolderImportError(
        "TITLE_CONFLICT",
        `The reviewed title “${record.title}” is already used.`,
        { sourcePath: record.sourcePath, title: record.title },
        409,
      );
    }
    occupied.add(key);
  }
}

function validateUpload(
  sourcePath: string,
  kind: "markdown" | "image",
  file: FolderImportFileLike,
): void {
  if (!Number.isSafeInteger(file.size) || file.size < 0) {
    throw new MarkdownFolderImportError("INVALID_CONTENT", "Invalid uploaded file size.");
  }
  if (kind === "markdown") {
    if (!/\.md$/iu.test(sourcePath)) {
      throw new MarkdownFolderImportError("INVALID_FILE_TYPE", "Markdown uploads must use .md.");
    }
    if (file.size > MARKDOWN_FOLDER_MAX_NOTE_BYTES) {
      throw new MarkdownFolderImportError("FILE_TOO_LARGE", `${sourcePath} exceeds 10 MiB.`);
    }
    return;
  }
  if (!/\.(?:png|jpe?g|webp|gif)$/iu.test(sourcePath)) {
    throw new MarkdownFolderImportError(
      "INVALID_FILE_TYPE",
      "Image uploads must be PNG, JPEG, WebP, or GIF.",
    );
  }
  if (file.size > MARKDOWN_FOLDER_MAX_IMAGE_FILE_BYTES) {
    throw new MarkdownFolderImportError("FILE_TOO_LARGE", `${sourcePath} exceeds 10 MiB.`);
  }
}

function assertBatchUploadLimits(files: StoredSessionMetadata["files"]): void {
  const markdown = files.filter(({ kind }) => kind === "markdown");
  const images = files.filter(({ kind }) => kind === "image");
  if (markdown.length > MARKDOWN_FOLDER_MAX_FILES) {
    throw new MarkdownFolderImportError("TOO_MANY_FILES", "A folder import supports at most 1000 Markdown files.");
  }
  if (markdown.reduce((sum, file) => sum + file.size, 0) > MARKDOWN_FOLDER_MAX_MARKDOWN_BYTES) {
    throw new MarkdownFolderImportError("TOTAL_TOO_LARGE", "Markdown files exceed 250 MiB.");
  }
  if (images.reduce((sum, file) => sum + file.size, 0) > MARKDOWN_FOLDER_MAX_IMAGE_BYTES) {
    throw new MarkdownFolderImportError("TOTAL_TOO_LARGE", "Referenced images exceed 1 GiB.");
  }
}

function storedFileName(sourcePath: string): string {
  return `${createHash("sha256").update(sourcePath).digest("hex")}.bin`;
}

function contentTypeForPath(sourcePath: string): string {
  const lower = sourcePath.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "text/markdown";
}

function normalizeStagingRoot(value: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new MarkdownFolderImportError("INVALID_PATH", "Invalid folder-import staging root.", undefined, 500);
  }
  return path.resolve(value);
}

function sessionDirectory(root: string, sessionId: string): string {
  if (!sessionIdPattern.test(sessionId)) {
    throw new MarkdownFolderImportError("INVALID_SESSION", "Invalid folder-import session.", undefined, 404);
  }
  const directory = path.resolve(root, sessionId);
  if (path.dirname(directory) !== root) {
    throw new MarkdownFolderImportError("INVALID_SESSION", "Invalid folder-import session.", undefined, 404);
  }
  return directory;
}

async function readMetadata(directory: string, expectedId: string): Promise<StoredSessionMetadata> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path.join(directory, "session.json"), "utf8"));
  } catch {
    throw new MarkdownFolderImportError("INVALID_SESSION", "Folder-import session not found.", undefined, 404);
  }
  if (
    !isRecord(value) ||
    value.version !== metadataVersion ||
    value.id !== expectedId ||
    typeof value.createdAt !== "string" ||
    !Array.isArray(value.files)
  ) {
    throw new MarkdownFolderImportError("INVALID_SESSION", "Folder-import session is invalid.", undefined, 409);
  }
  const files: StoredSessionMetadata["files"] = [];
  const seen = new Set<string>();
  for (const rawFile of value.files) {
    if (
      !isRecord(rawFile) ||
      typeof rawFile.path !== "string" ||
      (rawFile.kind !== "markdown" && rawFile.kind !== "image") ||
      !Number.isSafeInteger(rawFile.size) ||
      (rawFile.size as number) < 0 ||
      typeof rawFile.type !== "string" ||
      typeof rawFile.storedName !== "string" ||
      !/^[0-9a-f]{64}\.bin$/u.test(rawFile.storedName)
    ) {
      throw new MarkdownFolderImportError("INVALID_SESSION", "Folder-import session is invalid.", undefined, 409);
    }
    let normalizedPath: string;
    try {
      normalizedPath = normalizeFolderImportRelativePath(rawFile.path);
    } catch {
      throw new MarkdownFolderImportError("INVALID_SESSION", "Folder-import session is invalid.", undefined, 409);
    }
    const key = folderImportPathKey(normalizedPath);
    if (seen.has(key) || rawFile.storedName !== storedFileName(normalizedPath)) {
      throw new MarkdownFolderImportError("INVALID_SESSION", "Folder-import session is invalid.", undefined, 409);
    }
    seen.add(key);
    files.push({
      path: normalizedPath,
      kind: rawFile.kind,
      size: rawFile.size as number,
      type: rawFile.type,
      storedName: rawFile.storedName,
    });
  }
  assertBatchUploadLimits(files);
  return {
    version: metadataVersion,
    id: expectedId,
    createdAt: value.createdAt,
    files,
  };
}

async function writeMetadata(directory: string, metadata: StoredSessionMetadata): Promise<void> {
  const target = path.join(directory, "session.json");
  const temporary = path.join(directory, `session-${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(metadata)}\n`, { flag: "wx" });
  try {
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

function assertSessionActive(metadata: StoredSessionMetadata): void {
  const createdAt = Date.parse(metadata.createdAt);
  if (!Number.isFinite(createdAt) || Date.now() - createdAt > sessionTtlMs) {
    throw new MarkdownFolderImportError("SESSION_EXPIRED", "Folder-import session expired.", undefined, 410);
  }
}

async function withSessionLock<T>(
  root: string,
  sessionId: string,
  work: () => Promise<T>,
): Promise<T> {
  const key = `${root}\0${sessionId}`;
  const previous = sessionLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => current);
  sessionLocks.set(key, tail);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (sessionLocks.get(key) === tail) sessionLocks.delete(key);
  }
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidManifest(message: string): never {
  throw new MarkdownFolderImportError("INVALID_MANIFEST", message);
}
