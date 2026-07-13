import { and, asc, desc, eq, ne, sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { exercises, knowledgeExercises } from "@/lib/db/schema";
import {
  deleteExerciseImage,
  normalizeStoredExerciseImagePath,
} from "@/lib/storage";
import type {
  ExerciseDetailDto,
  ExerciseSummaryDto,
} from "@/lib/types";

import { RepositoryError } from "./errors";
import {
  deleteEntityLinks,
  listOutgoingNoteLinks,
  reconcileNoteTitleChange,
  replaceSourceNoteLinks,
  resolveIncomingLinksForTitle,
} from "./links";
import { validateKnowledgeIds } from "./relation-validation";
import { listExerciseKnowledge } from "./relations";
import {
  assertPositiveId,
  normalizeMarkdown,
  normalizeRequiredText,
  requireFolder,
  tagsFromJson,
  tagsToJson,
} from "./shared";

type ExerciseRow = typeof exercises.$inferSelect;

export interface CreateExerciseInput {
  folderId: number;
  title: string;
  imagePath: string;
  answerMd?: string;
  solutionMd?: string;
  tags?: readonly string[];
  knowledgeIds?: readonly number[];
}

export interface UpdateExerciseInput {
  folderId?: number;
  title?: string;
  imagePath?: string;
  answerMd?: string;
  solutionMd?: string;
  tags?: readonly string[];
  knowledgeIds?: readonly number[];
}

export function listExercises(folderId?: number): ExerciseSummaryDto[] {
  if (folderId !== undefined) {
    requireFolder(folderId, "exercise");
    return db
      .select()
      .from(exercises)
      .where(eq(exercises.folderId, folderId))
      .orderBy(desc(exercises.updatedAt), asc(exercises.title))
      .all()
      .map(toExerciseSummary);
  }

  return db
    .select()
    .from(exercises)
    .orderBy(desc(exercises.updatedAt), asc(exercises.title))
    .all()
    .map(toExerciseSummary);
}

export function getExercise(id: number): ExerciseDetailDto | null {
  assertPositiveId(id, "id");
  const exercise = db
    .select()
    .from(exercises)
    .where(eq(exercises.id, id))
    .get();

  return exercise
    ? toExerciseDetail(
        exercise,
        listExerciseKnowledge(exercise.id),
        listOutgoingNoteLinks("exercise", exercise.id),
      )
    : null;
}

export function createExercise(
  input: CreateExerciseInput,
): ExerciseDetailDto {
  requireFolder(input.folderId, "exercise");
  const title = normalizeRequiredText(input.title, "title");
  const imagePath = normalizeStoredExerciseImagePath(input.imagePath);
  const answerMd = normalizeMarkdown(input.answerMd ?? "", "answerMd");
  const solutionMd = normalizeMarkdown(input.solutionMd ?? "", "solutionMd");
  const tags = tagsToJson(input.tags ?? []);
  const knowledgeIds = validateKnowledgeIds(input.knowledgeIds ?? []);

  return db.transaction((transaction) => {
    const row = transaction
      .insert(exercises)
      .values({
        folderId: input.folderId,
        title,
        imagePath,
        answerMd,
        solutionMd,
        tags,
      })
      .returning()
      .get();

    if (knowledgeIds.length > 0) {
      transaction
        .insert(knowledgeExercises)
        .values(
          knowledgeIds.map((knowledgeId) => ({
            knowledgeId,
            exerciseId: row.id,
          })),
        )
        .run();
    }

    replaceSourceNoteLinks(transaction, "exercise", row.id, [answerMd, solutionMd]);
    resolveIncomingLinksForTitle(transaction, title);
    return toExerciseDetail(
      row,
      listExerciseKnowledge(row.id, transaction),
      listOutgoingNoteLinks("exercise", row.id, transaction),
    );
  });
}

export function updateExercise(
  id: number,
  input: UpdateExerciseInput,
): ExerciseDetailDto {
  assertPositiveId(id, "id");
  const current = db
    .select()
    .from(exercises)
    .where(eq(exercises.id, id))
    .get();

  if (!current) {
    throw new RepositoryError("NOT_FOUND", "Exercise not found.", { exerciseId: id });
  }

  const changes: {
    folderId?: number;
    title?: string;
    imagePath?: string;
    answerMd?: string;
    solutionMd?: string;
    tags?: string;
    updatedAt: SQL;
  } = { updatedAt: sql`CURRENT_TIMESTAMP` };
  let hasChanges = false;
  let relatedKnowledgeIds: number[] | undefined;

  if (input.folderId !== undefined) {
    requireFolder(input.folderId, "exercise");
    changes.folderId = input.folderId;
    hasChanges = true;
  }

  if (input.title !== undefined) {
    changes.title = normalizeRequiredText(input.title, "title");
    hasChanges = true;
  }

  if (input.imagePath !== undefined) {
    changes.imagePath = normalizeStoredExerciseImagePath(input.imagePath);
    hasChanges = true;
  }

  if (input.answerMd !== undefined) {
    changes.answerMd = normalizeMarkdown(input.answerMd, "answerMd");
    hasChanges = true;
  }

  if (input.solutionMd !== undefined) {
    changes.solutionMd = normalizeMarkdown(input.solutionMd, "solutionMd");
    hasChanges = true;
  }

  if (input.tags !== undefined) {
    changes.tags = tagsToJson(input.tags);
    hasChanges = true;
  }

  if (input.knowledgeIds !== undefined) {
    relatedKnowledgeIds = validateKnowledgeIds(input.knowledgeIds);
    hasChanges = true;
  }

  if (!hasChanges) {
    return getExercise(id)!;
  }

  return db.transaction((transaction) => {
    const row = transaction
      .update(exercises)
      .set(changes)
      .where(eq(exercises.id, id))
      .returning()
      .get();

    if (relatedKnowledgeIds !== undefined) {
      transaction
        .delete(knowledgeExercises)
        .where(eq(knowledgeExercises.exerciseId, id))
        .run();

      if (relatedKnowledgeIds.length > 0) {
        transaction
          .insert(knowledgeExercises)
          .values(
            relatedKnowledgeIds.map((knowledgeId) => ({
              knowledgeId,
              exerciseId: id,
            })),
          )
          .run();
        }
    }

    replaceSourceNoteLinks(transaction, "exercise", id, [
      changes.answerMd ?? current.answerMd,
      changes.solutionMd ?? current.solutionMd,
    ]);
    if (changes.title !== undefined) {
      reconcileNoteTitleChange(
        transaction,
        "exercise",
        id,
        current.title,
        changes.title,
      );
    }
    return toExerciseDetail(
      row,
      listExerciseKnowledge(id, transaction),
      listOutgoingNoteLinks("exercise", id, transaction),
    );
  });
}

export async function deleteExerciseImageIfUnused(
  imagePath: string,
): Promise<boolean> {
  const normalizedPath = normalizeStoredExerciseImagePath(imagePath);
  const reference = db
    .select({ id: exercises.id })
    .from(exercises)
    .where(eq(exercises.imagePath, normalizedPath))
    .get();

  return reference ? false : deleteExerciseImage(normalizedPath);
}

export async function deleteExercise(id: number): Promise<boolean> {
  assertPositiveId(id, "id");
  const deleted = db.transaction((transaction) => {
    const exercise = transaction
      .select()
      .from(exercises)
      .where(eq(exercises.id, id))
      .get();
    if (!exercise) return null;

    const imagePath = normalizeStoredExerciseImagePath(exercise.imagePath);
    const sharedImage = transaction
      .select({ id: exercises.id })
      .from(exercises)
      .where(and(eq(exercises.imagePath, imagePath), ne(exercises.id, id)))
      .get();
    transaction.delete(exercises).where(eq(exercises.id, id)).run();
    deleteEntityLinks(transaction, "exercise", id, exercise.title);
    return { imagePath, deleteImage: sharedImage === undefined };
  });

  if (!deleted) return false;
  if (deleted.deleteImage) {
    await deleteExerciseImage(deleted.imagePath);
  }

  return true;
}

function toExerciseSummary(row: ExerciseRow): ExerciseSummaryDto {
  return {
    id: row.id,
    folderId: row.folderId,
    title: row.title,
    imagePath: row.imagePath,
    tags: tagsFromJson(row.tags),
    updatedAt: row.updatedAt,
  };
}

function toExerciseDetail(
  row: ExerciseRow,
  relatedKnowledge: ExerciseDetailDto["relatedKnowledge"],
  links: ExerciseDetailDto["links"],
): ExerciseDetailDto {
  return {
    ...toExerciseSummary(row),
    answerMd: row.answerMd,
    solutionMd: row.solutionMd,
    createdAt: row.createdAt,
    relatedKnowledge,
    links,
  };
}
