import { and, count, desc, eq } from "drizzle-orm";

import { getNeumDatabase } from "@/lib/db/client";
import { entries, entryImages, trashEntries } from "@/lib/db/schema";
import {
  managedImagePathsInMarkdown,
  normalizeStoredEntryImagePath,
} from "@/lib/storage";
import type {
  EntryDetailDto,
  EntryKind,
  PaginatedDto,
  TrashEntryDto,
} from "@/lib/types";

import {
  assertExpectedVersion,
  entryRowToDetail,
  findEntryRow,
  normalizePagination,
} from "./entries";
import { RepositoryError } from "./errors";
import {
  assertPositiveId,
  normalizeEntryKind,
  normalizeTags,
  nowSql,
  pruneUnusedTags,
  replaceEntryTags,
  requireFolder,
  tagNamesForEntry,
} from "./shared";

type SnapshotEntry = Omit<EntryDetailDto, "tags">;

export interface TrashEntrySnapshot {
  entry: SnapshotEntry;
  tags: string[];
  imagePaths: string[];
}

export interface TrashListOptions {
  limit?: number;
  offset?: number;
}

export interface PurgedTrashEntryResult {
  imagePaths: string[];
}

type TrashRow = typeof trashEntries.$inferSelect;

export function moveEntryToTrash(
  id: number,
  expectedVersion: number,
): TrashEntryDto | null {
  const { db, sqlite } = getNeumDatabase();
  const current = findEntryRow(id);
  if (!current) return null;
  assertExpectedVersion(expectedVersion, current.version, id);
  const tags = tagNamesForEntry(id);
  const imagePaths = listImagePaths(id);
  const detail = entryRowToDetail(current, tags);
  const snapshotEntry: SnapshotEntry = {
    id: detail.id,
    folderId: detail.folderId,
    kind: detail.kind,
    title: detail.title,
    notesMd: detail.notesMd,
    code: detail.code,
    language: detail.language,
    filename: detail.filename,
    version: detail.version,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
  };
  const snapshot: TrashEntrySnapshot = {
    entry: snapshotEntry,
    tags,
    imagePaths,
  };

  const trashRow = sqlite.transaction(() => {
    const inserted = db
      .insert(trashEntries)
      .values({
        originalEntryId: id,
        folderId: current.folderId,
        snapshotJson: JSON.stringify(snapshot),
      })
      .returning()
      .get();
    const deleted = db
      .delete(entries)
      .where(and(eq(entries.id, id), eq(entries.version, expectedVersion)))
      .returning({ id: entries.id })
      .get();
    if (!deleted) {
      throw new RepositoryError(
        "VERSION_CONFLICT",
        "The entry changed while the request was in progress.",
        { entryId: id, expectedVersion },
      );
    }
    pruneUnusedTags();
    return inserted;
  })();
  return trashRowToDto(trashRow, snapshot);
}

export const trashEntry = moveEntryToTrash;

export function listTrashEntries(
  options: TrashListOptions = {},
): PaginatedDto<TrashEntryDto> {
  const { db } = getNeumDatabase();
  const { limit, offset } = normalizePagination(options.limit, options.offset);
  const total = db.select({ value: count() }).from(trashEntries).get()?.value ?? 0;
  const rows = db
    .select()
    .from(trashEntries)
    .orderBy(desc(trashEntries.deletedAt), desc(trashEntries.id))
    .limit(limit)
    .offset(offset)
    .all();
  return {
    items: rows.map((row) => trashRowToDto(row)),
    total,
    limit,
    offset,
  };
}

export function getTrashEntry(trashId: number): TrashEntryDto | null {
  const row = findTrashRow(trashId);
  return row ? trashRowToDto(row) : null;
}

