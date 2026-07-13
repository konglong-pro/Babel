import { and, asc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  exercises,
  knowledgeExercises,
  knowledgeNotes,
} from "@/lib/db/schema";
import type { RelatedItemDto } from "@/lib/types";

import { RepositoryError } from "./errors";
import type { NoteLinkTransaction } from "./links";
import {
  exerciseExists,
  knowledgeExists,
  validateExerciseIds,
  validateKnowledgeIds,
} from "./relation-validation";
import { assertPositiveId } from "./shared";

export function listKnowledgeExercises(
  knowledgeId: number,
  transaction?: NoteLinkTransaction,
): RelatedItemDto[] {
  requireKnowledge(knowledgeId, transaction);

  return (transaction ?? db)
    .select({ id: exercises.id, title: exercises.title })
    .from(knowledgeExercises)
    .innerJoin(exercises, eq(knowledgeExercises.exerciseId, exercises.id))
    .where(eq(knowledgeExercises.knowledgeId, knowledgeId))
    .orderBy(asc(exercises.title), asc(exercises.id))
    .all();
}

export function listExerciseKnowledge(
  exerciseId: number,
  transaction?: NoteLinkTransaction,
): RelatedItemDto[] {
  requireExercise(exerciseId, transaction);

  return (transaction ?? db)
    .select({ id: knowledgeNotes.id, title: knowledgeNotes.title })
    .from(knowledgeExercises)
    .innerJoin(
      knowledgeNotes,
      eq(knowledgeExercises.knowledgeId, knowledgeNotes.id),
    )
    .where(eq(knowledgeExercises.exerciseId, exerciseId))
    .orderBy(asc(knowledgeNotes.title), asc(knowledgeNotes.id))
    .all();
}

export function setKnowledgeExercises(
  knowledgeId: number,
  exerciseIds: readonly number[],
): RelatedItemDto[] {
  requireKnowledge(knowledgeId);
  const normalizedIds = validateExerciseIds(exerciseIds);

  db.transaction((transaction) => {
    transaction
      .delete(knowledgeExercises)
      .where(eq(knowledgeExercises.knowledgeId, knowledgeId))
      .run();

    if (normalizedIds.length > 0) {
      transaction
        .insert(knowledgeExercises)
        .values(
          normalizedIds.map((exerciseId) => ({ knowledgeId, exerciseId })),
        )
        .run();
    }
  });

  return listKnowledgeExercises(knowledgeId);
}

export function setExerciseKnowledge(
  exerciseId: number,
  knowledgeIds: readonly number[],
): RelatedItemDto[] {
  requireExercise(exerciseId);
  const normalizedIds = validateKnowledgeIds(knowledgeIds);

  db.transaction((transaction) => {
    transaction
      .delete(knowledgeExercises)
      .where(eq(knowledgeExercises.exerciseId, exerciseId))
      .run();

    if (normalizedIds.length > 0) {
      transaction
        .insert(knowledgeExercises)
        .values(
          normalizedIds.map((knowledgeId) => ({ knowledgeId, exerciseId })),
        )
        .run();
    }
  });

  return listExerciseKnowledge(exerciseId);
}

export function linkKnowledgeExercise(
  knowledgeId: number,
  exerciseId: number,
): boolean {
  requireKnowledge(knowledgeId);
  requireExercise(exerciseId);

  const result = db
    .insert(knowledgeExercises)
    .values({ knowledgeId, exerciseId })
    .onConflictDoNothing()
    .run();

  return result.changes > 0;
}

export function unlinkKnowledgeExercise(
  knowledgeId: number,
  exerciseId: number,
): boolean {
  assertPositiveId(knowledgeId, "knowledgeId");
  assertPositiveId(exerciseId, "exerciseId");

  const result = db
    .delete(knowledgeExercises)
    .where(
      and(
        eq(knowledgeExercises.knowledgeId, knowledgeId),
        eq(knowledgeExercises.exerciseId, exerciseId),
      ),
    )
    .run();

  return result.changes > 0;
}

function requireKnowledge(
  knowledgeId: number,
  transaction?: NoteLinkTransaction,
): void {
  if (transaction === undefined ? !knowledgeExists(knowledgeId) : !transaction
    .select({ id: knowledgeNotes.id })
    .from(knowledgeNotes)
    .where(eq(knowledgeNotes.id, knowledgeId))
    .get()) {
    throw new RepositoryError("NOT_FOUND", "Knowledge note not found.", { knowledgeId });
  }
}

function requireExercise(
  exerciseId: number,
  transaction?: NoteLinkTransaction,
): void {
  if (transaction === undefined ? !exerciseExists(exerciseId) : !transaction
    .select({ id: exercises.id })
    .from(exercises)
    .where(eq(exercises.id, exerciseId))
    .get()) {
    throw new RepositoryError("NOT_FOUND", "Exercise not found.", { exerciseId });
  }
}
