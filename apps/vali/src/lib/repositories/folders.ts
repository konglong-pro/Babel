import { asc, eq, isNull, sql, type SQL } from "drizzle-orm";

import { db, sqlite } from "@/lib/db/client";
import { folders, notes } from "@/lib/db/schema";
import type { FolderDto } from "@/lib/types";

import { RepositoryError } from "./errors";
import {
  assertPositiveId,
  findFolder,
  normalizeRequiredText,
  requireFolder,
  toFolderDto,
} from "./shared";

export interface CreateFolderInput {
  name: string;
  parentId?: number | null;
}

export interface UpdateFolderInput {
  name?: string;
  parentId?: number | null;
  position?: number;
}

export function listFolders(): FolderDto[] {
  return db
    .select()
    .from(folders)
    .orderBy(
      asc(folders.parentId),
      asc(folders.position),
      asc(folders.createdAt),
      asc(folders.id),
    )
    .all()
    .map(toFolderDto);
}

export function getFolder(id: number): FolderDto | null {
  const folder = findFolder(id);
  return folder ? toFolderDto(folder) : null;
}

export function createFolder(input: CreateFolderInput): FolderDto {
  const name = normalizeRequiredText(input.name, "name");
  const parentId = input.parentId ?? null;
  if (parentId !== null) requireFolder(parentId);

  return toFolderDto(sqlite.transaction(() => {
    normalizeSiblingPositions(parentId);
    return db
      .insert(folders)
      .values({ name, parentId, position: siblingRows(parentId).length })
      .returning()
      .get();
  })());
}

export function updateFolder(id: number, input: UpdateFolderInput): FolderDto {
  assertPositiveId(id, "id");
  const current = findFolder(id);
  if (!current) {
    throw new RepositoryError("NOT_FOUND", "Folder not found.", { folderId: id });
  }

  const parentId = input.parentId === undefined ? current.parentId : input.parentId;
  if (input.parentId !== undefined) assertValidMove(id, parentId);
  if (input.position !== undefined) assertFolderPosition(input.position);
  if (
    input.name === undefined &&
    input.parentId === undefined &&
    input.position === undefined
  ) return toFolderDto(current);

  const changes: {
    name?: string;
    parentId?: number | null;
    position?: number;
    updatedAt: SQL;
  } = { updatedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))` };

  if (input.name !== undefined) {
    changes.name = normalizeRequiredText(input.name, "name");
  }
  if (input.parentId !== undefined) {
    changes.parentId = parentId;
  }
  const parentChanged = input.parentId !== undefined && parentId !== current.parentId;

  return toFolderDto(sqlite.transaction(() => {
    if (parentChanged) {
      normalizeSiblingPositions(parentId);
      changes.position = siblingRows(parentId).length;
    }
    if (input.name !== undefined || input.parentId !== undefined) {
      db.update(folders).set(changes).where(eq(folders.id, id)).run();
    }
    if (parentChanged) normalizeSiblingPositions(current.parentId);
    if (input.position !== undefined) reorderFolder(id, input.position);
    return requireFolder(id);
  })());
}

function siblingRows(parentId: number | null): Array<{ id: number; position: number }> {
  return db
    .select({ id: folders.id, position: folders.position })
    .from(folders)
    .where(folderParentCondition(parentId))
    .orderBy(asc(folders.position), asc(folders.createdAt), asc(folders.id))
    .all();
}

function reorderFolder(id: number, position: number): void {
  const current = requireFolder(id);
  const ordered = siblingRows(current.parentId).filter((folder) => folder.id !== id);
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
        ? { position: index, updatedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))` }
        : { position: index })
      .where(eq(folders.id, folder.id))
      .run();
  });
}

function normalizeSiblingPositions(parentId: number | null): void {
  siblingRows(parentId).forEach((folder, position) => {
    if (folder.position === position) return;
    db.update(folders).set({ position }).where(eq(folders.id, folder.id)).run();
  });
}

function folderParentCondition(parentId: number | null): SQL {
  return parentId === null ? isNull(folders.parentId) : eq(folders.parentId, parentId);
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

export function deleteFolder(id: number): boolean {
  assertPositiveId(id, "id");
  const current = findFolder(id);
  if (!current) return false;

  const child = db
    .select({ id: folders.id })
    .from(folders)
    .where(eq(folders.parentId, id))
    .get();
  const note = db
    .select({ id: notes.id })
    .from(notes)
    .where(eq(notes.folderId, id))
    .get();
  if (child || note) {
    throw new RepositoryError("NOT_EMPTY", "Non-empty folders cannot be deleted.", {
      folderId: id,
    });
  }

  return sqlite.transaction(() => {
    const deleted = db.delete(folders).where(eq(folders.id, id)).returning().get();
    normalizeSiblingPositions(current.parentId);
    return deleted !== undefined;
  })();
}

function assertValidMove(folderId: number, parentId: number | null): void {
  if (parentId === null) return;
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
        { folderId, parentId },
      );
    }
    visited.add(cursor);
    cursor = requireFolder(cursor).parentId;
  }
}
