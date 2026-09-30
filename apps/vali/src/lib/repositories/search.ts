import {
  collectRankedSearchPage,
  normalizeSearchPage,
  trigramFtsQuery,
  type SearchPageOptions,
} from "@babel-apps/platform/search/page";
import {
  asciiFold,
  countLiteralOccurrences,
  createTextSnippet,
  highlightLiteral,
  literalTextPosition,
} from "@babel-apps/platform/search/text";

import { sqlite } from "@/lib/db/client";
import { notes, reflections } from "@/lib/db/schema";
import type {
  DocumentSearchField,
  DocumentSearchResultDto,
  DocumentSearchResultsDto,
  NoteSummaryDto,
  SearchResultsDto,
} from "@/lib/types";

import { tagsFromJson } from "./shared";

type SearchableNoteRow = Pick<
  typeof notes.$inferSelect,
  "id" | "folderId" | "parentId" | "title" | "contentMd" | "tags" | "updatedAt"
>;
type SearchableReflectionRow = Pick<
  typeof reflections.$inferSelect,
  "date" | "contentMd" | "updatedAt"
>;
type SearchableDocumentRow =
  | { kind: "note"; row: SearchableNoteRow }
  | { kind: "reflection"; row: SearchableReflectionRow };

export function searchNotes(
  query: string,
  options: SearchPageOptions = {},
): SearchResultsDto {
  const normalized = typeof query === "string" ? query.trim() : "";
  if (!normalized) {
    return { notes: [], total: 0, ...normalizeSearchPage(options) };
  }

  const page = collectRankedSearchPage(
    matchingNoteRows(normalized),
    (row) => rankNote(row, normalized),
    compareRankedDocuments,
    options,
  );
  return {
    notes: page.items.map(({ result }) => noteSummary(result)),
    total: page.total,
    limit: page.limit,
    offset: page.offset,
  };
}

export function searchDocuments(
  query: string,
  options: SearchPageOptions = {},
): DocumentSearchResultsDto {
  const normalized = typeof query === "string" ? query.trim() : "";
  if (!normalized) {
    return { results: [], total: 0, ...normalizeSearchPage(options) };
  }

  const page = collectRankedSearchPage(
    matchingDocumentRows(normalized),
    (document) => document.kind === "note"
      ? rankNote(document.row, normalized)
      : rankReflection(document.row, normalized),
    compareRankedDocuments,
    options,
  );
  return {
    results: page.items.map(({ result }) => result),
    total: page.total,
    limit: page.limit,
    offset: page.offset,
  };
}

interface RankedDocument {
  result: DocumentSearchResultDto;
  tier: number;
  fieldCount: number;
  occurrenceCount: number;
  firstPosition: number;
  stableKey: string;
}

function rankNote(row: SearchableNoteRow, query: string): RankedDocument {
  const tags = tagsFromJson(row.tags);
  const titlePosition = literalTextPosition(row.title, query);
  const contentPosition = literalTextPosition(row.contentMd, query);
  const matchingTags = tags.filter((tag) => literalTextPosition(tag, query) >= 0);
  const hasVisibleTagMatch = matchingTags.length > 0;
  const hasStoredTagMatch = literalTextPosition(row.tags, query) >= 0;
  const hasStoredTagOnlyMatch = hasStoredTagMatch && !hasVisibleTagMatch;
  const tagPosition = matchingTags.reduce(
    (first, tag) => Math.min(first, literalTextPosition(tag, query)),
    Number.POSITIVE_INFINITY,
  );
  const matchedFields: DocumentSearchField[] = [];
  if (titlePosition >= 0) matchedFields.push("title");
  if (contentPosition >= 0) matchedFields.push("content");
  if (hasVisibleTagMatch || hasStoredTagOnlyMatch) matchedFields.push("tags");

  const foldedTitle = asciiFold(row.title);
  const foldedQuery = asciiFold(query);
  const hasExactTag = tags.some((tag) => asciiFold(tag) === foldedQuery);
  const tier = foldedTitle === foldedQuery
    ? 0
    : foldedTitle.startsWith(foldedQuery)
      ? 1
      : hasExactTag
        ? 2
        : titlePosition >= 0
          ? 3
          : matchedFields.includes("tags")
            ? 4
            : 5;

  return {
    result: {
      kind: "note",
      id: row.id,
      folderId: row.folderId,
      parentId: row.parentId,
      title: row.title,
      tags,
      updatedAt: row.updatedAt,
      match: {
        matchedFields,
        title: highlightLiteral(row.title, query),
        tags: tags.map((tag) => ({ value: tag, parts: highlightLiteral(tag, query) })),
        snippet: contentPosition >= 0
          ? textSnippet("content", row.contentMd, query)
          : hasVisibleTagMatch
            ? textSnippet("tags", matchingTags.join(", "), query)
            : hasStoredTagOnlyMatch
              ? storedTagMatchSnippet()
              : titleMatchSnippet(),
      },
    },
    tier,
    fieldCount: matchedFields.length,
    occurrenceCount: Math.min(
      5,
      countLiteralOccurrences(row.title, query)
        + countLiteralOccurrences(row.contentMd, query)
        + tags.reduce(
          (count, tag) => count + countLiteralOccurrences(tag, query),
          0,
        ),
    ),
    firstPosition: firstMatchPosition(titlePosition, contentPosition, tagPosition),
    stableKey: `note:${String(row.id).padStart(16, "0")}`,
  };
}

