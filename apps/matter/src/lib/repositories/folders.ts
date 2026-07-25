import { asc, eq, sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { exercises, folders, knowledgeNotes } from "@/lib/db/schema";
import type { FolderDto, FolderType } from "@/lib/types";

import { RepositoryError } from "./errors";
import {
  assertFolderType,
  assertPositiveId,
  findFolder,
  normalizeRequiredText,
  requireFolder,
  toFolderDto,
} from "./shared";

export interface CreateFolderInput {
  type: FolderType;
  name: string;
  parentId?: number | null;
}

export interface UpdateFolderInput {
  name?: string;
  parentId?: number | null;
}

export function listFolders(type?: FolderType): FolderDto[] {
  if (type !== undefined) {
    assertFolderType(type);
    return db
      .select()
      .from(folders)
      .where(eq(folders.type, type))
      .orderBy(asc(folders.parentId), asc(folders.name), asc(folders.id))
      .all()
      .map(toFolderDto);
  }

  return db
    .select()
    .from(folders)
    .orderBy(asc(folders.type), asc(folders.parentId), asc(folders.name), asc(folders.id))
    .all()
    .map(toFolderDto);
}

export function createFolder(input: CreateFolderInput): FolderDto {
  assertFolderType(input.type);
  const name = normalizeRequiredText(input.name, "name");
  const parentId = input.parentId ?? null;

  if (parentId !== null) {
    requireFolder(parentId, input.type);
  }

  const folder = db
    .insert(folders)
    .values({ type: input.type, name, parentId })
    .returning()
    .get();

  return toFolderDto(folder);
}

export function updateFolder(id: number, input: UpdateFolderInput): FolderDto {
  assertPositiveId(id, "id");
  const current = findFolder(id);
  if (!current) {
    throw new RepositoryError("NOT_FOUND", "Folder not found.", { folderId: id });
  }

  const changes: {
    name?: string;
    parentId?: number | null;
    updatedAt: SQL;
  } = { updatedAt: sql`CURRENT_TIMESTAMP` };
  let hasChanges = false;

  if (input.name !== undefined) {
    changes.name = normalizeRequiredText(input.name, "name");
    hasChanges = true;
  }

  if (input.parentId !== undefined) {
    const parentId = input.parentId ?? null;
    assertValidMove(id, current.type, parentId);
    changes.parentId = parentId;
    hasChanges = true;
  }

  if (!hasChanges) {
    return toFolderDto(current);
  }

  const updated = db
    .update(folders)
    .set(changes)
    .where(eq(folders.id, id))
    .returning()
    .get();

  return toFolderDto(updated);
}

export function deleteFolder(id: number): boolean {
  assertPositiveId(id, "id");
  const folder = findFolder(id);
  if (!folder) {
    return false;
  }

  const child = db
    .select({ id: folders.id })
    .from(folders)
    .where(eq(folders.parentId, id))
    .get();
  const knowledge = db
    .select({ id: knowledgeNotes.id })
    .from(knowledgeNotes)
    .where(eq(knowledgeNotes.folderId, id))
    .get();
  const exercise = db
    .select({ id: exercises.id })
    .from(exercises)
    .where(eq(exercises.folderId, id))
    .get();

  if (child || knowledge || exercise) {
    throw new RepositoryError("NOT_EMPTY", "Non-empty folders cannot be deleted.", {
      folderId: id,
    });
  }

  return (
    db
      .delete(folders)
      .where(eq(folders.id, id))
      .returning({ id: folders.id })
      .get() !== undefined
  );
}

function assertValidMove(
  folderId: number,
  type: FolderType,
  parentId: number | null,
): void {
  if (parentId === null) {
    return;
  }

  if (parentId === folderId) {
    throw new RepositoryError("CONFLICT", "A folder cannot be moved inside itself.", {
      folderId,
      parentId,
    });
  }

  const visited = new Set<number>();
  let cursor: number | null = parentId;

  while (cursor !== null) {
    if (cursor === folderId) {
      throw new RepositoryError("CONFLICT", "Moving this folder would create a cycle.", {
        folderId,
        parentId,
      });
    }

    if (visited.has(cursor)) {
      throw new RepositoryError(
        "CONFLICT",
        "The existing folder hierarchy contains a cycle.",
        {
        folderId,
        parentId,
        },
      );
    }

    visited.add(cursor);
    const folder = requireFolder(cursor, type);
    cursor = folder.parentId;
  }
}
