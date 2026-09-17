import { eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { exercises, knowledgeNotes } from "@/lib/db/schema";

import { RepositoryError } from "./errors";
import { assertPositiveId } from "./shared";

export function validateExerciseIds(values: readonly number[]): number[] {
  const ids = normalizeIdList(values, "exerciseIds");
  if (ids.length === 0) {
    return ids;
  }

  const existing = new Set(
    db
      .select({ id: exercises.id })
      .from(exercises)
      .where(inArray(exercises.id, ids))
      .all()
      .map((item) => item.id),
  );
  const missing = ids.filter((id) => !existing.has(id));
  if (missing.length > 0) {
    throw new RepositoryError("NOT_FOUND", "Some linked exercises were not found.", {
      exerciseIds: missing,
    });
  }

  return ids;
}

export function validateKnowledgeIds(values: readonly number[]): number[] {
  const ids = normalizeIdList(values, "knowledgeIds");
  if (ids.length === 0) {
    return ids;
  }

  const existing = new Set(
    db
      .select({ id: knowledgeNotes.id })
      .from(knowledgeNotes)
      .where(inArray(knowledgeNotes.id, ids))
      .all()
      .map((item) => item.id),
  );
  const missing = ids.filter((id) => !existing.has(id));
  if (missing.length > 0) {
    throw new RepositoryError(
      "NOT_FOUND",
      "Some linked Knowledge notes were not found.",
      {
      knowledgeIds: missing,
      },
    );
  }

  return ids;
}

export function knowledgeExists(id: number): boolean {
  assertPositiveId(id, "knowledgeId");
  return Boolean(
    db
      .select({ id: knowledgeNotes.id })
      .from(knowledgeNotes)
      .where(eq(knowledgeNotes.id, id))
      .get(),
  );
}

export function exerciseExists(id: number): boolean {
  assertPositiveId(id, "exerciseId");
  return Boolean(
    db
      .select({ id: exercises.id })
      .from(exercises)
      .where(eq(exercises.id, id))
      .get(),
  );
}

function normalizeIdList(values: readonly number[], label: string): number[] {
  if (!Array.isArray(values)) {
    throw new RepositoryError("VALIDATION", `${label} must be an array.`, {
      field: label,
    });
  }

  const normalized: number[] = [];
  const seen = new Set<number>();

  for (const value of values) {
    assertPositiveId(value, label);
    if (!seen.has(value)) {
      seen.add(value);
      normalized.push(value);
    }
  }

  return normalized;
}