export function restoreTrashEntry(trashId: number): EntryDetailDto {
  const { db, sqlite } = getNeumDatabase();
  const trashRow = findTrashRow(trashId);
  if (!trashRow) {
    throw new RepositoryError("NOT_FOUND", "Trash entry not found.", { trashId });
  }
  const snapshot = parseTrashSnapshot(trashRow);
  if (findEntryRow(snapshot.entry.id)) {
    throw new RepositoryError(
      "CONFLICT",
      "The original entry id is already active and cannot be restored.",
      { trashId, entryId: snapshot.entry.id },
    );
  }
  requireFolder(snapshot.entry.folderId);
  const version = snapshot.entry.version + 1;

  return sqlite.transaction(() => {
    const restored = db
      .insert(entries)
      .values({
        id: snapshot.entry.id,
        folderId: snapshot.entry.folderId,
        kind: snapshot.entry.kind,
        title: snapshot.entry.title,
        notesMd: snapshot.entry.notesMd,
        code: snapshot.entry.code,
        language: snapshot.entry.language,
        filename: snapshot.entry.filename,
        version,
        createdAt: snapshot.entry.createdAt,
        updatedAt: nowSql,
      })
      .returning()
      .get();
    replaceEntryTags(restored.id, snapshot.tags);
    if (snapshot.imagePaths.length > 0) {
      db.insert(entryImages)
        .values(
          snapshot.imagePaths.map((imagePath) => ({
            entryId: restored.id,
            imagePath,
          })),
        )
        .run();
    }
    db.delete(trashEntries).where(eq(trashEntries.id, trashId)).run();
    return entryRowToDetail(restored);
  })();
}

export function purgeTrashEntry(
  trashId: number,
  expectedImagePaths?: readonly string[],
): PurgedTrashEntryResult | null {
  const { db } = getNeumDatabase();
  const trashRow = findTrashRow(trashId);
  if (!trashRow) return null;
  const snapshot = parseTrashSnapshot(trashRow);
  assertExpectedImages(snapshot.imagePaths, expectedImagePaths);
  db.delete(trashEntries).where(eq(trashEntries.id, trashId)).run();
  return { imagePaths: snapshot.imagePaths };
}

export function parseTrashSnapshot(row: TrashRow): TrashEntrySnapshot {
  let value: unknown;
  try {
    value = JSON.parse(row.snapshotJson);
  } catch {
    throw invalidSnapshot(row.id);
  }
  if (!isRecord(value) || !isRecord(value.entry)) throw invalidSnapshot(row.id);
  const entry = value.entry;
  const kind = normalizeSnapshotKind(entry.kind, row.id);
  const snapshotEntry: SnapshotEntry = {
    id: positiveSnapshotInteger(entry.id, "entry.id", row.id),
    folderId: positiveSnapshotInteger(entry.folderId, "entry.folderId", row.id),
    kind,
    title: snapshotString(entry.title, "entry.title", row.id, false),
    notesMd: snapshotString(entry.notesMd, "entry.notesMd", row.id, true),
    code: nullableSnapshotString(entry.code, "entry.code", row.id),
    language: nullableSnapshotString(entry.language, "entry.language", row.id),
    filename: nullableSnapshotString(entry.filename, "entry.filename", row.id),
    version: positiveSnapshotInteger(entry.version, "entry.version", row.id),
    createdAt: snapshotString(entry.createdAt, "entry.createdAt", row.id, false),
    updatedAt: snapshotString(entry.updatedAt, "entry.updatedAt", row.id, false),
  };
  if (
    snapshotEntry.id !== row.originalEntryId ||
    snapshotEntry.folderId !== row.folderId ||
    !Array.isArray(value.tags) ||
    value.tags.some((tag) => typeof tag !== "string") ||
    !Array.isArray(value.imagePaths) ||
    value.imagePaths.some((imagePath) => typeof imagePath !== "string")
  ) {
    throw invalidSnapshot(row.id);
  }
  const normalizedTags = normalizeTags(value.tags as string[]);
  if (normalizedTags.length !== value.tags.length) throw invalidSnapshot(row.id);
  const imagePaths = (value.imagePaths as string[]).map((imagePath) => {
    try {
      return normalizeStoredEntryImagePath(imagePath);
    } catch {
      throw invalidSnapshot(row.id);
    }
  });
  if (new Set(imagePaths).size !== imagePaths.length) throw invalidSnapshot(row.id);
  assertSnapshotKindFields(snapshotEntry, row.id);
  assertSnapshotImageOwnership(snapshotEntry.notesMd, imagePaths, row.id);
  return { entry: snapshotEntry, tags: normalizedTags, imagePaths };
}

