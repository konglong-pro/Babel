import { asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { knowledgeExercises, knowledgeNotes } from "@/lib/db/schema";
import type {
  KnowledgeDetailDto,
  KnowledgeSummaryDto,
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
  type PreparedNoteImageMutation,
} from "./note-images";
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
  parentId?: number | null;
  title: string;
  contentMd?: string;
  tags?: readonly string[];
  exerciseIds?: readonly number[];
}

export interface UpdateKnowledgeInput {
  folderId?: number;
  parentId?: number | null;
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

  return toKnowledgeDetail(
    knowledge,
    listKnowledgeExercises(knowledge.id),
    listOutgoingNoteLinks("knowledge", knowledge.id),
  );
}

export function createKnowledge(
  input: CreateKnowledgeInput,
  newImagePaths: readonly string[] = [],
): KnowledgeDetailDto {
  requireFolder(input.folderId, "knowledge");
  const parentId = input.parentId ?? null;
  if (parentId !== null) {
    requireKnowledgeParent(parentId, input.folderId);
  }
  const title = normalizeRequiredText(input.title, "title");
  const contentMd = normalizeMarkdown(input.contentMd ?? "", "contentMd");
  const tags = tagsToJson(input.tags ?? []);
  const exerciseIds = validateExerciseIds(input.exerciseIds ?? []);
  const preparedImagePaths = prepareNewNoteImages([contentMd], newImagePaths);

  return db.transaction((transaction) => {
    const row = transaction
      .insert(knowledgeNotes)
      .values({ folderId: input.folderId, parentId, title, contentMd, tags })
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

    insertNoteImages(transaction, "knowledge", row.id, preparedImagePaths);
    replaceSourceNoteLinks(transaction, "knowledge", row.id, [contentMd]);
    resolveIncomingLinksForTitle(transaction, title);
    return toKnowledgeDetail(
      row,
      listKnowledgeExercises(row.id, transaction),
      listOutgoingNoteLinks("knowledge", row.id, transaction),
    );
  });
}

