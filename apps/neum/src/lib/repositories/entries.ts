import {
  and,
  asc,
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
  ENTRY_CODE_MAX_BYTES,
  ENTRY_NOTES_MAX_BYTES,
  utf8ByteLength,
} from "@/lib/entry-limits";
import {
  managedImagePathsInMarkdown,
  normalizeStoredEntryImagePath,
} from "@/lib/storage";
import { identityKey } from "@/lib/identity";
import { createEntrySearchMatch } from "@/lib/search-match";
import type {
  EntryDetailDto,
  EntryKind,
  EntrySearchResultDto,
  EntrySummaryDto,
  PaginatedDto,
  SearchResultsDto,
} from "@/lib/types";

import { RepositoryError } from "./errors";
import {
  listOutgoingEntryLinks,
  reconcileEntryTitleChange,
  replaceSourceEntryLinks,
  resolveIncomingLinksForTitle,
} from "./links";
import {
  assertPositiveId,
  descendantFolderIds,
  detachTrashedEntryChildren,
  moveTrashedEntryDescendantsToFolder,
  normalizeEntryKind,
  normalizeOptionalText,
  normalizeRequiredText,
  normalizeTags,
  normalizeVerbatimText,
  nowSql,
  pruneUnusedTags,
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
  completeTree?: boolean;
  limit?: number;
  offset?: number;
}

export type EntrySearchOptions = Omit<EntryListOptions, "completeTree">;

export interface CreateEntryInput {
  folderId: number;
  parentId?: number | null;
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
  parentId?: number | null;
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

export interface DeletedEntryResult {
  imagePaths: string[];
}

type NormalizedEntryFields = Pick<
  EntryRow,
  | "parentId"
  | "folderId"
  | "kind"
  | "title"
  | "notesMd"
  | "code"
  | "language"
  | "filename"
>;

export function listEntries(
  options: EntryListOptions = {},
): PaginatedDto<EntrySummaryDto> {
  return queryEntries(options);
}

export function searchEntries(
  query: string,
  options: EntrySearchOptions = {},
): SearchResultsDto {
  const normalized = typeof query === "string" ? query.trim() : "";
  if (!normalized) {
    const { limit, offset } = normalizePagination(options.limit, options.offset);
    return { items: [], total: 0, limit, offset };
  }
  return querySearchEntries(normalized, options);
}

export function getEntry(id: number): EntryDetailDto | null {
  const row = findEntryRow(id);
  return row
    ? entryRowToDetail(row, undefined, listOutgoingEntryLinks(id))
    : null;
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

  return sqlite.transaction(() => {
    const row = db.insert(entries).values(fields).returning().get();
    replaceEntryTags(row.id, normalizedTags);
    if (imagePaths.length > 0) {
      db.insert(entryImages)
        .values(imagePaths.map((imagePath) => ({ entryId: row.id, imagePath })))
        .run();
    }
    replaceSourceEntryLinks(sqlite, row.id, fields.notesMd);
    resolveIncomingLinksForTitle(sqlite, fields.title);
    return entryRowToDetail(
      row,
      undefined,
      listOutgoingEntryLinks(row.id, sqlite),
    );
  })();
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

  const fields = normalizeUpdateFields(id, current, input);
  const movedDescendantIds =
    fields.folderId === current.folderId ? [] : descendantEntryIds(id);
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
    if (movedDescendantIds.length > 0) {
      db.update(entries)
        .set({
          folderId: fields.folderId,
          version: sql`${entries.version} + 1`,
          updatedAt: nowSql,
        })
        .where(inArray(entries.id, movedDescendantIds))
        .run();
    }
    if (fields.folderId !== current.folderId) {
      moveTrashedEntryDescendantsToFolder(
        [id, ...movedDescendantIds],
        fields.folderId,
      );
    }
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
    replaceSourceEntryLinks(sqlite, id, fields.notesMd);
    reconcileEntryTitleChange(sqlite, id, current.title, fields.title);
    return entryRowToDetail(
      row,
      undefined,
      listOutgoingEntryLinks(id, sqlite),
    );
  })();

  return { entry: updated, removedImagePaths };
}