function findTrashRow(trashId: number): TrashRow | null {
  assertPositiveId(trashId, "trashId");
  const { db } = getNeumDatabase();
  return (
    db.select().from(trashEntries).where(eq(trashEntries.id, trashId)).get() ?? null
  );
}

function listImagePaths(entryId: number): string[] {
  const { db } = getNeumDatabase();
  return db
    .select({ imagePath: entryImages.imagePath })
    .from(entryImages)
    .where(eq(entryImages.entryId, entryId))
    .all()
    .map(({ imagePath }) => imagePath);
}

function trashRowToDto(
  row: TrashRow,
  parsedSnapshot?: TrashEntrySnapshot,
): TrashEntryDto {
  const snapshot = parsedSnapshot ?? parseTrashSnapshot(row);
  return {
    ...snapshot.entry,
    tags: [...snapshot.tags],
    trashId: row.id,
    deletedAt: row.deletedAt,
    imagePaths: [...snapshot.imagePaths],
  };
}

function assertExpectedImages(
  actualPaths: readonly string[],
  expectedPaths: readonly string[] | undefined,
): void {
  if (actualPaths.length === 0 && expectedPaths === undefined) return;
  if (expectedPaths === undefined) {
    throw new RepositoryError(
      "CONFLICT",
      "Image removal must be prepared before permanently deleting this entry.",
    );
  }
  const actual = new Set(actualPaths);
  const expected = new Set(expectedPaths.map(normalizeStoredEntryImagePath));
  if (actual.size !== expected.size || [...actual].some((path) => !expected.has(path))) {
    throw new RepositoryError(
      "CONFLICT",
      "The trash entry images changed while the request was in progress.",
    );
  }
}

function assertSnapshotKindFields(entry: SnapshotEntry, trashId: number): void {
  if (entry.kind === "knowledge") {
    if (entry.code !== null || entry.language !== null || entry.filename !== null) {
      throw invalidSnapshot(trashId);
    }
    return;
  }
  if (entry.code === null || entry.language === null || !entry.language.trim()) {
    throw invalidSnapshot(trashId);
  }
  if (entry.filename !== null && !entry.filename.trim()) throw invalidSnapshot(trashId);
}

function assertSnapshotImageOwnership(
  notesMd: string,
  imagePaths: readonly string[],
  trashId: number,
): void {
  let referenced: Set<string>;
  try {
    referenced = managedImagePathsInMarkdown(notesMd);
  } catch {
    throw invalidSnapshot(trashId);
  }
  const owned = new Set(imagePaths);
  if (
    referenced.size !== owned.size ||
    [...referenced].some((imagePath) => !owned.has(imagePath))
  ) {
    throw invalidSnapshot(trashId);
  }
}

function normalizeSnapshotKind(value: unknown, trashId: number): EntryKind {
  try {
    return normalizeEntryKind(value);
  } catch {
    throw invalidSnapshot(trashId);
  }
}

function positiveSnapshotInteger(
  value: unknown,
  field: string,
  trashId: number,
): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw invalidSnapshot(trashId, field);
  }
  return value as number;
}

function snapshotString(
  value: unknown,
  field: string,
  trashId: number,
  allowEmpty: boolean,
): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) {
    throw invalidSnapshot(trashId, field);
  }
  return value;
}

function nullableSnapshotString(
  value: unknown,
  field: string,
  trashId: number,
): string | null {
  if (value === null || typeof value === "string") return value;
  throw invalidSnapshot(trashId, field);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidSnapshot(trashId: number, field?: string): RepositoryError {
  return new RepositoryError("CONFLICT", "The trash entry snapshot is invalid.", {
    trashId,
    ...(field === undefined ? {} : { field }),
  });
}
