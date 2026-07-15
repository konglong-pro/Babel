import { or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import {
  asciiFold,
  countLiteralOccurrences,
  createTextSnippet,
  highlightLiteral,
  literalTextPosition,
} from "@babel-apps/platform/search/text";

import { db } from "@/lib/db/client";
import { notes } from "@/lib/db/schema";
import type {
  NoteSearchField,
  NoteSearchResultDto,
  SearchResultsDto,
} from "@/lib/types";

import { tagsFromJson } from "./shared";

export function searchNotes(query: string): SearchResultsDto {
  const normalized = typeof query === "string" ? query.trim() : "";
  if (!normalized) return { notes: [] };

  const pattern = `%${escapeLike(normalized)}%`;
  const matches = db
    .select()
    .from(notes)
    .where(
      or(
        likeLiteral(notes.title, pattern),
        likeLiteral(notes.contentMd, pattern),
        likeLiteral(notes.tags, pattern),
      ),
    )
    .all()
    .map((row) => rankNote(row, normalized))
    .sort(compareRankedNotes)
    .map(({ result }) => result);
  return { notes: matches };
}

interface RankedNote {
  result: NoteSearchResultDto;
  tier: number;
  fieldCount: number;
  occurrenceCount: number;
  firstPosition: number;
}

function rankNote(
  row: typeof notes.$inferSelect,
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

function likeLiteral(column: AnyColumn, pattern: string): SQL {
  return sql`${column} LIKE ${pattern} ESCAPE ${"\\"}`;
}