export function deleteEntry(
  id: number,
  expectedVersion: number,
  expectedImagePaths?: readonly string[],
): DeletedEntryResult | null {
  const { db, sqlite } = getNeumDatabase();
  const current = findEntryRow(id);
  if (!current) return null;
  assertExpectedVersion(expectedVersion, current.version, id);

  const child = db
    .select({ id: entries.id })
    .from(entries)
    .where(eq(entries.parentId, id))
    .get();
  if (child) {
    throw new RepositoryError(
      "NOT_EMPTY",
      "Entries with subpages cannot be deleted.",
      { entryId: id, childId: child.id },
    );
  }

  const imagePaths = listEntryImagePaths(id);
  assertPreparedImageRemoval(imagePaths, expectedImagePaths);

  return sqlite.transaction(() => {
    detachTrashedEntryChildren(id);
    const deleted = db
      .delete(entries)
      .where(and(eq(entries.id, id), eq(entries.version, expectedVersion)))
      .returning({ id: entries.id })
      .get();
    if (!deleted) throw versionConflict(id, expectedVersion);
    resolveIncomingLinksForTitle(sqlite, current.title);
    pruneUnusedTags();
    return { imagePaths };
  })();
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
    parentId: row.parentId,
    folderId: row.folderId,
    kind: row.kind,
    title: row.title,
    tags: [...tagNames],
    version: row.version,
    updatedAt: row.updatedAt,
  };
}

function entryRowToSearchResult(
  row: EntryRow,
  tagNames: readonly string[],
  query: string,
): EntrySearchResultDto {
  return {
    ...entryRowToSummary(row, tagNames),
    match: createEntrySearchMatch(row, tagNames, query),
  };
}

