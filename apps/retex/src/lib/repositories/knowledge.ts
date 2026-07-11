import { asc, desc, eq, sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { knowledgeExercises, knowledgeNotes } from "@/lib/db/schema";
import type {
  KnowledgeDetailDto,
  KnowledgeSummaryDto,
} from "@/lib/types";

import { RepositoryError } from "./errors";
import { validateExerciseIds } from "./relation-validation";
import { listKnowledgeExercises } from "./relations";
import {
  assertPositiveId,
  normalizeMarkdown,
  normalizeRequiredText,
  requireFolder,
  tagsFromJson,
  tagsToJson,
} from "./shared";

type KnowledgeRow = typeof knowledgeNotes.$inferSelect;

export interface CreateKnowledgeInput {
  folderId: number;
  title: string;
  contentMd?: string;
  tags?: readonly string[];
  exerciseIds?: readonly number[];
}

export interface UpdateKnowledgeInput {
  folderId?: number;
  title?: string;
  contentMd?: string;
  tags?: readonly string[];
  exerciseIds?: readonly number[];
}

export function listKnowledge(folderId?: number): KnowledgeSummaryDto[] {
  if (folderId !== undefined) {
    requireFolder(folderId, "knowledge");
    return db
      .select()
      .from(knowledgeNotes)
      .where(eq(knowledgeNotes.folderId, folderId))
      .orderBy(desc(knowledgeNotes.updatedAt), asc(knowledgeNotes.title))
      .all()
      .map(toKnowledgeSummary);
  }

  return db
    .select()
    .from(knowledgeNotes)
    .orderBy(desc(knowledgeNotes.updatedAt), asc(knowledgeNotes.title))
    .all()
    .map(toKnowledgeSummary);
}

export function getKnowledge(id: number): KnowledgeDetailDto | null {
  assertPositiveId(id, "id");
  const knowledge = db
    .select()
    .from(knowledgeNotes)
    .where(eq(knowledgeNotes.id, id))
    .get();

  if (!knowledge) {
    return null;
  }

  return toKnowledgeDetail(knowledge);
}

export function createKnowledge(
  input: CreateKnowledgeInput,
): KnowledgeDetailDto {
  requireFolder(input.folderId, "knowledge");
  const title = normalizeRequiredText(input.title, "title");
  const contentMd = normalizeMarkdown(input.contentMd ?? "", "contentMd");
  const tags = tagsToJson(input.tags ?? []);
  const exerciseIds = validateExerciseIds(input.exerciseIds ?? []);

  const knowledge = db.transaction((transaction) => {
    const row = transaction
      .insert(knowledgeNotes)
      .values({ folderId: input.folderId, title, contentMd, tags })
      .returning()
      .get();

    if (exerciseIds.length > 0) {
      transaction
        .insert(knowledgeExercises)
        .values(
          exerciseIds.map((exerciseId) => ({
            knowledgeId: row.id,
            exerciseId,
          })),
        )
        .run();
    }

    return row;
  });

  return toKnowledgeDetail(knowledge);
}

export function updateKnowledge(
  id: number,
  input: UpdateKnowledgeInput,
): KnowledgeDetailDto {
  assertPositiveId(id, "id");
  const current = db
    .select()
    .from(knowledgeNotes)
    .where(eq(knowledgeNotes.id, id))
    .get();

  if (!current) {
    throw new RepositoryError("NOT_FOUND", "Knowledge note not found.", {
      knowledgeId: id,
    });
  }

  const changes: {
    folderId?: number;
    title?: string;
    contentMd?: string;
    tags?: string;
    updatedAt: SQL;
  } = { updatedAt: sql`CURRENT_TIMESTAMP` };
  let hasChanges = false;
  let relatedExerciseIds: number[] | undefined;

  if (input.folderId !== undefined) {
    requireFolder(input.folderId, "knowledge");
    changes.folderId = input.folderId;
    hasChanges = true;
  }

  if (input.title !== undefined) {
    changes.title = normalizeRequiredText(input.title, "title");
    hasChanges = true;
  }

  if (input.contentMd !== undefined) {
    changes.contentMd = normalizeMarkdown(input.contentMd, "contentMd");
    hasChanges = true;
  }

  if (input.tags !== undefined) {
    changes.tags = tagsToJson(input.tags);
    hasChanges = true;
  }

  if (input.exerciseIds !== undefined) {
    relatedExerciseIds = validateExerciseIds(input.exerciseIds);
    hasChanges = true;
  }

  if (!hasChanges) {
    return toKnowledgeDetail(current);
  }

  const updated = db.transaction((transaction) => {
    const row = transaction
      .update(knowledgeNotes)
      .set(changes)
      .where(eq(knowledgeNotes.id, id))
      .returning()
      .get();

    if (relatedExerciseIds !== undefined) {
      transaction
        .delete(knowledgeExercises)
        .where(eq(knowledgeExercises.knowledgeId, id))
        .run();

      if (relatedExerciseIds.length > 0) {
        transaction
          .insert(knowledgeExercises)
          .values(
            relatedExerciseIds.map((exerciseId) => ({
              knowledgeId: id,
              exerciseId,
            })),
          )
          .run();
      }
    }

    return row;
  });

  return toKnowledgeDetail(updated);
}

export function deleteKnowledge(id: number): boolean {
  assertPositiveId(id, "id");
  return (
    db
      .delete(knowledgeNotes)
      .where(eq(knowledgeNotes.id, id))
      .returning({ id: knowledgeNotes.id })
      .get() !== undefined
  );
}

function toKnowledgeSummary(row: KnowledgeRow): KnowledgeSummaryDto {
  return {
    id: row.id,
    folderId: row.folderId,
    title: row.title,
    tags: tagsFromJson(row.tags),
    updatedAt: row.updatedAt,
  };
}

function toKnowledgeDetail(row: KnowledgeRow): KnowledgeDetailDto {
  return {
    ...toKnowledgeSummary(row),
    contentMd: row.contentMd,
    createdAt: row.createdAt,
    relatedExercises: listKnowledgeExercises(row.id),
  };
}
