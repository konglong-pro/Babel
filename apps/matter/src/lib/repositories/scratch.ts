import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { exercises, scratchSolutions } from "@/lib/db/schema";
import type { ScratchSolutionDto } from "@/lib/types";

import { RepositoryError } from "./errors";
import { assertPositiveId, normalizeMarkdown } from "./shared";

export function getScratch(exerciseId: number): ScratchSolutionDto | null {
  assertPositiveId(exerciseId, "exerciseId");
  return (
    db
      .select()
      .from(scratchSolutions)
      .where(eq(scratchSolutions.exerciseId, exerciseId))
      .get() ?? null
  );
}

export function upsertScratch(
  exerciseId: number,
  contentMd: string,
): ScratchSolutionDto {
  assertPositiveId(exerciseId, "exerciseId");
  const exercise = db
    .select({ id: exercises.id })
    .from(exercises)
    .where(eq(exercises.id, exerciseId))
    .get();

  if (!exercise) {
    throw new RepositoryError("NOT_FOUND", "Exercise not found.", { exerciseId });
  }

  const content = normalizeMarkdown(contentMd, "contentMd");
  return db
    .insert(scratchSolutions)
    .values({ exerciseId, contentMd: content })
    .onConflictDoUpdate({
      target: scratchSolutions.exerciseId,
      set: { contentMd: content, updatedAt: sql`CURRENT_TIMESTAMP` },
    })
    .returning()
    .get();
}

export function deleteScratch(exerciseId: number): boolean {
  assertPositiveId(exerciseId, "exerciseId");
  return (
    db
      .delete(scratchSolutions)
      .where(eq(scratchSolutions.exerciseId, exerciseId))
      .returning({ id: scratchSolutions.id })
      .get() !== undefined
  );
}
