import path from "node:path";

import {
  ENTRY_IMAGE_DIRECTORY,
  ENTRY_IMAGE_MAX_BYTES as MANAGED_ENTRY_IMAGE_MAX_BYTES,
  managedImagePathsInMarkdown,
} from "../storage";
import { identityKey } from "../identity";

import { SnapshotError } from "./errors";
import {
  NEUM_LEGACY_SNAPSHOT_SCHEMA_VERSION,
  NEUM_SNAPSHOT_APP_ID,
  NEUM_SNAPSHOT_SCHEMA_VERSION,
  snapshotImageContentTypes,
  type NeumSnapshotManifest,
  type SnapshotEntry,
  type SnapshotEntryImageReference,
  type SnapshotEntryKind,
  type SnapshotEntryRecord,
  type SnapshotFolder,
  type SnapshotImage,
  type SnapshotImageContentType,
  type SnapshotTag,
  type SnapshotTrashEntry,
  type SnapshotTrashPayload,
} from "./types";

export const ENTRY_IMAGE_LOGICAL_DIRECTORY = ENTRY_IMAGE_DIRECTORY;
export const ENTRY_IMAGE_MAX_BYTES = MANAGED_ENTRY_IMAGE_MAX_BYTES;

const sha256Pattern = /^[a-f0-9]{64}$/;
const imageFileNamePattern = /^[A-Za-z0-9._-]+$/;
const imageContentTypeSet = new Set<string>(snapshotImageContentTypes);

export function parseSnapshotManifest(source: string): NeumSnapshotManifest {
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch (error) {
    throw new SnapshotError(
      "INVALID_MANIFEST",
      "manifest.json is not valid JSON.",
      { cause: error },
    );
  }
  return validateSnapshotManifest(value);
}

export function validateSnapshotManifest(value: unknown): NeumSnapshotManifest {
  const manifest = record(value, "manifest");
  exactKeys(
    manifest,
    [
      "appId",
      "schemaVersion",
      "exportedAt",
      "folders",
      "entries",
      "tags",
      "trash",
      "images",
    ],
    "manifest",
  );
  if (manifest.appId !== NEUM_SNAPSHOT_APP_ID) {
    invalid(`manifest.appId must be ${JSON.stringify(NEUM_SNAPSHOT_APP_ID)}.`);
  }
  const sourceSchemaVersion = manifest.schemaVersion;
  if (
    sourceSchemaVersion !== NEUM_SNAPSHOT_SCHEMA_VERSION &&
    sourceSchemaVersion !== NEUM_LEGACY_SNAPSHOT_SCHEMA_VERSION
  ) {
    invalid(
      `manifest.schemaVersion must be ${NEUM_LEGACY_SNAPSHOT_SCHEMA_VERSION} or ${NEUM_SNAPSHOT_SCHEMA_VERSION}.`,
    );
  }

  const parsed: NeumSnapshotManifest = {
    appId: NEUM_SNAPSHOT_APP_ID,
    schemaVersion: NEUM_SNAPSHOT_SCHEMA_VERSION,
    exportedAt: timestamp(manifest.exportedAt, "manifest.exportedAt"),
    folders: array(manifest.folders, "manifest.folders").map((item, index) =>
      folder(item, `manifest.folders[${index}]`),
    ),
    entries: array(manifest.entries, "manifest.entries").map((item, index) =>
      entry(item, `manifest.entries[${index}]`, sourceSchemaVersion),
    ),
    tags: array(manifest.tags, "manifest.tags").map((item, index) =>
      tag(item, `manifest.tags[${index}]`),
    ),
    trash: array(manifest.trash, "manifest.trash").map((item, index) =>
      trashEntry(item, `manifest.trash[${index}]`, sourceSchemaVersion),
    ),
    images: array(manifest.images, "manifest.images").map((item, index) =>
      image(item, `manifest.images[${index}]`),
    ),
  };
  validateRelationships(parsed);
  return parsed;
}

