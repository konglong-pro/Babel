import {
  asciiFold,
  countLiteralOccurrences,
  createTextSnippet,
  highlightLiteral,
  literalTextPosition,
} from "@babel-apps/platform/search/text";
import { or, sql, type AnyColumn, type SQL } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { exercises, knowledgeNotes } from "@/lib/db/schema";
import type {
  ExerciseSearchField,
  ExerciseSearchResultDto,
  KnowledgeSearchField,
  KnowledgeSearchResultDto,
  SearchResultsDto,
  SearchSnippetDto,
} from "@/lib/types";

import { tagsFromJson } from "./shared";

export function searchArchive(query: string): SearchResultsDto {
  const normalized = typeof query === "string" ? query.trim() : "";
  if (!normalized) return { knowledge: [], exercises: [] };

  const pattern = `%${escapeLike(normalized)}%`;
  const knowledge = db
    .select({
      id: knowledgeNotes.id,
      parentId: knowledgeNotes.parentId,
      folderId: knowledgeNotes.folderId,
      title: knowledgeNotes.title,
      contentMd: knowledgeNotes.contentMd,
      tags: knowledgeNotes.tags,
      updatedAt: knowledgeNotes.updatedAt,
    })
    .from(knowledgeNotes)
    .where(
      or(
        likeLiteral(knowledgeNotes.title, pattern),
        likeLiteral(knowledgeNotes.contentMd, pattern),
        likeLiteral(knowledgeNotes.tags, pattern),
      ),
    )
    .all()
    .map((row) => rankKnowledge(row, normalized))
    .sort(compareRankedResults)
    .map(({ result }) => result);

  const matchingExercises = db
    .select({
      id: exercises.id,
      folderId: exercises.folderId,
      title: exercises.title,
      problemMd: exercises.problemMd,
      answerMd: exercises.answerMd,
      solutionMd: exercises.solutionMd,
      tags: exercises.tags,
      updatedAt: exercises.updatedAt,
    })
    .from(exercises)
    .where(
      or(
        likeLiteral(exercises.title, pattern),
        likeLiteral(exercises.problemMd, pattern),
        likeLiteral(exercises.answerMd, pattern),
        likeLiteral(exercises.solutionMd, pattern),
        likeLiteral(exercises.tags, pattern),
      ),
    )
    .all()
    .map((row) => rankExercise(row, normalized))
    .sort(compareRankedResults)
    .map(({ result }) => result);

  return { knowledge, exercises: matchingExercises };
}

interface RankMetrics {
  titlePosition: number;
  bodyPosition: number;
  matchingTags: string[];
  tagMatched: boolean;
  rawOnlyTagMatch: boolean;
  tier: number;
  fieldCount: number;
  occurrenceCount: number;
  firstPosition: number;
}

interface RankedResult<T extends { id: number; updatedAt: string }> {
  result: T;
  tier: number;
  fieldCount: number;
  occurrenceCount: number;
  firstPosition: number;
}

function rankKnowledge(
  row: {
    id: number;
    parentId: number | null;
    folderId: number;
    title: string;
    contentMd: string;
    tags: string;
    updatedAt: string;
  },
  query: string,
): RankedResult<KnowledgeSearchResultDto> {
  const tags = tagsFromJson(row.tags);
  const metrics = rankFields(row.title, row.contentMd, tags, row.tags, query);
  const matchedFields: KnowledgeSearchField[] = [];
  if (metrics.titlePosition >= 0) matchedFields.push("title");
  if (metrics.bodyPosition >= 0) matchedFields.push("content");
  if (metrics.tagMatched) matchedFields.push("tags");
  const result: KnowledgeSearchResultDto = {
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
      snippet: chooseSnippet("content", row.contentMd, metrics, query),
    },
  };
  return { result, ...rankValues(metrics) };
}

