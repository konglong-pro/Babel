import { asc, eq, sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db/client";
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
}

export function listFolders(): FolderDto[] {
  return db
    .select()
    .from(folders)
    .orderBy(asc(folders.createdAt), asc(folders.id))
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

  return toFolderDto(
    db.insert(folders).values({ name, parentId }).returning().get(),
  );
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
  } = { updatedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))` };
  let changed = false;

  if (input.name !== undefined) {
    changes.name = normalizeRequiredText(input.name, "name");
    changed = true;
  }
  if (input.parentId !== undefined) {
    const parentId = input.parentId ?? null;
    assertValidMove(id, parentId);
    changes.parentId = parentId;
    changed = true;
  }

  if (!changed) return toFolderDto(current);
  return toFolderDto(
    db.update(folders).set(changes).where(eq(folders.id, id)).returning().get(),
  );
}

export function deleteFolder(id: number): boolean {
  assertPositiveId(id, "id");
  if (!findFolder(id)) return false;

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

  return db.delete(folders).where(eq(folders.id, id)).returning().get() !== undefined;
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
