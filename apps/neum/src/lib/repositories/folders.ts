import { and, asc, eq, isNull, ne, type SQL } from "drizzle-orm";

import { getNeumDatabase } from "@/lib/db/client";
import { entries, folders, trashEntries } from "@/lib/db/schema";
import { identityKey } from "@/lib/identity";
import type { FolderDto } from "@/lib/types";

import { RepositoryError } from "./errors";
import {
  assertPositiveId,
  findFolder,
  isSqliteConstraint,
  normalizeRequiredText,
  nowSql,
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
  const { db } = getNeumDatabase();
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
  const { db, sqlite } = getNeumDatabase();
  const name = normalizeRequiredText(input.name, "name");
  const parentId = input.parentId ?? null;
  if (parentId !== null) requireFolder(parentId);
  assertSiblingNameAvailable(name, parentId);
  try {
    return toFolderDto(sqlite.transaction(() => {
      normalizeSiblingPositions(parentId);
      return db
        .insert(folders)
        .values({
          name,
          nameKey: identityKey(name),
          parentId,
          position: siblingRows(parentId).length,
        })
        .returning()
        .get();
    })());
  } catch (error) {
    throw translateFolderConstraint(error, name, parentId);
  }
}

export function updateFolder(id: number, input: UpdateFolderInput): FolderDto {
  const { db, sqlite } = getNeumDatabase();
  assertPositiveId(id, "id");
  const current = findFolder(id);
  if (!current) {
    throw new RepositoryError("NOT_FOUND", "Folder not found.", { folderId: id });
  }

  const name =
    input.name === undefined
      ? current.name
      : normalizeRequiredText(input.name, "name");
  const parentId = input.parentId === undefined ? current.parentId : input.parentId;
  if (input.parentId !== undefined) assertValidMove(id, parentId);
  if (input.position !== undefined) assertFolderPosition(input.position);
  if (
    input.name === undefined &&
    input.parentId === undefined &&
    input.position === undefined
  ) return toFolderDto(current);
  assertSiblingNameAvailable(name, parentId, id);

  const changes: {
    name?: string;
    nameKey?: string;
    parentId?: number | null;
    position?: number;
    updatedAt: SQL;
  } = {
    updatedAt: nowSql,
  };
  if (input.name !== undefined) {
    changes.name = name;
    changes.nameKey = identityKey(name);
  }
  const parentChanged = input.parentId !== undefined && parentId !== current.parentId;
  if (input.parentId !== undefined) {
    changes.parentId = parentId;
  }

  try {
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
  } catch (error) {
    throw translateFolderConstraint(error, name, parentId);
  }
}

function siblingRows(parentId: number | null): Array<{ id: number; position: number }> {
  const { db } = getNeumDatabase();
  return db
    .select({ id: folders.id, position: folders.position })
    .from(folders)
    .where(folderParentCondition(parentId))
    .orderBy(asc(folders.position), asc(folders.createdAt), asc(folders.id))
    .all();
}

function reorderFolder(id: number, position: number): void {
  const { db } = getNeumDatabase();
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
        ? { position: index, updatedAt: nowSql }
        : { position: index })
      .where(eq(folders.id, folder.id))
      .run();
  });
}

function normalizeSiblingPositions(parentId: number | null): void {
  const { db } = getNeumDatabase();
  siblingRows(parentId).forEach((folder, position) => {
    if (folder.position === position) return;
    db.update(folders)
      .set({ position })
      .where(eq(folders.id, folder.id))
      .run();
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
  const { db, sqlite } = getNeumDatabase();
  assertPositiveId(id, "id");
  const current = findFolder(id);
  if (!current) return false;

  const hasChild = db
    .select({ id: folders.id })
    .from(folders)
    .where(eq(folders.parentId, id))
    .get();
  const hasEntry = db
    .select({ id: entries.id })
    .from(entries)
    .where(eq(entries.folderId, id))
    .get();
  const hasTrash = db
    .select({ id: trashEntries.id })
    .from(trashEntries)
    .where(eq(trashEntries.folderId, id))
    .get();
  if (hasTrash) {
    throw new RepositoryError(
      "NOT_EMPTY",
      "Folders with preserved historical records cannot be deleted.",
      { folderId: id },
    );
  }
  if (hasChild || hasEntry) {
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

function assertSiblingNameAvailable(
  name: string,
  parentId: number | null,
  exceptId?: number,
): void {
  const { db } = getNeumDatabase();
  const parentCondition =
    parentId === null ? isNull(folders.parentId) : eq(folders.parentId, parentId);
  const conditions = [parentCondition, eq(folders.nameKey, identityKey(name))];
  if (exceptId !== undefined) conditions.push(ne(folders.id, exceptId));
  const duplicate = db
    .select({ id: folders.id })
    .from(folders)
    .where(and(...conditions))
    .get();
  if (duplicate) throw duplicateNameError(name, parentId);
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

function duplicateNameError(name: string, parentId: number | null): RepositoryError {
  return new RepositoryError(
    "CONFLICT",
    "A folder with this name already exists at the same level.",
    { name, parentId },
  );
}

function translateFolderConstraint(
  error: unknown,
  name: string,
  parentId: number | null,
): Error {
  return isSqliteConstraint(error) ? duplicateNameError(name, parentId) : asError(error);
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error("Folder mutation failed.");
}