function rankExercise(
  row: {
    id: number;
    folderId: number;
    title: string;
    problemMd: string;
    answerMd: string;
    solutionMd: string;
    tags: string;
    updatedAt: string;
  },
  query: string,
): RankedResult<ExerciseSearchResultDto> {
  const tags = tagsFromJson(row.tags);
  const bodies = [
    { field: "problem" as const, value: row.problemMd },
    { field: "answer" as const, value: row.answerMd },
    { field: "solution" as const, value: row.solutionMd },
  ];
  const matchedBodies = bodies
    .map((body) => ({ ...body, position: literalTextPosition(body.value, query) }))
    .filter((body) => body.position >= 0)
    .sort((left, right) => left.position - right.position);
  const metrics = rankFields(
    row.title,
    bodies.map(({ value }) => value).join("\u0000"),
    tags,
    row.tags,
    query,
  );
  metrics.fieldCount += Math.max(0, matchedBodies.length - 1);
  const matchedFields: ExerciseSearchField[] = [];
  if (metrics.titlePosition >= 0) matchedFields.push("title");
  for (const body of bodies) {
    if (literalTextPosition(body.value, query) >= 0) matchedFields.push(body.field);
  }
  if (metrics.tagMatched) matchedFields.push("tags");
  const snippetBody = matchedBodies[0] ?? bodies[0];
  const result: ExerciseSearchResultDto = {
    id: row.id,
    folderId: row.folderId,
    title: row.title,
    tags,
    updatedAt: row.updatedAt,
    match: {
      matchedFields,
      title: highlightLiteral(row.title, query),
      tags: tags.map((tag) => ({ value: tag, parts: highlightLiteral(tag, query) })),
      snippet: chooseSnippet(snippetBody.field, snippetBody.value, metrics, query),
    },
  };
  return { result, ...rankValues(metrics) };
}

function rankFields(
  title: string,
  body: string,
  tags: readonly string[],
  storedTags: string,
  query: string,
): RankMetrics {
  const titlePosition = literalTextPosition(title, query);
  const bodyPosition = literalTextPosition(body, query);
  const matchingTags = tags.filter((tag) => literalTextPosition(tag, query) >= 0);
  const rawTagPosition = literalTextPosition(storedTags, query);
  const tagMatched = matchingTags.length > 0 || rawTagPosition >= 0;
  const rawOnlyTagMatch = rawTagPosition >= 0 && matchingTags.length === 0;
  const tagPosition = matchingTags.reduce(
    (first, tag) => Math.min(first, literalTextPosition(tag, query)),
    Number.POSITIVE_INFINITY,
  );
  const foldedTitle = asciiFold(title);
  const foldedQuery = asciiFold(query);
  const exactTag = tags.some((tag) => asciiFold(tag) === foldedQuery);
  const tier = foldedTitle === foldedQuery
    ? 0
    : foldedTitle.startsWith(foldedQuery)
      ? 1
      : exactTag
        ? 2
        : titlePosition >= 0
          ? 3
          : tagMatched
            ? 4
            : 5;
  return {
    titlePosition,
    bodyPosition,
    matchingTags,
    tagMatched,
    rawOnlyTagMatch,
    tier,
    fieldCount: Number(titlePosition >= 0)
      + Number(bodyPosition >= 0)
      + Number(tagMatched),
    occurrenceCount: Math.min(
      5,
      countLiteralOccurrences(title, query)
        + countLiteralOccurrences(body, query)
        + matchingTags.reduce(
          (total, tag) => total + countLiteralOccurrences(tag, query),
          0,
        ),
    ),
    firstPosition: Math.min(
      titlePosition < 0 ? Number.POSITIVE_INFINITY : titlePosition,
      bodyPosition < 0 ? Number.POSITIVE_INFINITY : bodyPosition,
      tagPosition,
    ),
  };
}

function rankValues(metrics: RankMetrics): Omit<RankedResult<never>, "result"> {
  return {
    tier: metrics.tier,
    fieldCount: metrics.fieldCount,
    occurrenceCount: metrics.occurrenceCount,
    firstPosition: metrics.firstPosition,
  };
}

function chooseSnippet<
  TField extends "content" | "problem" | "answer" | "solution",
>(
  bodyField: TField,
  body: string,
  metrics: RankMetrics,
  query: string,
): SearchSnippetDto<"title" | "tags" | TField> {
  if (metrics.bodyPosition >= 0) {
    return { field: bodyField, ...createTextSnippet(body, query) };
  }
  if (metrics.matchingTags.length > 0) {
    return {
      field: "tags",
      ...createTextSnippet(metrics.matchingTags.join(", "), query),
    };
  }
  if (metrics.rawOnlyTagMatch) {
    return {
      field: "tags",
      parts: [{ text: "Tag data match", highlighted: false }],
      truncatedStart: false,
      truncatedEnd: false,
    };
  }
  return {
    field: "title",
    parts: [{ text: "Title match", highlighted: false }],
    truncatedStart: false,
    truncatedEnd: false,
  };
}

function compareRankedResults<T extends { id: number; updatedAt: string }>(
  left: RankedResult<T>,
  right: RankedResult<T>,
): number {
  return left.tier - right.tier
    || right.fieldCount - left.fieldCount
    || right.occurrenceCount - left.occurrenceCount
    || left.firstPosition - right.firstPosition
    || right.result.updatedAt.localeCompare(left.result.updatedAt)
    || right.result.id - left.result.id;
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function likeLiteral(column: AnyColumn, pattern: string): SQL {
  return sql`${column} LIKE ${pattern} ESCAPE ${"\\"}`;
}
