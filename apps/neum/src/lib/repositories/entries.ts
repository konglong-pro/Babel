import {
  and,
  count,
  desc,
  eq,
  inArray,
  or,
  sql,
  type AnyColumn,
  type SQL,
} from "drizzle-orm";

import { getNeumDatabase } from "@/lib/db/client";
import { entries, entryImages, entryTags, tags } from "@/lib/db/schema";
import {
  managedImagePathsInMarkdown,
  normalizeStoredEntryImagePath,
} from "@/lib/storage";
import { identityKey } from "@/lib/identity";
import type {
  EntryDetailDto,
  EntryKind,
  EntrySummaryDto,
  PaginatedDto,
} from "@/lib/types";

import { RepositoryError } from "./errors";
import {
  assertPositiveId,
  descendantFolderIds,
  normalizeEntryKind,
  normalizeOptionalText,
  normalizeRequiredText,
  normalizeTags,
  normalizeVerbatimText,
  nowSql,
  replaceEntryTags,
  requireFolder,
  tagsByEntryIds,
  type EntryRow,
} from "./shared";

export interface EntryListOptions {
  folderId?: number;
  includeDescendants?: boolean;
  kind?: EntryKind;
  tag?: string;
  limit?: number;
  offset?: number;
}

export interface CreateEntryInput {
  folderId: number;
  kind: EntryKind;
  title: string;
  notesMd?: string;
  code?: string | null;
  language?: string | null;
  filename?: string | null;
  tags?: readonly string[];
}

export interface UpdateEntryInput {
  expectedVersion: number;
  folderId?: number;
  kind?: EntryKind;
  title?: string;
  notesMd?: string;
  code?: string | null;
  language?: string | null;
  filename?: string | null;
  tags?: readonly string[];
}

export interface UpdatedEntryResult {
  entry: EntryDetailDto;
  removedImagePaths: string[];
}

type NormalizedEntryFields = Pick<
  EntryRow,
  "folderId" | "kind" | "title" | "notesMd" | "code" | "language" | "filename"
>;

export function listEntries(
  options: EntryListOptions = {},
): PaginatedDto<EntrySummaryDto> {
  return queryEntries(undefined, options);
}

export function searchEntries(
  query: string,
  options: EntryListOptions = {},
): PaginatedDto<EntrySummaryDto> {
  const normalized = typeof query === "string" ? query.trim() : "";
  if (!normalized) {
    const { limit, offset } = normalizePagination(options.limit, options.offset);
    return { items: [], total: 0, limit, offset };
  }
  return queryEntries(normalized, options);
}

export function getEntry(id: number): EntryDetailDto | null {
  const row = findEntryRow(id);
  return row ? entryRowToDetail(row) : null;
}

export function listEntryImagePaths(entryId: number): string[] {
  assertPositiveId(entryId, "entryId");
  const { db } = getNeumDatabase();
  return db
    .select({ imagePath: entryImages.imagePath })
    .from(entryImages)
    .where(eq(entryImages.entryId, entryId))
    .all()
    .map(({ imagePath }) => imagePath);
}

export function createEntry(
  input: CreateEntryInput,
  newImagePaths: readonly string[] = [],
): EntryDetailDto {
  const { db, sqlite } = getNeumDatabase();
  const fields = normalizeCreateFields(input);
  const normalizedTags = normalizeTags(input.tags ?? []);
  const imagePaths = normalizeNewImagePaths(newImagePaths);
  assertManagedImageOwnership(fields.notesMd, [], imagePaths);

  const created = sqlite.transaction(() => {
    const row = db.insert(entries).values(fields).returning().get();
    replaceEntryTags(row.id, normalizedTags);
    if (imagePaths.length > 0) {
      db.insert(entryImages)
        .values(imagePaths.map((imagePath) => ({ entryId: row.id, imagePath })))
        .run();
    }
    return row;
  })();
  return entryRowToDetail(created);
}

export function updateEntry(
  id: number,
  input: UpdateEntryInput,
  newImagePaths: readonly string[] = [],
  expectedRemovedImagePaths?: readonly string[],
): UpdatedEntryResult {
  const { db, sqlite } = getNeumDatabase();
  const current = findEntryRow(id);
  if (!current) {
    throw new RepositoryError("NOT_FOUND", "Entry not found.", { entryId: id });
  }
  assertExpectedVersion(input.expectedVersion, current.version, id);

  const fields = normalizeUpdateFields(current, input);
  const imagePaths = normalizeNewImagePaths(newImagePaths);
  const ownedImagePaths = listEntryImagePaths(id);
  const referencedImagePaths = assertManagedImageOwnership(
    fields.notesMd,
    ownedImagePaths,
    imagePaths,
  );
  const removedImagePaths = ownedImagePaths.filter(
    (imagePath) => !referencedImagePaths.has(imagePath),
  );
  assertPreparedImageRemoval(removedImagePaths, expectedRemovedImagePaths);
  const normalizedTags =
    input.tags === undefined ? undefined : normalizeTags(input.tags);

  const updated = sqlite.transaction(() => {
    const row = db
      .update(entries)
      .set({ ...fields, version: current.version + 1, updatedAt: nowSql })
      .where(and(eq(entries.id, id), eq(entries.version, input.expectedVersion)))
      .returning()
      .get();
    if (!row) throw versionConflict(id, input.expectedVersion);
    if (normalizedTags !== undefined) replaceEntryTags(id, normalizedTags);
    if (removedImagePaths.length > 0) {
      db.delete(entryImages)
        .where(
          and(
            eq(entryImages.entryId, id),
            inArray(entryImages.imagePath, removedImagePaths),
          ),
        )
        .run();
    }
    if (imagePaths.length > 0) {
      db.insert(entryImages)
        .values(imagePaths.map((imagePath) => ({ entryId: id, imagePath })))
        .run();
    }
    return row;
  })();

  return { entry: entryRowToDetail(updated), removedImagePaths };
}