export function updateKnowledge(
  id: number,
  input: UpdateKnowledgeInput,
  newImagePaths: readonly string[] = [],
  expectedRemovedImagePaths?: readonly string[],
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
    parentId?: number | null;
    title?: string;
    contentMd?: string;
    tags?: string;
    updatedAt: SQL;
  } = { updatedAt: sql`CURRENT_TIMESTAMP` };
  let hasChanges = false;
  let relatedExerciseIds: number[] | undefined;
  let preparedImageMutation: PreparedNoteImageMutation | undefined;
  const nextFolderId = input.folderId ?? current.folderId;
  const folderChanged = nextFolderId !== current.folderId;
  const nextParentId =
    input.parentId !== undefined
      ? input.parentId
      : folderChanged
        ? null
        : current.parentId;

  if (newImagePaths.length > 0 && input.contentMd === undefined) {
    throw new RepositoryError(
      "VALIDATION",
      "contentMd is required when adding images.",
      { field: "contentMd" },
    );
  }

  if (input.folderId !== undefined) {
    requireFolder(input.folderId, "knowledge");
    changes.folderId = input.folderId;
    hasChanges = true;
  }

  if (input.parentId !== undefined || (folderChanged && current.parentId !== null)) {
    assertValidKnowledgeParent(id, nextParentId, nextFolderId);
    changes.parentId = nextParentId;
    hasChanges = true;
  } else if (nextParentId !== null) {
    requireKnowledgeParent(nextParentId, nextFolderId);
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

  if (
    input.contentMd !== undefined ||
    newImagePaths.length > 0 ||
    expectedRemovedImagePaths !== undefined
  ) {
    preparedImageMutation = prepareNoteImageMutation(
      "knowledge",
      id,
      [changes.contentMd ?? current.contentMd],
      newImagePaths,
      expectedRemovedImagePaths,
    );
    if (
      preparedImageMutation.newImagePaths.length > 0 ||
      preparedImageMutation.removedImagePaths.length > 0
    ) {
      hasChanges = true;
    }
  }

  if (!hasChanges) {
    return getKnowledge(id)!;
  }

  const descendantIdsToMove = folderChanged
    ? knowledgeDescendantIds(id).filter((knowledgeId) => knowledgeId !== id)
    : [];
  return db.transaction((transaction) => {
    if (descendantIdsToMove.length > 0) {
      transaction
        .update(knowledgeNotes)
        .set({ folderId: nextFolderId, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(inArray(knowledgeNotes.id, descendantIdsToMove))
        .run();
    }

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

    if (preparedImageMutation !== undefined) {
      applyNoteImageMutation(transaction, "knowledge", id, preparedImageMutation);
    }
    replaceSourceNoteLinks(transaction, "knowledge", id, [
      changes.contentMd ?? current.contentMd,
    ]);
    if (changes.title !== undefined) {
      reconcileNoteTitleChange(
        transaction,
        "knowledge",
        id,
        current.title,
        changes.title,
      );
    }
    return toKnowledgeDetail(
      row,
      listKnowledgeExercises(id, transaction),
      listOutgoingNoteLinks("knowledge", id, transaction),
    );
  });
}

export function deleteKnowledge(
  id: number,
  expectedImagePaths?: readonly string[],
): boolean {
  assertPositiveId(id, "id");
  assertNoteImageDeletionPrepared("knowledge", id, expectedImagePaths);
  return db.transaction((transaction) => {
    const current = transaction
      .select({ id: knowledgeNotes.id, title: knowledgeNotes.title })
      .from(knowledgeNotes)
      .where(eq(knowledgeNotes.id, id))
      .get();
    if (!current) return false;
    const child = transaction
      .select({ id: knowledgeNotes.id })
      .from(knowledgeNotes)
      .where(eq(knowledgeNotes.parentId, id))
      .get();
    if (child) {
      throw new RepositoryError(
        "NOT_EMPTY",
        "Knowledge notes with child pages cannot be deleted.",
        { knowledgeId: id },
      );
    }
    const deleted = transaction
      .delete(knowledgeNotes)
      .where(eq(knowledgeNotes.id, id))
      .returning({ id: knowledgeNotes.id })
      .get();
    if (!deleted) return false;
    deleteNoteImageRows(transaction, "knowledge", id);
    deleteEntityLinks(transaction, "knowledge", id, current.title);
    return true;
  });
}

function toKnowledgeSummary(row: KnowledgeRow): KnowledgeSummaryDto {
  return {
    id: row.id,
    parentId: row.parentId,
    folderId: row.folderId,
    title: row.title,
    tags: tagsFromJson(row.tags),
    updatedAt: row.updatedAt,
  };
}

function requireKnowledgeParent(parentId: number, folderId: number): KnowledgeRow {
  assertPositiveId(parentId, "parentId");
  const parent = db
    .select()
    .from(knowledgeNotes)
    .where(eq(knowledgeNotes.id, parentId))
    .get();
  if (!parent) {
    throw new RepositoryError("NOT_FOUND", "Parent knowledge note not found.", { parentId });
  }
  if (parent.folderId !== folderId) {
    throw new RepositoryError(
      "VALIDATION",
      "Parent and child knowledge notes must be in the same folder.",
      { parentId, folderId, parentFolderId: parent.folderId },
    );
  }
  return parent;
}

function assertValidKnowledgeParent(
  knowledgeId: number,
  parentId: number | null,
  folderId: number,
): void {
  if (parentId === null) return;
  if (parentId === knowledgeId) {
    throw new RepositoryError("CONFLICT", "A knowledge note cannot be its own parent.", {
      knowledgeId,
      parentId,
    });
  }

  const visited = new Set<number>();
  let cursor: number | null = parentId;
  let parent: KnowledgeRow | null = null;
  while (cursor !== null) {
    if (cursor === knowledgeId) {
      throw new RepositoryError("CONFLICT", "Moving this knowledge note would create a cycle.", {
        knowledgeId,
        parentId,
      });
    }
    if (visited.has(cursor)) {
      throw new RepositoryError("CONFLICT", "The existing knowledge hierarchy contains a cycle.", {
        knowledgeId,
        parentId,
      });
    }
    visited.add(cursor);
    const current = db
      .select()
      .from(knowledgeNotes)
      .where(eq(knowledgeNotes.id, cursor))
      .get();
    if (!current) {
      throw new RepositoryError("NOT_FOUND", "Parent knowledge note not found.", { parentId });
    }
    parent ??= current;
    cursor = current.parentId;
  }

  if (parent && parent.folderId !== folderId) {
    throw new RepositoryError(
      "VALIDATION",
      "Parent and child knowledge notes must be in the same folder.",
      { parentId, folderId, parentFolderId: parent.folderId },
    );
  }
}

function knowledgeDescendantIds(knowledgeId: number): number[] {
  const rows = db
    .select({ id: knowledgeNotes.id, parentId: knowledgeNotes.parentId })
    .from(knowledgeNotes)
    .all();
  const grouped = new Map<number, number[]>();
  for (const row of rows) {
    if (row.parentId === null) continue;
    const children = grouped.get(row.parentId) ?? [];
    children.push(row.id);
    grouped.set(row.parentId, children);
  }

  const result: number[] = [];
  const visited = new Set<number>();
  const stack = [knowledgeId];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined || visited.has(current)) continue;
    visited.add(current);
    result.push(current);
    stack.push(...(grouped.get(current) ?? []));
  }
  return result;
}

function toKnowledgeDetail(
  row: KnowledgeRow,
  relatedExercises: KnowledgeDetailDto["relatedExercises"],
  links: KnowledgeDetailDto["links"],
): KnowledgeDetailDto {
  return {
    ...toKnowledgeSummary(row),
    contentMd: row.contentMd,
    createdAt: row.createdAt,
    relatedExercises,
    links,
  };
}
