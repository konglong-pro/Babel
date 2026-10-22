import {
  asciiFold,
  countLiteralOccurrences,
  createTextSnippet,
  highlightLiteral,
  literalTextPosition,
} from "@babel-apps/platform/search/text";
import {
  collectRankedSearchPage,
  normalizeSearchPage,
  trigramFtsQuery,
} from "@babel-apps/platform/search/page";

import { sqlite } from "@/lib/db/client";
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

export interface ArchiveSearchOptions {
  limit?: number;
  knowledgeOffset?: number;
  exerciseOffset?: number;
}

type SearchableKnowledgeRow = Pick<
  typeof knowledgeNotes.$inferSelect,
  "id" | "parentId" | "folderId" | "title" | "contentMd" | "tags" | "updatedAt"
>;
type SearchableExerciseRow = Pick<
  typeof exercises.$inferSelect,
  | "id"
  | "folderId"
  | "title"
  | "problemMd"
  | "answerMd"
  | "solutionMd"
  | "tags"
  | "updatedAt"
>;

export function searchArchive(
  query: string,
  options: ArchiveSearchOptions = {},
): SearchResultsDto {
  const normalized = typeof query === "string" ? query.trim() : "";
  const knowledgePagination = normalizeSearchPage({
    limit: options.limit,
    offset: options.knowledgeOffset,
  });
  const exercisePagination = normalizeSearchPage({
    limit: options.limit,
    offset: options.exerciseOffset,
  });
  if (!normalized) {
    return {
      knowledge: [],
      exercises: [],
      knowledgeTotal: 0,
      exerciseTotal: 0,
      limit: knowledgePagination.limit,
      knowledgeOffset: knowledgePagination.offset,
      exerciseOffset: exercisePagination.offset,
    };
  }

  const knowledgePage = collectRankedSearchPage(
    matchingKnowledgeRows(normalized),
    (row) => rankKnowledge(row, normalized),
    compareRankedResults,
    knowledgePagination,
  );
  const exercisePage = collectRankedSearchPage(
    matchingExerciseRows(normalized),
    (row) => rankExercise(row, normalized),
    compareRankedResults,
    exercisePagination,
  );

  return {
    knowledge: knowledgePage.items.map(({ result }) => result),
    exercises: exercisePage.items.map(({ result }) => result),
    knowledgeTotal: knowledgePage.total,
    exerciseTotal: exercisePage.total,
    limit: knowledgePage.limit,
    knowledgeOffset: knowledgePage.offset,
    exerciseOffset: exercisePage.offset,
  };
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
  row: SearchableKnowledgeRow,
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
  row: SearchableExerciseRow,
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

function matchingKnowledgeRows(query: string): Iterable<SearchableKnowledgeRow> {
  const pattern = `%${escapeLike(query)}%`;
  const ftsQuery = trigramFtsQuery(query);
  const candidate = ftsQuery === undefined
    ? ""
    : "`id` IN (SELECT `rowid` FROM `knowledge_search` WHERE `knowledge_search` MATCH @ftsQuery) AND";
  const statement = sqlite.prepare(`
    SELECT
      \`id\`,
      \`parent_id\` AS \`parentId\`,
      \`folder_id\` AS \`folderId\`,
      \`title\`,
      \`content_md\` AS \`contentMd\`,
      \`tags\`,
      \`updated_at\` AS \`updatedAt\`
    FROM \`knowledge_note\`
    WHERE ${candidate} (
      \`title\` LIKE @pattern ESCAPE '\\'
      OR \`content_md\` LIKE @pattern ESCAPE '\\'
      OR \`tags\` LIKE @pattern ESCAPE '\\'
    )
  `);
  const parameters = ftsQuery === undefined ? { pattern } : { pattern, ftsQuery };
  return statement.iterate(parameters) as Iterable<SearchableKnowledgeRow>;
}

function matchingExerciseRows(query: string): Iterable<SearchableExerciseRow> {
  const pattern = `%${escapeLike(query)}%`;
  const ftsQuery = trigramFtsQuery(query);
  const candidate = ftsQuery === undefined
    ? ""
    : "`id` IN (SELECT `rowid` FROM `exercise_search` WHERE `exercise_search` MATCH @ftsQuery) AND";
  const statement = sqlite.prepare(`
    SELECT
      \`id\`,
      \`folder_id\` AS \`folderId\`,
      \`title\`,
      \`problem_md\` AS \`problemMd\`,
      \`answer_md\` AS \`answerMd\`,
      \`solution_md\` AS \`solutionMd\`,
      \`tags\`,
      \`updated_at\` AS \`updatedAt\`
    FROM \`exercise\`
    WHERE ${candidate} (
      \`title\` LIKE @pattern ESCAPE '\\'
      OR \`problem_md\` LIKE @pattern ESCAPE '\\'
      OR \`answer_md\` LIKE @pattern ESCAPE '\\'
      OR \`solution_md\` LIKE @pattern ESCAPE '\\'
      OR \`tags\` LIKE @pattern ESCAPE '\\'
    )
  `);
  const parameters = ftsQuery === undefined ? { pattern } : { pattern, ftsQuery };
  return statement.iterate(parameters) as Iterable<SearchableExerciseRow>;
}
