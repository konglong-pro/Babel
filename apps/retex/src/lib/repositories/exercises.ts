import { asc, eq, sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { exercises, knowledgeExercises } from "@/lib/db/schema";
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
import {
  applyNoteImageMutation,
  assertNoteImageDeletionPrepared,
  deleteNoteImageRows,
  insertNoteImages,
  prepareNewNoteImages,
  prepareNoteImageMutation,
} from "./note-images";
import { validateKnowledgeIds } from "./relation-validation";
import { listExerciseKnowledge } from "./relations";
import {
  assertPositiveId,
  normalizeMarkdown,
  normalizeRequiredMarkdown,
  normalizeRequiredText,
  requireFolder,
  tagsFromJson,
  tagsToJson,
} from "./shared";

type ExerciseRow = typeof exercises.$inferSelect;

export interface CreateExerciseInput {
  folderId: number;
  title: string;
  problemMd: string;
  answerMd?: string;
  solutionMd?: string;
  tags?: readonly string[];
  knowledgeIds?: readonly number[];
}

export interface UpdateExerciseInput {
  folderId?: number;
  title?: string;
  problemMd?: string;
  answerMd?: string;
  solutionMd?: string;
  tags?: readonly string[];
  knowledgeIds?: readonly number[];
  position?: number;
}

export function listExercises(folderId?: number): ExerciseSummaryDto[] {
  if (folderId !== undefined) {
    requireFolder(folderId, "exercise");
    return db
      .select()
      .from(exercises)
      .where(eq(exercises.folderId, folderId))
      .orderBy(asc(exercises.position), asc(exercises.id))
      .all()
      .map(toExerciseSummary);
  }

  return db
    .select()
    .from(exercises)
    .orderBy(asc(exercises.position), asc(exercises.id))
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
  newImagePaths: readonly string[] = [],
): ExerciseDetailDto {
  requireFolder(input.folderId, "exercise");
  const title = normalizeRequiredText(input.title, "title");
  const problemMd = normalizeRequiredMarkdown(input.problemMd, "problemMd");
  const answerMd = normalizeMarkdown(input.answerMd ?? "", "answerMd");
  const solutionMd = normalizeMarkdown(input.solutionMd ?? "", "solutionMd");
  const tags = tagsToJson(input.tags ?? []);
  const knowledgeIds = validateKnowledgeIds(input.knowledgeIds ?? []);
  const noteImagePaths = prepareNewNoteImages(
    [problemMd, answerMd, solutionMd],
    newImagePaths,
  );

  return db.transaction((transaction) => {
    transaction.update(exercises)
      .set({ position: sql`${exercises.position} + 1` })
      .where(eq(exercises.folderId, input.folderId))
      .run();
    const row = transaction
      .insert(exercises)
      .values({
        folderId: input.folderId,
        title,
        problemMd,
        answerMd,
        solutionMd,
        tags,
        position: 0,
      })
      .returning()
      .get();

    insertNoteImages(transaction, "exercise", row.id, noteImagePaths);

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

    replaceSourceNoteLinks(transaction, "exercise", row.id, [
      problemMd,
      answerMd,
      solutionMd,
    ]);
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
  newImagePaths: readonly string[] = [],
  expectedRemovedImagePaths?: readonly string[],
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
    problemMd?: string;
    answerMd?: string;
    solutionMd?: string;
    tags?: string;
    position?: number;
    updatedAt: SQL;
  } = { updatedAt: sql`CURRENT_TIMESTAMP` };
  let hasChanges = newImagePaths.length > 0;
  let relatedKnowledgeIds: number[] | undefined;

  if (
    newImagePaths.length > 0 &&
    input.problemMd === undefined &&
    input.answerMd === undefined &&
    input.solutionMd === undefined
  ) {
    throw new RepositoryError(
      "VALIDATION",
      "problemMd, answerMd, or solutionMd is required when adding images.",
      { field: "problemMd" },
    );
  }

  if (input.folderId !== undefined) {
    requireFolder(input.folderId, "exercise");
    changes.folderId = input.folderId;
    hasChanges = true;
  }

  if (input.title !== undefined) {
    changes.title = normalizeRequiredText(input.title, "title");
    hasChanges = true;
  }

  if (input.problemMd !== undefined) {
    changes.problemMd = normalizeRequiredMarkdown(input.problemMd, "problemMd");
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

  const nextFolderId = input.folderId ?? current.folderId;
  const requestedPosition = input.position === undefined
    ? undefined
    : normalizePosition(input.position);
  const orderPlan = nextFolderId !== current.folderId || requestedPosition !== undefined
    ? planExerciseOrder(current, nextFolderId, requestedPosition)
    : null;
  if (orderPlan !== null) {
    changes.position = orderPlan.position;
    hasChanges = true;
  }

  if (!hasChanges) {
    return getExercise(id)!;
  }

  const preparedImages = prepareNoteImageMutation(
    "exercise",
    id,
    [
      changes.problemMd ?? current.problemMd,
      changes.answerMd ?? current.answerMd,
      changes.solutionMd ?? current.solutionMd,
    ],
    newImagePaths,
    expectedRemovedImagePaths,
  );

  return db.transaction((transaction) => {
    for (const change of orderPlan?.siblings ?? []) {
      transaction.update(exercises)
        .set({ position: change.position })
        .where(eq(exercises.id, change.id))
        .run();
    }
    const row = transaction
      .update(exercises)
      .set(changes)
      .where(eq(exercises.id, id))
      .returning()
      .get();

    applyNoteImageMutation(transaction, "exercise", id, preparedImages);

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
      changes.problemMd ?? current.problemMd,
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

export async function deleteExercise(
  id: number,
  expectedNoteImagePaths?: readonly string[],
): Promise<boolean> {
  assertPositiveId(id, "id");
  assertNoteImageDeletionPrepared("exercise", id, expectedNoteImagePaths);
  const deleted = db.transaction((transaction) => {
    const exercise = transaction
      .select()
      .from(exercises)
      .where(eq(exercises.id, id))
      .get();
    if (!exercise) return null;

    deleteNoteImageRows(transaction, "exercise", id);
    transaction.delete(exercises).where(eq(exercises.id, id)).run();
    normalizeExerciseFolder(exercise.folderId);
    deleteEntityLinks(transaction, "exercise", id, exercise.title);
    return true;
  });

  if (!deleted) return false;
  return true;
}

interface ExerciseOrderPlan {
  position: number;
  siblings: Array<{ id: number; position: number }>;
}

function planExerciseOrder(
  current: ExerciseRow,
  folderId: number,
  requestedPosition: number | undefined,
): ExerciseOrderPlan {
  const sameFolder = current.folderId === folderId;
  const sourceIds = orderedExerciseIds(current.folderId).filter((id) => id !== current.id);
  const targetIds = sameFolder
    ? sourceIds
    : orderedExerciseIds(folderId).filter((id) => id !== current.id);
  const position = Math.min(requestedPosition ?? targetIds.length, targetIds.length);
  const orderedTargetIds = [...targetIds];
  orderedTargetIds.splice(position, 0, current.id);
  return {
    position,
    siblings: [
      ...(sameFolder ? [] : sourceIds.map((id, index) => ({ id, position: index }))),
      ...orderedTargetIds
        .map((id, index) => ({ id, position: index }))
        .filter(({ id }) => id !== current.id),
    ],
  };
}

function orderedExerciseIds(folderId: number): number[] {
  return db.select({ id: exercises.id })
    .from(exercises)
    .where(eq(exercises.folderId, folderId))
    .orderBy(asc(exercises.position), asc(exercises.id))
    .all()
    .map(({ id }) => id);
}

function normalizeExerciseFolder(folderId: number): void {
  for (const [position, id] of orderedExerciseIds(folderId).entries()) {
    db.update(exercises).set({ position }).where(eq(exercises.id, id)).run();
  }
}

function normalizePosition(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RepositoryError("VALIDATION", "position must be a non-negative integer.", {
      field: "position",
    });
  }
  return value;
}

function toExerciseSummary(row: ExerciseRow): ExerciseSummaryDto {
  return {
    id: row.id,
    folderId: row.folderId,
    title: row.title,
    tags: tagsFromJson(row.tags),
    position: row.position,
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
    problemMd: row.problemMd,
    answerMd: row.answerMd,
    solutionMd: row.solutionMd,
    createdAt: row.createdAt,
    relatedKnowledge,
    links,
  };
}
