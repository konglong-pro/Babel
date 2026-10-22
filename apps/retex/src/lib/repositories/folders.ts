import { and, asc, eq, isNull, sql, type SQL } from "drizzle-orm";

import { db, sqlite } from "@/lib/db/client";
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
  position?: number;
}

export function listFolders(type?: FolderType): FolderDto[] {
  if (type !== undefined) {
    assertFolderType(type);
    return db
      .select()
      .from(folders)
      .where(eq(folders.type, type))
      .orderBy(
        asc(folders.parentId),
        asc(folders.position),
        asc(folders.name),
        asc(folders.id),
      )
      .all()
      .map(toFolderDto);
  }

  return db
    .select()
    .from(folders)
    .orderBy(
      asc(folders.type),
      asc(folders.parentId),
      asc(folders.position),
      asc(folders.name),
      asc(folders.id),
    )
    .all()
    .map(toFolderDto);
}

export function createFolder(input: CreateFolderInput): FolderDto {
  assertFolderType(input.type);
  const name = normalizeRequiredText(input.name, "name");
  const parentId = input.parentId ?? null;

  return toFolderDto(sqlite.transaction(() => {
    if (parentId !== null) {
      requireFolder(parentId, input.type);
    }
    normalizeSiblingPositions(input.type, parentId);
    return db
      .insert(folders)
      .values({
        type: input.type,
        name,
        parentId,
        position: orderedSiblingRows(input.type, parentId).length,
      })
      .returning()
      .get();
  })());
}

export function updateFolder(id: number, input: UpdateFolderInput): FolderDto {
  assertPositiveId(id, "id");
  if (input.position !== undefined) assertFolderPosition(input.position);

  return sqlite.transaction(() => {
    const current = findFolder(id);
    if (!current) {
      throw new RepositoryError("NOT_FOUND", "Folder not found.", { folderId: id });
    }
    if (
      input.name === undefined &&
      input.parentId === undefined &&
      input.position === undefined
    ) {
      return toFolderDto(current);
    }

    const parentId = input.parentId === undefined
      ? current.parentId
      : input.parentId ?? null;
    if (input.parentId !== undefined) {
      assertValidMove(id, current.type, parentId);
    }

    const changes: {
      name?: string;
      parentId?: number | null;
      position?: number;
      updatedAt: SQL;
    } = { updatedAt: sql`CURRENT_TIMESTAMP` };
    if (input.name !== undefined) {
      changes.name = normalizeRequiredText(input.name, "name");
    }

    const parentChanged = input.parentId !== undefined && parentId !== current.parentId;
    if (input.parentId !== undefined) {
      changes.parentId = parentId;
    }
    if (parentChanged) {
      normalizeSiblingPositions(current.type, parentId);
      changes.position = orderedSiblingRows(current.type, parentId).length;
    }

    if (input.name !== undefined || input.parentId !== undefined) {
      db.update(folders).set(changes).where(eq(folders.id, id)).run();
    }
    if (parentChanged) {
      normalizeSiblingPositions(current.type, current.parentId);
      normalizeSiblingPositions(current.type, parentId);
    }
    if (input.position !== undefined) {
      reorderFolder(id, input.position);
    }

    return toFolderDto(requireFolder(id));
  })();
}

export function deleteFolder(id: number): boolean {
  assertPositiveId(id, "id");
  return sqlite.transaction(() => {
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

    const deleted = db
      .delete(folders)
      .where(eq(folders.id, id))
      .returning({ id: folders.id })
      .get();
    normalizeSiblingPositions(folder.type, folder.parentId);
    return deleted !== undefined;
  })();
}

function orderedSiblingRows(
  type: FolderType,
  parentId: number | null,
): Array<{ id: number; position: number }> {
  return db
    .select({ id: folders.id, position: folders.position })
    .from(folders)
    .where(folderScopeCondition(type, parentId))
    .orderBy(asc(folders.position), asc(folders.name), asc(folders.id))
    .all();
}

function reorderFolder(id: number, position: number): void {
  const current = requireFolder(id);
  const ordered = orderedSiblingRows(current.type, current.parentId)
    .filter((folder) => folder.id !== id);
  if (position > ordered.length) {
    throw new RepositoryError(
      "VALIDATION",
      "position is outside the folder's sibling range.",
      { field: "position", position },
    );
  }
  ordered.splice(position, 0, { id, position: current.position });

  ordered.forEach((folder, index) => {
    db.update(folders)
      .set(folder.id === id
        ? { position: index, updatedAt: sql`CURRENT_TIMESTAMP` }
        : { position: index })
      .where(eq(folders.id, folder.id))
      .run();
  });
}

function normalizeSiblingPositions(type: FolderType, parentId: number | null): void {
  orderedSiblingRows(type, parentId).forEach((folder, position) => {
    if (folder.position === position) return;
    db.update(folders)
      .set({ position })
      .where(eq(folders.id, folder.id))
      .run();
  });
}

function folderScopeCondition(type: FolderType, parentId: number | null): SQL {
  return and(
    eq(folders.type, type),
    parentId === null ? isNull(folders.parentId) : eq(folders.parentId, parentId),
  )!;
}

function assertFolderPosition(position: number): void {
  if (!Number.isSafeInteger(position) || position < 0) {
    throw new RepositoryError(
      "VALIDATION",
      "position must be a non-negative integer.",
      { field: "position" },
    );
  }
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
