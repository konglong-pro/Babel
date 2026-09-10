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
import { notes } from "@/lib/db/schema";
import type {
  NoteSearchField,
  NoteSearchResultDto,
  SearchResultsDto,
} from "@/lib/types";

import { tagsFromJson } from "./shared";

type SearchableNoteRow = Pick<
  typeof notes.$inferSelect,
  "id" | "folderId" | "parentId" | "title" | "contentMd" | "tags" | "updatedAt"
>;

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
    compareRankedNotes,
    options,
  );
  return {
    notes: page.items.map(({ result }) => result),
    total: page.total,
    limit: page.limit,
    offset: page.offset,
  };
}

interface RankedNote {
  result: NoteSearchResultDto;
  tier: number;
  fieldCount: number;
  occurrenceCount: number;
  firstPosition: number;
}

function rankNote(
  row: SearchableNoteRow,
  query: string,
): RankedNote {
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
  const matchedFields: NoteSearchField[] = [];
  if (titlePosition >= 0) matchedFields.push("title");
  if (contentPosition >= 0) matchedFields.push("content");
  if (hasVisibleTagMatch || hasStoredTagOnlyMatch) matchedFields.push("tags");

  const normalizedTitle = asciiFold(row.title);
  const normalizedQuery = asciiFold(query);
  const hasExactTag = tags.some((tag) => asciiFold(tag) === normalizedQuery);
  const tier = normalizedTitle === normalizedQuery
    ? 0
    : normalizedTitle.startsWith(normalizedQuery)
      ? 1
      : hasExactTag
        ? 2
        : titlePosition >= 0
          ? 3
          : matchedFields.includes("tags")
            ? 4
            : 5;
  const snippet = contentPosition >= 0
    ? textSnippet("content", row.contentMd, query)
    : hasVisibleTagMatch
      ? textSnippet("tags", matchingTags.join(", "), query)
      : hasStoredTagOnlyMatch
        ? storedTagMatchSnippet()
        : {
            field: "title" as const,
            parts: [{ text: "Title match", highlighted: false }],
            truncatedStart: false,
            truncatedEnd: false,
          };

  return {
    result: {
      id: row.id,
      parentId: row.parentId,
      folderId: row.folderId,
      title: row.title,
      tags,
      updatedAt: row.updatedAt,
      match: {
        matchedFields,
        title: highlightLiteral(row.title, query),
        tags: tags.map((tag) => ({ value: tag, parts: highlightLiteral(tag, query) })),
        snippet,
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
    firstPosition: Math.min(titlePosition < 0 ? Infinity : titlePosition, contentPosition < 0 ? Infinity : contentPosition, tagPosition),
  };
}

function compareRankedNotes(left: RankedNote, right: RankedNote): number {
  return left.tier - right.tier
    || right.fieldCount - left.fieldCount
    || right.occurrenceCount - left.occurrenceCount
    || left.firstPosition - right.firstPosition
    || right.result.updatedAt.localeCompare(left.result.updatedAt)
    || right.result.id - left.result.id;
}

function textSnippet(
  field: "content" | "tags",
  value: string,
  query: string,
): NoteSearchResultDto["match"]["snippet"] {
  return { field, ...createTextSnippet(value, query) };
}

function storedTagMatchSnippet(): NoteSearchResultDto["match"]["snippet"] {
  return {
    field: "tags",
    parts: [{ text: "Tag data match", highlighted: false }],
    truncatedStart: false,
    truncatedEnd: false,
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