function rankReflection(
  row: SearchableReflectionRow,
  query: string,
): RankedDocument {
  const titlePosition = literalTextPosition(row.date, query);
  const contentPosition = literalTextPosition(row.contentMd, query);
  const matchedFields: DocumentSearchField[] = [];
  if (titlePosition >= 0) matchedFields.push("title");
  if (contentPosition >= 0) matchedFields.push("content");

  const foldedDate = asciiFold(row.date);
  const foldedQuery = asciiFold(query);
  const tier = foldedDate === foldedQuery
    ? 2
    : foldedDate.startsWith(foldedQuery)
      ? 1
      : titlePosition >= 0
        ? 3
        : 5;

  return {
    result: {
      kind: "reflection",
      date: row.date,
      title: row.date,
      updatedAt: row.updatedAt,
      match: {
        matchedFields,
        title: highlightLiteral(row.date, query),
        tags: [],
        snippet: contentPosition >= 0
          ? textSnippet("content", row.contentMd, query)
          : titleMatchSnippet(),
      },
    },
    tier,
    fieldCount: matchedFields.length,
    occurrenceCount: Math.min(
      5,
      countLiteralOccurrences(row.date, query)
        + countLiteralOccurrences(row.contentMd, query),
    ),
    firstPosition: firstMatchPosition(titlePosition, contentPosition),
    stableKey: `reflection:${row.date}`,
  };
}

function compareRankedDocuments(left: RankedDocument, right: RankedDocument): number {
  return left.tier - right.tier
    || right.fieldCount - left.fieldCount
    || right.occurrenceCount - left.occurrenceCount
    || left.firstPosition - right.firstPosition
    || right.result.updatedAt.localeCompare(left.result.updatedAt)
    || compareStableKeys(left.stableKey, right.stableKey);
}

function compareStableKeys(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function firstMatchPosition(...positions: number[]): number {
  const matches = positions.filter(
    (position) => Number.isFinite(position) && position >= 0,
  );
  return matches.length > 0 ? Math.min(...matches) : Number.MAX_SAFE_INTEGER;
}

function textSnippet(
  field: "content" | "tags",
  value: string,
  query: string,
): DocumentSearchResultDto["match"]["snippet"] {
  return { field, ...createTextSnippet(value, query) };
}

function titleMatchSnippet(): DocumentSearchResultDto["match"]["snippet"] {
  return {
    field: "title",
    parts: [{ text: "Title match", highlighted: false }],
    truncatedStart: false,
    truncatedEnd: false,
  };
}

function storedTagMatchSnippet(): DocumentSearchResultDto["match"]["snippet"] {
  return {
    field: "tags",
    parts: [{ text: "Tag data match", highlighted: false }],
    truncatedStart: false,
    truncatedEnd: false,
  };
}

function noteSummary(result: DocumentSearchResultDto): NoteSummaryDto {
  if (result.kind !== "note") throw new Error("Expected a note search result.");
  return {
    id: result.id,
    folderId: result.folderId,
    parentId: result.parentId,
    title: result.title,
    tags: result.tags,
    updatedAt: result.updatedAt,
  };
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function matchingNoteRows(query: string): Iterable<SearchableNoteRow> {
  const pattern = `%${escapeLike(query)}%`;
  const ftsQuery = trigramFtsQuery(query);
  const candidate = ftsQuery === undefined
    ? ""
    : "`id` IN (SELECT `rowid` FROM `note_search` WHERE `note_search` MATCH @ftsQuery) AND";
  const statement = sqlite.prepare(`
    SELECT
      \`id\`,
      \`folder_id\` AS \`folderId\`,
      \`parent_id\` AS \`parentId\`,
      \`title\`,
      \`content_md\` AS \`contentMd\`,
      \`tags\`,
      \`updated_at\` AS \`updatedAt\`
    FROM \`note\`
    WHERE ${candidate} (
      \`title\` LIKE @pattern ESCAPE '\\'
      OR \`content_md\` LIKE @pattern ESCAPE '\\'
      OR \`tags\` LIKE @pattern ESCAPE '\\'
    )
  `);
  const parameters = ftsQuery === undefined ? { pattern } : { pattern, ftsQuery };
  return statement.iterate(parameters) as Iterable<SearchableNoteRow>;
}

function matchingReflectionRows(query: string): Iterable<SearchableReflectionRow> {
  const pattern = `%${escapeLike(query)}%`;
  const ftsQuery = trigramFtsQuery(query);
  const candidate = ftsQuery === undefined
    ? ""
    : `(
        \`date\` LIKE @pattern ESCAPE '\\'
        OR \`date\` IN (
          SELECT \`date\` FROM \`reflection_search\`
          WHERE \`reflection_search\` MATCH @ftsQuery
        )
      ) AND`;
  const statement = sqlite.prepare(`
    SELECT
      \`date\`,
      \`content_md\` AS \`contentMd\`,
      \`updated_at\` AS \`updatedAt\`
    FROM \`reflection\`
    WHERE ${candidate} (
      \`date\` LIKE @pattern ESCAPE '\\'
      OR \`content_md\` LIKE @pattern ESCAPE '\\'
    )
  `);
  const parameters = ftsQuery === undefined ? { pattern } : { pattern, ftsQuery };
  return statement.iterate(parameters) as Iterable<SearchableReflectionRow>;
}

function* matchingDocumentRows(query: string): Iterable<SearchableDocumentRow> {
  for (const row of matchingNoteRows(query)) yield { kind: "note", row };
  for (const row of matchingReflectionRows(query)) {
    yield { kind: "reflection", row };
  }
}