export function entryRowToDetail(
  row: EntryRow,
  tagNames?: readonly string[],
  links: EntryDetailDto["links"] = [],
): EntryDetailDto {
  return {
    ...entryRowToSummary(row, tagNames),
    notesMd: row.notesMd,
    code: row.code,
    language: row.language,
    filename: row.filename,
    createdAt: row.createdAt,
    links,
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

function queryEntries(options: EntryListOptions): PaginatedDto<EntrySummaryDto> {
  const { db } = getNeumDatabase();
  const { limit, offset } = normalizePagination(options.limit, options.offset);
  const conditions = entryFilterConditions(options);
  const where = conditions.length === 0 ? undefined : and(...conditions);
  const total =
    db.select({ value: count() }).from(entries).where(where).get()?.value ?? 0;
  const orderedQuery = db
    .select()
    .from(entries)
    .where(where)
    .orderBy(desc(entries.updatedAt), desc(entries.id));
  const rows = options.completeTree === true
    ? orderedQuery.all()
    : orderedQuery.limit(limit).offset(offset).all();
  const tagMap = tagsByEntryIds(rows.map((row) => row.id));
  return {
    items: rows.map((row) => entryRowToSummary(row, tagMap.get(row.id) ?? [])),
    total,
    limit: options.completeTree === true ? total : limit,
    offset: options.completeTree === true ? 0 : offset,
  };
}

function querySearchEntries(query: string, options: EntrySearchOptions): SearchResultsDto {
  const { db } = getNeumDatabase();
  const { limit, offset } = normalizePagination(options.limit, options.offset);
  const rank = searchRank(query);
  const where = and(...entryFilterConditions(options), rank.condition);
  const total =
    db.select({ value: count() }).from(entries).where(where).get()?.value ?? 0;
  const orderedIds = db
    .select({ id: entries.id })
    .from(entries)
    .where(where)
    .orderBy(
      asc(rank.tier),
      desc(rank.fieldCount),
      desc(rank.occurrenceCount),
      asc(rank.firstPosition),
      desc(entries.updatedAt),
      desc(entries.id),
    );
  const rankedRows = orderedIds.limit(limit).offset(offset).all();
  const rankedIds = rankedRows.map(({ id }) => id);
  const rows = rankedIds.length === 0
    ? []
    : db.select().from(entries).where(inArray(entries.id, rankedIds)).all();
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const tagMap = tagsByEntryIds(rankedIds);
  const items = rankedIds.map((id) => {
    const row = rowsById.get(id);
    if (!row) throw new Error(`Ranked entry ${id} disappeared before hydration.`);
    return entryRowToSearchResult(row, tagMap.get(id) ?? [], query);
  });
  return {
    items,
    total,
    limit,
    offset,
  };
}

function entryFilterConditions(options: EntryListOptions): SQL[] {
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
  return conditions;
}

interface SearchRankSql {
  condition: SQL;
  tier: SQL<number>;
  fieldCount: SQL<number>;
  occurrenceCount: SQL<number>;
  firstPosition: SQL<number>;
}

function searchRank(query: string): SearchRankSql {
  const escaped = escapeLike(query);
  const exactPattern = escaped;
  const prefixPattern = `${escaped}%`;
  const containsPattern = `%${escaped}%`;
  const titleExact = likeLiteral(entries.title, exactPattern);
  const titlePrefix = likeLiteral(entries.title, prefixPattern);
  const titleMatch = likeLiteral(entries.title, containsPattern);
  const notesMatch = likeLiteral(entries.notesMd, containsPattern);
  const codeMatch = likeLiteral(entries.code, containsPattern);
  const languageMatch = likeLiteral(entries.language, containsPattern);
  const filenameExact = likeLiteral(entries.filename, exactPattern);
  const filenameMatch = likeLiteral(entries.filename, containsPattern);
  const exactTag = tagLike(exactPattern);
  const tagMatch = tagLike(containsPattern);
  const condition = or(
    titleMatch,
    notesMatch,
    codeMatch,
    languageMatch,
    filenameMatch,
    tagMatch,
  )!;
  const metadataMatch = or(tagMatch, filenameMatch, languageMatch)!;
  const tier = sql<number>`CASE
    WHEN ${titleExact} THEN 0
    WHEN ${titlePrefix} THEN 1
    WHEN ${exactTag} OR ${filenameExact} THEN 2
    WHEN ${titleMatch} THEN 3
    WHEN ${metadataMatch} THEN 4
    ELSE 5
  END`;
  const fieldCount = sql<number>`(
    CASE WHEN ${titleMatch} THEN 1 ELSE 0 END
    + CASE WHEN ${tagMatch} THEN 1 ELSE 0 END
    + CASE WHEN ${filenameMatch} THEN 1 ELSE 0 END
    + CASE WHEN ${languageMatch} THEN 1 ELSE 0 END
    + CASE WHEN ${notesMatch} THEN 1 ELSE 0 END
    + CASE WHEN ${codeMatch} THEN 1 ELSE 0 END
  )`;
  const occurrenceCount = sql<number>`min(5,
    ${literalOccurrenceCount(entries.title, query)}
    + ${tagOccurrenceCount(query, containsPattern)}
    + ${literalOccurrenceCount(entries.filename, query)}
    + ${literalOccurrenceCount(entries.language, query)}
    + ${literalOccurrenceCount(entries.notesMd, query)}
    + ${literalOccurrenceCount(entries.code, query)}
  )`;
  const firstPosition = sql<number>`min(
    ${literalFirstPosition(entries.title, query, titleMatch)},
    ${tagFirstPosition(query, containsPattern)},
    ${literalFirstPosition(entries.filename, query, filenameMatch)},
    ${literalFirstPosition(entries.language, query, languageMatch)},
    ${literalFirstPosition(entries.notesMd, query, notesMatch)},
    ${literalFirstPosition(entries.code, query, codeMatch)}
  )`;
  return { condition, tier, fieldCount, occurrenceCount, firstPosition };
}

function tagLike(pattern: string): SQL {
  return sql`EXISTS (
      SELECT 1 FROM ${entryTags}
      INNER JOIN ${tags} ON ${tags.id} = ${entryTags.tagId}
      WHERE ${entryTags.entryId} = ${entries.id}
        AND ${tags.name} LIKE ${pattern} ESCAPE ${"\\"}
    )`;
}

function tagOccurrenceCount(query: string, pattern: string): SQL<number> {
  return sql<number>`COALESCE((
    SELECT SUM(${literalOccurrenceCount(tags.name, query)})
    FROM ${entryTags}
    INNER JOIN ${tags} ON ${tags.id} = ${entryTags.tagId}
    WHERE ${entryTags.entryId} = ${entries.id}
      AND ${tags.name} LIKE ${pattern} ESCAPE ${"\\"}
  ), 0)`;
}

function tagFirstPosition(query: string, pattern: string): SQL<number> {
  return sql<number>`COALESCE((
    SELECT MIN(instr(lower(${tags.name}), lower(${query})))
    FROM ${entryTags}
    INNER JOIN ${tags} ON ${tags.id} = ${entryTags.tagId}
    WHERE ${entryTags.entryId} = ${entries.id}
      AND ${tags.name} LIKE ${pattern} ESCAPE ${"\\"}
  ), 2147483647)`;
}

function literalOccurrenceCount(column: AnyColumn, query: string): SQL<number> {
  return sql<number>`CASE
    WHEN ${column} IS NULL THEN 0
    ELSE (
      length(lower(${column}))
      - length(replace(lower(${column}), lower(${query}), ''))
    ) / length(${query})
  END`;
}

function literalFirstPosition(
  column: AnyColumn,
  query: string,
  matches: SQL,
): SQL<number> {
  return sql<number>`CASE
    WHEN ${matches} THEN instr(lower(${column}), lower(${query}))
    ELSE 2147483647
  END`;
}

function likeLiteral(column: AnyColumn, pattern: string): SQL {
  return sql`${column} LIKE ${pattern} ESCAPE ${"\\"}`;
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function normalizeCreateFields(input: CreateEntryInput): NormalizedEntryFields {
  requireFolder(input.folderId);
  const parentId = input.parentId ?? null;
  const kind = normalizeEntryKind(input.kind);
  assertValidEntryParent(null, parentId, input.folderId, kind);
  return normalizeFields({
    parentId,
    folderId: input.folderId,
    kind,
    title: normalizeRequiredText(input.title, "title"),
    notesMd: normalizeNotesMarkdown(input.notesMd ?? ""),
    code: normalizeNullableCode(input.code),
    language: normalizeOptionalText(input.language ?? null, "language"),
    filename: normalizeOptionalText(input.filename ?? null, "filename"),
  });
}

function normalizeUpdateFields(
  entryId: number,
  current: EntryRow,
  input: UpdateEntryInput,
): NormalizedEntryFields {
  if (
    input.kind !== undefined &&
    normalizeEntryKind(input.kind) !== current.kind
  ) {
    throw new RepositoryError(
      "CONFLICT",
      "Entry kind cannot be changed after creation.",
      { entryId, kind: current.kind },
    );
  }
  const folderId = input.folderId ?? current.folderId;
  if (input.folderId !== undefined) requireFolder(input.folderId);
  const parentId =
    input.parentId === undefined
      ? folderId === current.folderId
        ? current.parentId
        : null
      : input.parentId;
  assertValidEntryParent(entryId, parentId, folderId, current.kind);
  return normalizeFields({
    parentId,
    folderId,
    kind: current.kind,
    title:
      input.title === undefined
        ? current.title
        : normalizeRequiredText(input.title, "title"),
    notesMd:
      input.notesMd === undefined
        ? current.notesMd
        : normalizeNotesMarkdown(input.notesMd),
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

function assertValidEntryParent(
  entryId: number | null,
  parentId: number | null,
  folderId: number,
  kind: EntryKind,
): void {
  if (parentId === null) return;
  assertPositiveId(parentId, "parentId");

  const { db } = getNeumDatabase();
  const rows = db
    .select({
      id: entries.id,
      parentId: entries.parentId,
      folderId: entries.folderId,
      kind: entries.kind,
    })
    .from(entries)
    .all();
  const byId = new Map(rows.map((row) => [row.id, row]));
  const parent = byId.get(parentId);
  if (!parent) {
    throw new RepositoryError("NOT_FOUND", "Parent entry not found.", { parentId });
  }
  if (parent.folderId !== folderId) {
    throw new RepositoryError(
      "CONFLICT",
      "Parent and child entries must belong to the same folder.",
      { parentId, folderId },
    );
  }
  if (parent.kind !== kind) {
    throw new RepositoryError(
      "CONFLICT",
      "Parent and child entries must belong to the same unit.",
      { parentId, kind },
    );
  }
  if (entryId === null) return;

  const seen = new Set<number>();
  let cursor: number | null = parentId;
  while (cursor !== null) {
    if (cursor === entryId) {
      throw new RepositoryError("CONFLICT", "An entry cannot be moved below itself.", {
        entryId,
        parentId,
      });
    }
    if (seen.has(cursor)) break;
    seen.add(cursor);
    cursor = byId.get(cursor)?.parentId ?? null;
  }
}

function descendantEntryIds(entryId: number): number[] {
  const { db } = getNeumDatabase();
  const rows = db
    .select({ id: entries.id, parentId: entries.parentId })
    .from(entries)
    .all();
  const descendants = new Set<number>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (
        row.parentId !== null &&
        (row.parentId === entryId || descendants.has(row.parentId)) &&
        !descendants.has(row.id)
      ) {
        descendants.add(row.id);
        changed = true;
      }
    }
  }
  return [...descendants];
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
  if (value === undefined || value === null) return null;
  const code = normalizeVerbatimText(value, "code");
  if (utf8ByteLength(code) > ENTRY_CODE_MAX_BYTES) {
    throw new RepositoryError(
      "CODE_TOO_LARGE",
      "Code content must not exceed 10 MiB.",
      { field: "code", maxBytes: ENTRY_CODE_MAX_BYTES },
    );
  }
  return code;
}

function normalizeNotesMarkdown(value: unknown): string {
  const notesMd = normalizeVerbatimText(value, "notesMd");
  if (utf8ByteLength(notesMd) > ENTRY_NOTES_MAX_BYTES) {
    throw new RepositoryError(
      "CONTENT_TOO_LARGE",
      "Markdown notes must not exceed 10 MiB.",
      { field: "notesMd", maxBytes: ENTRY_NOTES_MAX_BYTES },
    );
  }
  return notesMd;
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