export function findEntryRow(id: number): EntryRow | null {
  assertPositiveId(id, "id");
  const { db } = getNeumDatabase();
  return db.select().from(entries).where(eq(entries.id, id)).get() ?? null;
}

export function entryRowToSummary(
  row: EntryRow,
  tagNames: readonly string[] = tagsByEntryIds([row.id]).get(row.id) ?? [],
): EntrySummaryDto {
  return {
    id: row.id,
    folderId: row.folderId,
    kind: row.kind,
    title: row.title,
    tags: [...tagNames],
    version: row.version,
    updatedAt: row.updatedAt,
  };
}

export function entryRowToDetail(
  row: EntryRow,
  tagNames?: readonly string[],
): EntryDetailDto {
  return {
    ...entryRowToSummary(row, tagNames),
    notesMd: row.notesMd,
    code: row.code,
    language: row.language,
    filename: row.filename,
    createdAt: row.createdAt,
  };
}

export function assertExpectedVersion(
  expectedVersion: number,
  actualVersion: number,
  entryId: number,
): void {
  assertPositiveId(expectedVersion, "expectedVersion");
  if (expectedVersion !== actualVersion) {
    throw versionConflict(entryId, expectedVersion, actualVersion);
  }
}

export function normalizePagination(
  requestedLimit: number | undefined,
  requestedOffset: number | undefined,
): { limit: number; offset: number } {
  const limit = requestedLimit ?? 50;
  const offset = requestedOffset ?? 0;
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 100) {
    throw new RepositoryError(
      "VALIDATION",
      "limit must be an integer between 1 and 100.",
      { field: "limit" },
    );
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new RepositoryError("VALIDATION", "offset must be a non-negative integer.", {
      field: "offset",
    });
  }
  return { limit, offset };
}

function queryEntries(
  query: string | undefined,
  options: EntryListOptions,
): PaginatedDto<EntrySummaryDto> {
  const { db } = getNeumDatabase();
  const { limit, offset } = normalizePagination(options.limit, options.offset);
  const conditions: SQL[] = [];
  if (options.folderId !== undefined) {
    const folderIds =
      options.includeDescendants === false
        ? (requireFolder(options.folderId), [options.folderId])
        : descendantFolderIds(options.folderId);
    conditions.push(inArray(entries.folderId, folderIds));
  }
  if (options.kind !== undefined) {
    conditions.push(eq(entries.kind, normalizeEntryKind(options.kind)));
  }
  if (options.tag !== undefined) {
    const tag = normalizeRequiredText(options.tag, "tag");
    conditions.push(sql`EXISTS (
      SELECT 1 FROM ${entryTags}
      INNER JOIN ${tags} ON ${tags.id} = ${entryTags.tagId}
      WHERE ${entryTags.entryId} = ${entries.id}
        AND ${tags.nameKey} = ${identityKey(tag)}
    )`);
  }
  if (query !== undefined) conditions.push(searchCondition(query));
  const where = conditions.length === 0 ? undefined : and(...conditions);
  const total =
    db.select({ value: count() }).from(entries).where(where).get()?.value ?? 0;
  const rows = db
    .select()
    .from(entries)
    .where(where)
    .orderBy(desc(entries.updatedAt), desc(entries.id))
    .limit(limit)
    .offset(offset)
    .all();
  const tagMap = tagsByEntryIds(rows.map((row) => row.id));
  return {
    items: rows.map((row) => entryRowToSummary(row, tagMap.get(row.id) ?? [])),
    total,
    limit,
    offset,
  };
}

function searchCondition(query: string): SQL {
  const pattern = `%${escapeLike(query)}%`;
  return or(
    likeLiteral(entries.title, pattern),
    likeLiteral(entries.notesMd, pattern),
    likeLiteral(entries.code, pattern),
    likeLiteral(entries.language, pattern),
    likeLiteral(entries.filename, pattern),
    sql`EXISTS (
      SELECT 1 FROM ${entryTags}
      INNER JOIN ${tags} ON ${tags.id} = ${entryTags.tagId}
      WHERE ${entryTags.entryId} = ${entries.id}
        AND ${tags.name} LIKE ${pattern} ESCAPE ${"\\"}
    )`,
  )!;
}