export function normalizeSnapshotImagePath(imagePath: string): string {
  if (typeof imagePath !== "string") {
    invalid("Image paths must be strings.");
  }
  const normalized = imagePath.replaceAll("\\", "/");
  const prefix = `${ENTRY_IMAGE_LOGICAL_DIRECTORY}/`;
  if (
    normalized !== imagePath ||
    !normalized.startsWith(prefix) ||
    normalized.includes("\0") ||
    path.posix.isAbsolute(normalized)
  ) {
    invalid(`Invalid managed image path: ${JSON.stringify(imagePath)}.`);
  }
  const fileName = normalized.slice(prefix.length);
  if (
    !fileName ||
    fileName !== path.posix.basename(fileName) ||
    fileName === "." ||
    fileName === ".." ||
    !imageFileNamePattern.test(fileName)
  ) {
    invalid(`Invalid managed image path: ${JSON.stringify(imagePath)}.`);
  }
  const extension = path.posix.extname(fileName).toLowerCase();
  if (![".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(extension)) {
    invalid(`Unsupported managed image extension: ${JSON.stringify(imagePath)}.`);
  }
  return `${prefix}${fileName}`;
}

export function snapshotImageFileName(imagePath: string): string {
  return path.posix.basename(normalizeSnapshotImagePath(imagePath));
}

export function referencedSnapshotImagePaths(
  manifest: Pick<NeumSnapshotManifest, "entries" | "trash">,
): Set<string> {
  const paths = new Set<string>();
  for (const item of manifest.entries) {
    for (const imageReference of item.images) paths.add(imageReference.imagePath);
  }
  for (const item of manifest.trash) {
    for (const imagePath of item.snapshot.imagePaths) paths.add(imagePath);
  }
  return paths;
}

function folder(value: unknown, label: string): SnapshotFolder {
  const item = record(value, label);
  exactKeys(item, ["id", "parentId", "name", "createdAt", "updatedAt"], label);
  const name = trimmedString(item.name, `${label}.name`);
  return {
    id: positiveInteger(item.id, `${label}.id`),
    parentId:
      item.parentId === null
        ? null
        : positiveInteger(item.parentId, `${label}.parentId`),
    name,
    createdAt: timestamp(item.createdAt, `${label}.createdAt`),
    updatedAt: timestamp(item.updatedAt, `${label}.updatedAt`),
  };
}

function tag(value: unknown, label: string): SnapshotTag {
  const item = record(value, label);
  exactKeys(item, ["id", "name"], label);
  return {
    id: positiveInteger(item.id, `${label}.id`),
    name: trimmedString(item.name, `${label}.name`),
  };
}

function entry(
  value: unknown,
  label: string,
  sourceSchemaVersion: number,
): SnapshotEntry {
  const item = record(value, label);
  exactKeys(
    item,
    [
      "id",
      ...(sourceSchemaVersion >= 2 ? ["parentId"] : []),
      "folderId",
      "kind",
      "title",
      "notesMd",
      "code",
      "language",
      "filename",
      "version",
      "createdAt",
      "updatedAt",
      "tagIds",
      "images",
    ],
    label,
  );
  const base = entryRecord(item, label, false, sourceSchemaVersion);
  const tagIds = array(item.tagIds, `${label}.tagIds`).map((tagId, index) =>
    positiveInteger(tagId, `${label}.tagIds[${index}]`),
  );
  noDuplicates(tagIds, `${label}.tagIds`);
  const images = array(item.images, `${label}.images`).map((imageItem, index) =>
    entryImageReference(imageItem, `${label}.images[${index}]`),
  );
  return { ...base, tagIds, images };
}

function entryRecord(
  value: Record<string, unknown>,
  label: string,
  checkKeys: boolean,
  sourceSchemaVersion: number,
): SnapshotEntryRecord {
  if (checkKeys) {
    exactKeys(
      value,
      [
        "id",
        ...(sourceSchemaVersion >= 2 ? ["parentId"] : []),
        "folderId",
        "kind",
        "title",
        "notesMd",
        "code",
        "language",
        "filename",
        "version",
        "createdAt",
        "updatedAt",
      ],
      label,
    );
  }
  const kind = entryKind(value.kind, `${label}.kind`);
  const code = nullableString(value.code, `${label}.code`);
  const language = nullableString(value.language, `${label}.language`);
  const filename = nullableString(value.filename, `${label}.filename`);
  if (kind === "knowledge" && (code !== null || language !== null || filename !== null)) {
    invalid(`${label} has code fields that are not allowed for a knowledge entry.`);
  }
  if (kind === "snippet" && (code === null || language === null || !language.trim())) {
    invalid(`${label} must include code and a non-blank language for a snippet.`);
  }
  if (filename !== null && !filename.trim()) {
    invalid(`${label}.filename must be null or non-blank.`);
  }
  return {
    id: positiveInteger(value.id, `${label}.id`),
    parentId:
      sourceSchemaVersion < 2 || value.parentId === null
        ? null
        : positiveInteger(value.parentId, `${label}.parentId`),
    folderId: positiveInteger(value.folderId, `${label}.folderId`),
    kind,
    title: nonBlankString(value.title, `${label}.title`),
    notesMd: string(value.notesMd, `${label}.notesMd`),
    code,
    language,
    filename,
    version: positiveInteger(value.version, `${label}.version`),
    createdAt: timestamp(value.createdAt, `${label}.createdAt`),
    updatedAt: timestamp(value.updatedAt, `${label}.updatedAt`),
  };
}

function entryImageReference(
  value: unknown,
  label: string,
): SnapshotEntryImageReference {
  const item = record(value, label);
  exactKeys(item, ["id", "imagePath", "createdAt"], label);
  return {
    id: positiveInteger(item.id, `${label}.id`),
    imagePath: normalizeSnapshotImagePath(string(item.imagePath, `${label}.imagePath`)),
    createdAt: timestamp(item.createdAt, `${label}.createdAt`),
  };
}

function trashEntry(
  value: unknown,
  label: string,
  sourceSchemaVersion: number,
): SnapshotTrashEntry {
  const item = record(value, label);
  exactKeys(
    item,
    ["id", "originalEntryId", "folderId", "snapshot", "deletedAt"],
    label,
  );
  return {
    id: positiveInteger(item.id, `${label}.id`),
    originalEntryId: positiveInteger(
      item.originalEntryId,
      `${label}.originalEntryId`,
    ),
    folderId: positiveInteger(item.folderId, `${label}.folderId`),
    snapshot: trashPayload(item.snapshot, `${label}.snapshot`, sourceSchemaVersion),
    deletedAt: timestamp(item.deletedAt, `${label}.deletedAt`),
  };
}

function trashPayload(
  value: unknown,
  label: string,
  sourceSchemaVersion: number,
): SnapshotTrashPayload {
  const item = record(value, label);
  exactKeys(item, ["entry", "tags", "imagePaths"], label);
  const entryValue = record(item.entry, `${label}.entry`);
  const tags = array(item.tags, `${label}.tags`).map((tagValue, index) =>
    trimmedString(tagValue, `${label}.tags[${index}]`),
  );
  noDuplicates(tags.map(identityKey), `${label}.tags`);
  const imagePaths = array(item.imagePaths, `${label}.imagePaths`).map(
    (imagePath, index) =>
      normalizeSnapshotImagePath(
        string(imagePath, `${label}.imagePaths[${index}]`),
      ),
  );
  noDuplicates(imagePaths, `${label}.imagePaths`);
  return {
    entry: entryRecord(entryValue, `${label}.entry`, true, sourceSchemaVersion),
    tags,
    imagePaths,
  };
}

function image(value: unknown, label: string): SnapshotImage {
  const item = record(value, label);
  exactKeys(item, ["imagePath", "contentType", "size", "sha256"], label);
  const contentType = string(item.contentType, `${label}.contentType`);
  if (!imageContentTypeSet.has(contentType)) {
    invalid(`${label}.contentType is not a supported managed image type.`);
  }
  const size = positiveInteger(item.size, `${label}.size`);
  if (size > ENTRY_IMAGE_MAX_BYTES) {
    invalid(`${label}.size exceeds the 10 MB managed image limit.`);
  }
  const sha256 = string(item.sha256, `${label}.sha256`);
  if (!sha256Pattern.test(sha256)) {
    invalid(`${label}.sha256 must be a lowercase SHA-256 digest.`);
  }
  return {
    imagePath: normalizeSnapshotImagePath(
      string(item.imagePath, `${label}.imagePath`),
    ),
    contentType: contentType as SnapshotImageContentType,
    size,
    sha256,
  };
}

function validateRelationships(manifest: NeumSnapshotManifest): void {
  noDuplicates(manifest.folders.map(({ id }) => id), "folder IDs");
  noDuplicates(manifest.entries.map(({ id }) => id), "entry IDs");
  noDuplicates(manifest.tags.map(({ id }) => id), "tag IDs");
  noDuplicates(manifest.trash.map(({ id }) => id), "trash IDs");
  noDuplicates(
    manifest.trash.map(({ originalEntryId }) => originalEntryId),
    "trash original entry IDs",
  );
  noDuplicates(manifest.images.map(({ imagePath }) => imagePath), "image paths");
  noDuplicates(
    manifest.images.map(({ imagePath }) => snapshotImageFileName(imagePath)),
    "image file names",
  );

  const folderIds = new Set(manifest.folders.map(({ id }) => id));
  const foldersById = new Map(manifest.folders.map((item) => [item.id, item]));
  const siblingNames = new Set<string>();
  for (const item of manifest.folders) {
    if (item.parentId === item.id) invalid(`Folder ${item.id} cannot be its own parent.`);
    if (item.parentId !== null && !folderIds.has(item.parentId)) {
      invalid(`Folder ${item.id} references missing parent ${item.parentId}.`);
    }
    const siblingKey = `${item.parentId ?? "root"}\0${identityKey(item.name)}`;
    if (siblingNames.has(siblingKey)) {
      invalid(`Folder names must be unique within a parent (case-insensitive).`);
    }
    siblingNames.add(siblingKey);
  }
  assertNoFolderCycles(foldersById);

  const tagIds = new Set(manifest.tags.map(({ id }) => id));
  noDuplicates(
    manifest.tags.map(({ name }) => identityKey(name)),
    "tag names",
  );
  const activeEntryIds = new Set(manifest.entries.map(({ id }) => id));
  const activeEntriesById = new Map(manifest.entries.map((item) => [item.id, item]));
  const trashEntryRecords = manifest.trash.map(({ snapshot }) => snapshot.entry);
  const allEntriesById = new Map<number, SnapshotEntryRecord>([
    ...manifest.entries.map((item) => [item.id, item] as const),
    ...trashEntryRecords.map((item) => [item.id, item] as const),
  ]);
  const activeImageIds: number[] = [];
  const referencedPaths: string[] = [];
  for (const item of manifest.entries) {
    if (!folderIds.has(item.folderId)) {
      invalid(`Entry ${item.id} references missing folder ${item.folderId}.`);
    }
    if (item.parentId !== null) {
      const parent = activeEntriesById.get(item.parentId);
      if (!parent) invalid(`Entry ${item.id} references missing active parent ${item.parentId}.`);
      if (parent.folderId !== item.folderId) {
        invalid(`Entry ${item.id} and parent ${item.parentId} must share a folder.`);
      }
    }
    for (const tagId of item.tagIds) {
      if (!tagIds.has(tagId)) invalid(`Entry ${item.id} references missing tag ${tagId}.`);
    }
    for (const imageReference of item.images) {
      activeImageIds.push(imageReference.id);
      referencedPaths.push(imageReference.imagePath);
    }
    assertMarkdownImageOwnership(
      item.notesMd,
      item.images.map(({ imagePath }) => imagePath),
      `Entry ${item.id}`,
    );
  }
  noDuplicates(activeImageIds, "active image IDs");

  for (const item of manifest.trash) {
    if (!folderIds.has(item.folderId)) {
      invalid(`Trash entry ${item.id} references missing folder ${item.folderId}.`);
    }
    if (
      item.originalEntryId !== item.snapshot.entry.id ||
      item.folderId !== item.snapshot.entry.folderId
    ) {
      invalid(`Trash entry ${item.id} does not match its embedded entry snapshot.`);
    }
    if (activeEntryIds.has(item.originalEntryId)) {
      invalid(`Entry ${item.originalEntryId} exists in both active entries and trash.`);
    }
    if (item.snapshot.entry.parentId !== null) {
      const parent = allEntriesById.get(item.snapshot.entry.parentId);
      if (!parent) {
        invalid(
          `Trash entry ${item.id} references missing parent ${item.snapshot.entry.parentId}.`,
        );
      }
      if (parent.folderId !== item.folderId) {
        invalid(
          `Trash entry ${item.id} and parent ${item.snapshot.entry.parentId} must share a folder.`,
        );
      }
    }
    assertMarkdownImageOwnership(
      item.snapshot.entry.notesMd,
      item.snapshot.imagePaths,
      `Trash entry ${item.id}`,
    );
    referencedPaths.push(...item.snapshot.imagePaths);
  }
  assertNoEntryCycles(allEntriesById);
  noDuplicates(referencedPaths, "managed image ownership paths");

  const declaredPaths = new Set(manifest.images.map(({ imagePath }) => imagePath));
  const referencedPathSet = new Set(referencedPaths);
  for (const imagePath of referencedPathSet) {
    if (!declaredPaths.has(imagePath)) {
      invalid(`Referenced image is absent from manifest.images: ${imagePath}.`);
    }
  }
  for (const imagePath of declaredPaths) {
    if (!referencedPathSet.has(imagePath)) {
      invalid(`manifest.images contains an unreferenced image: ${imagePath}.`);
    }
  }
}

function assertMarkdownImageOwnership(
  notesMd: string,
  ownedPaths: readonly string[],
  label: string,
): void {
  let referenced: Set<string>;
  try {
    referenced = managedImagePathsInMarkdown(notesMd);
  } catch {
    invalid(`${label} contains an invalid managed image reference.`);
  }
  const owned = new Set(ownedPaths);
  if (
    referenced.size !== owned.size ||
    [...referenced].some((imagePath) => !owned.has(imagePath))
  ) {
    invalid(`${label} managed image references do not match its owned images.`);
  }
}

function assertNoFolderCycles(foldersById: Map<number, SnapshotFolder>): void {
  const done = new Set<number>();
  for (const startingId of foldersById.keys()) {
    const pathIds = new Set<number>();
    let currentId: number | null = startingId;
    while (currentId !== null && !done.has(currentId)) {
      if (pathIds.has(currentId)) invalid(`Folder hierarchy contains a cycle at ${currentId}.`);
      pathIds.add(currentId);
      currentId = foldersById.get(currentId)?.parentId ?? null;
    }
    for (const id of pathIds) done.add(id);
  }
}

function assertNoEntryCycles(entriesById: Map<number, SnapshotEntryRecord>): void {
  const done = new Set<number>();
  for (const startingId of entriesById.keys()) {
    const pathIds = new Set<number>();
    let currentId: number | null = startingId;
    while (currentId !== null && !done.has(currentId)) {
      if (pathIds.has(currentId)) {
        invalid(`Entry hierarchy contains a cycle at ${currentId}.`);
      }
      pathIds.add(currentId);
      currentId = entriesById.get(currentId)?.parentId ?? null;
    }
    for (const id of pathIds) done.add(id);
  }
}

function entryKind(value: unknown, label: string): SnapshotEntryKind {
  if (value !== "knowledge" && value !== "snippet") {
    invalid(`${label} must be "knowledge" or "snippet".`);
  }
  return value;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalid(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) invalid(`${label} must be an array.`);
  return value;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string") invalid(`${label} must be a string.`);
  return value;
}

function nonBlankString(value: unknown, label: string): string {
  const parsed = string(value, label);
  if (!parsed.trim()) invalid(`${label} must not be blank.`);
  return parsed;
}

function trimmedString(value: unknown, label: string): string {
  const parsed = nonBlankString(value, label);
  if (parsed !== parsed.trim()) invalid(`${label} must be trimmed.`);
  return parsed;
}

function nullableString(value: unknown, label: string): string | null {
  return value === null ? null : string(value, label);
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    invalid(`${label} must be a positive safe integer.`);
  }
  return value as number;
}

function timestamp(value: unknown, label: string): string {
  const parsed = string(value, label);
  if (!parsed || Number.isNaN(Date.parse(parsed))) {
    invalid(`${label} must be a valid timestamp.`);
  }
  return parsed;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const expected = new Set(allowed);
  const unexpected = Object.keys(value).filter((key) => !expected.has(key));
  const missing = allowed.filter((key) => !(key in value));
  if (unexpected.length > 0 || missing.length > 0) {
    const details = [
      missing.length > 0 ? `missing ${missing.join(", ")}` : "",
      unexpected.length > 0 ? `unexpected ${unexpected.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("; ");
    invalid(`${label} has invalid fields (${details}).`);
  }
}

function noDuplicates<T>(values: readonly T[], label: string): void {
  if (new Set(values).size !== values.length) invalid(`${label} contain duplicates.`);
}

function invalid(message: string): never {
  throw new SnapshotError("INVALID_MANIFEST", message);
}