function likeLiteral(column: AnyColumn, pattern: string): SQL {
  return sql`${column} LIKE ${pattern} ESCAPE ${"\\"}`;
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function normalizeCreateFields(input: CreateEntryInput): NormalizedEntryFields {
  requireFolder(input.folderId);
  const kind = normalizeEntryKind(input.kind);
  return normalizeFields({
    folderId: input.folderId,
    kind,
    title: normalizeRequiredText(input.title, "title"),
    notesMd: normalizeVerbatimText(input.notesMd ?? "", "notesMd"),
    code: normalizeNullableCode(input.code),
    language: normalizeOptionalText(input.language ?? null, "language"),
    filename: normalizeOptionalText(input.filename ?? null, "filename"),
  });
}

function normalizeUpdateFields(
  current: EntryRow,
  input: UpdateEntryInput,
): NormalizedEntryFields {
  const folderId = input.folderId ?? current.folderId;
  if (input.folderId !== undefined) requireFolder(input.folderId);
  return normalizeFields({
    folderId,
    kind: input.kind === undefined ? current.kind : normalizeEntryKind(input.kind),
    title:
      input.title === undefined
        ? current.title
        : normalizeRequiredText(input.title, "title"),
    notesMd:
      input.notesMd === undefined
        ? current.notesMd
        : normalizeVerbatimText(input.notesMd, "notesMd"),
    code: input.code === undefined ? current.code : normalizeNullableCode(input.code),
    language:
      input.language === undefined
        ? current.language
        : normalizeOptionalText(input.language, "language"),
    filename:
      input.filename === undefined
        ? current.filename
        : normalizeOptionalText(input.filename, "filename"),
  });
}

function normalizeFields(fields: NormalizedEntryFields): NormalizedEntryFields {
  if (fields.kind === "knowledge") {
    const code = fields.code === "" ? null : fields.code;
    if (code !== null || fields.language !== null || fields.filename !== null) {
      throw new RepositoryError(
        "VALIDATION",
        "Knowledge entries cannot contain code, language, or filename fields.",
        { field: "kind" },
      );
    }
    return { ...fields, code: null, language: null, filename: null };
  }
  if (fields.code === null) {
    throw new RepositoryError("VALIDATION", "code is required for snippet entries.", {
      field: "code",
    });
  }
  if (fields.language === null) {
    throw new RepositoryError(
      "VALIDATION",
      "language is required for snippet entries.",
      { field: "language" },
    );
  }
  return fields;
}

function normalizeNullableCode(value: unknown): string | null {
  return value === undefined || value === null
    ? null
    : normalizeVerbatimText(value, "code");
}

function normalizeNewImagePaths(imagePaths: readonly string[]): string[] {
  if (!Array.isArray(imagePaths) || imagePaths.some((value) => typeof value !== "string")) {
    throw new RepositoryError("VALIDATION", "Image paths must be strings.");
  }
  const normalized = imagePaths.map(normalizeStoredEntryImagePath);
  if (new Set(normalized).size !== normalized.length) {
    throw new RepositoryError("VALIDATION", "Image paths must be unique.");
  }
  return normalized;
}

function assertManagedImageOwnership(
  notesMd: string,
  ownedImagePaths: readonly string[],
  newImagePaths: readonly string[],
): Set<string> {
  const referenced = managedImagePathsInMarkdown(notesMd);
  const allowed = new Set([...ownedImagePaths, ...newImagePaths]);
  const foreign = [...referenced].find((imagePath) => !allowed.has(imagePath));
  if (foreign) {
    throw new RepositoryError(
      "CONFLICT",
      "Managed images can only be used by the entry that owns them.",
      { imagePath: foreign },
    );
  }
  const unreferenced = newImagePaths.find((imagePath) => !referenced.has(imagePath));
  if (unreferenced) {
    throw new RepositoryError(
      "VALIDATION",
      "Every uploaded image must be referenced by the entry notes.",
      { imagePath: unreferenced },
    );
  }
  return referenced;
}

function assertPreparedImageRemoval(
  actualImagePaths: readonly string[],
  expectedImagePaths: readonly string[] | undefined,
): void {
  if (actualImagePaths.length === 0 && expectedImagePaths === undefined) return;
  if (expectedImagePaths === undefined) {
    throw new RepositoryError(
      "CONFLICT",
      "Image removal must be prepared before changing this entry.",
    );
  }
  const actual = new Set(actualImagePaths.map(normalizeStoredEntryImagePath));
  const expected = new Set(expectedImagePaths.map(normalizeStoredEntryImagePath));
  if (
    actual.size !== expected.size ||
    [...actual].some((imagePath) => !expected.has(imagePath))
  ) {
    throw new RepositoryError(
      "CONFLICT",
      "The entry images changed while the request was in progress. Please try again.",
    );
  }
}

function versionConflict(
  entryId: number,
  expectedVersion: number,
  actualVersion?: number,
): RepositoryError {
  return new RepositoryError(
    "VERSION_CONFLICT",
    "The entry changed while the request was in progress.",
    { entryId, expectedVersion, ...(actualVersion === undefined ? {} : { actualVersion }) },
  );
}
