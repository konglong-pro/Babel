import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { folders, noteImages, notes } from "@/lib/db/schema";
import { managedImagePathsInMarkdown, normalizeStoredNoteImagePath } from "@/lib/storage";
import type { NoteDetailDto, NoteSummaryDto } from "@/lib/types";

import { RepositoryError } from "./errors";
import {
  assertPositiveId,
  normalizeMarkdown,
  normalizeRequiredText,
  requireFolder,
  tagsFromJson,
  tagsToJson,
} from "./shared";

type NoteRow = typeof notes.$inferSelect;

export interface CreateNoteInput {
  folderId: number;
  parentId?: number | null;
  title: string;
  contentMd?: string;
  tags?: readonly string[];
}

export interface UpdateNoteInput {
  folderId?: number;
  parentId?: number | null;
  title?: string;
  contentMd?: string;
  tags?: readonly string[];
}

export interface UpdatedNoteResult {
  note: NoteDetailDto;
  removedImagePaths: string[];
}

export interface DeletedNoteResult {
  imagePaths: string[];
}

export function listNotes(folderId?: number): NoteSummaryDto[] {
  if (folderId === undefined) {
    return db
      .select()
      .from(notes)
      .orderBy(desc(notes.updatedAt), desc(notes.id))
      .all()
      .map(toNoteSummary);
  }

  requireFolder(folderId);
  const folderRows = db
    .select({ id: folders.id, parentId: folders.parentId })
    .from(folders)
    .all();
  const descendants = new Set<number>([folderId]);
  let added = true;
  while (added) {
    added = false;
    for (const folder of folderRows) {
      if (
        folder.parentId !== null &&
        descendants.has(folder.parentId) &&
        !descendants.has(folder.id)
      ) {
        descendants.add(folder.id);
        added = true;
      }
    }
  }

  return db
    .select()
    .from(notes)
    .where(inArray(notes.folderId, [...descendants]))
    .orderBy(desc(notes.updatedAt), desc(notes.id))
    .all()
    .map(toNoteSummary);
}

export function getNote(id: number): NoteDetailDto | null {
  assertPositiveId(id, "id");
  const row = db.select().from(notes).where(eq(notes.id, id)).get();
  return row ? toNoteDetail(row) : null;
}

export function listNoteImagePaths(noteId: number): string[] {
  assertPositiveId(noteId, "noteId");
  return db
    .select({ imagePath: noteImages.imagePath })
    .from(noteImages)
    .where(eq(noteImages.noteId, noteId))
    .all()
    .map(({ imagePath }) => imagePath);
}

export function createNote(
  input: CreateNoteInput,
  newImagePaths: readonly string[] = [],
): NoteDetailDto {
  requireFolder(input.folderId);
  const parentId = input.parentId ?? null;
  assertNoteParent(parentId, input.folderId);
  const title = normalizeRequiredText(input.title, "title");
  const contentMd = normalizeMarkdown(input.contentMd ?? "", "contentMd");
  const tags = tagsToJson(input.tags ?? []);
  const imagePaths = normalizeNewImagePaths(newImagePaths);
  assertManagedImageOwnership(contentMd, [], imagePaths);

  const row = db.transaction((transaction) => {
    const inserted = transaction
      .insert(notes)
      .values({ folderId: input.folderId, parentId, title, contentMd, tags })
      .returning()
      .get();
    if (imagePaths.length > 0) {
      transaction
        .insert(noteImages)
        .values(imagePaths.map((imagePath) => ({ noteId: inserted.id, imagePath })))
        .run();
    }
    return inserted;
  });

  return toNoteDetail(row);
}

export function updateNote(
  id: number,
  input: UpdateNoteInput,
  newImagePaths: readonly string[] = [],
  expectedRemovedImagePaths?: readonly string[],
): UpdatedNoteResult {
  assertPositiveId(id, "id");
  const current = db.select().from(notes).where(eq(notes.id, id)).get();
  if (!current) {
    throw new RepositoryError("NOT_FOUND", "Note not found.", { noteId: id });
  }

  const imagePaths = normalizeNewImagePaths(newImagePaths);
  if (imagePaths.length > 0 && input.contentMd === undefined) {
    throw new RepositoryError(
      "VALIDATION",
      "contentMd is required when adding images.",
      { field: "contentMd" },
    );
  }

  const changes: {
    folderId?: number;
    parentId?: number | null;
    title?: string;
    contentMd?: string;
    tags?: string;
    updatedAt: SQL;
  } = { updatedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))` };
  let changed = imagePaths.length > 0;
  const folderChanged = input.folderId !== undefined && input.folderId !== current.folderId;
  if (input.folderId !== undefined) {
    requireFolder(input.folderId);
    changes.folderId = input.folderId;
    changed = true;
  }
  const parentChanged = Object.prototype.hasOwnProperty.call(input, "parentId");
  const nextParentId = parentChanged
    ? input.parentId ?? null
    : folderChanged
      ? null
      : current.parentId;
  if (parentChanged || folderChanged) {
    assertNoteParent(nextParentId, input.folderId ?? current.folderId, id);
    changes.parentId = nextParentId;
    changed = true;
  }
  if (input.title !== undefined) {
    changes.title = normalizeRequiredText(input.title, "title");
    changed = true;
  }
  if (input.contentMd !== undefined) {
    changes.contentMd = normalizeMarkdown(input.contentMd, "contentMd");
    changed = true;
  }
  if (input.tags !== undefined) {
    changes.tags = tagsToJson(input.tags);
    changed = true;
  }
  if (!changed) return { note: toNoteDetail(current), removedImagePaths: [] };

  const ownedImagePaths = listNoteImagePaths(id);
  const contentMd = changes.contentMd ?? current.contentMd;
  const referencedImagePaths = assertManagedImageOwnership(
    contentMd,
    ownedImagePaths,
    imagePaths,
  );
  const removedImagePaths = ownedImagePaths.filter(
    (imagePath) => !referencedImagePaths.has(imagePath),
  );
  assertPreparedImageRemoval(removedImagePaths, expectedRemovedImagePaths);
  const movingNoteIds = folderChanged ? noteSubtreeIds(id) : [];

  const updated = db.transaction((transaction) => {
    if (folderChanged) {
      transaction
        .update(notes)
        .set({ folderId: input.folderId! })
        .where(inArray(notes.id, movingNoteIds))
        .run();
    }
    const row = transaction
      .update(notes)
      .set(changes)
      .where(eq(notes.id, id))
      .returning()
      .get();
    if (removedImagePaths.length > 0) {
      transaction
        .delete(noteImages)
        .where(
          and(
            eq(noteImages.noteId, id),
            inArray(noteImages.imagePath, removedImagePaths),
          ),
        )
        .run();
    }
    if (imagePaths.length > 0) {
      transaction
        .insert(noteImages)
        .values(imagePaths.map((imagePath) => ({ noteId: id, imagePath })))
        .run();
    }
    return row;
  });

  return { note: toNoteDetail(updated), removedImagePaths };
}

export function deleteNote(
  id: number,
  expectedImagePaths?: readonly string[],
): DeletedNoteResult | null {
  assertPositiveId(id, "id");
  const current = db.select({ id: notes.id }).from(notes).where(eq(notes.id, id)).get();
  if (!current) return null;
  const child = db.select({ id: notes.id }).from(notes).where(eq(notes.parentId, id)).get();
  if (child) {
    throw new RepositoryError("NOT_EMPTY", "Delete child pages before deleting this note.", {
      noteId: id,
    });
  }
  const imagePaths = listNoteImagePaths(id);
  assertPreparedImageRemoval(imagePaths, expectedImagePaths);
  db.delete(notes).where(eq(notes.id, id)).run();
  return { imagePaths };
}

function normalizeNewImagePaths(imagePaths: readonly string[]): string[] {
  if (!Array.isArray(imagePaths) || imagePaths.some((value) => typeof value !== "string")) {
    throw new RepositoryError("VALIDATION", "Image paths must be strings.");
  }
  const normalized = imagePaths.map(normalizeStoredNoteImagePath);
  if (new Set(normalized).size !== normalized.length) {
    throw new RepositoryError("VALIDATION", "Image paths must be unique.");
  }
  return normalized;
}

function assertNoteParent(
  parentId: number | null,
  folderId: number,
  noteId?: number,
): void {
  if (parentId === null) return;
  assertPositiveId(parentId, "parentId");
  if (parentId === noteId) {
    throw new RepositoryError("CONFLICT", "A note cannot be its own parent.");
  }
  const parent = db.select().from(notes).where(eq(notes.id, parentId)).get();
  if (!parent) {
    throw new RepositoryError("NOT_FOUND", "Parent note not found.", { parentId });
  }
  if (parent.folderId !== folderId) {
    throw new RepositoryError(
      "CONFLICT",
      "Parent and child notes must be in the same folder.",
      { parentId, folderId },
    );
  }
  if (noteId !== undefined && noteSubtreeIds(noteId).includes(parentId)) {
    throw new RepositoryError("CONFLICT", "A note cannot be moved below its descendant.");
  }
}

function noteSubtreeIds(rootId: number): number[] {
  const rows = db.select({ id: notes.id, parentId: notes.parentId }).from(notes).all();
  const ids = new Set([rootId]);
  let added = true;
  while (added) {
    added = false;
    for (const row of rows) {
      if (row.parentId !== null && ids.has(row.parentId) && !ids.has(row.id)) {
        ids.add(row.id);
        added = true;
      }
    }
  }
  return [...ids];
}

function assertPreparedImageRemoval(
  actualImagePaths: readonly string[],
  expectedImagePaths: readonly string[] | undefined,
): void {
  if (actualImagePaths.length === 0 && expectedImagePaths === undefined) return;
  if (expectedImagePaths === undefined) {
    throw new RepositoryError(
      "CONFLICT",
      "Image removal must be prepared before changing this note.",
    );
  }
  const actual = new Set(actualImagePaths.map(normalizeStoredNoteImagePath));
  const expected = new Set(expectedImagePaths.map(normalizeStoredNoteImagePath));
  if (
    actual.size !== expected.size ||
    [...actual].some((imagePath) => !expected.has(imagePath))
  ) {
    throw new RepositoryError(
      "CONFLICT",
      "The note images changed while the request was in progress. Please try again.",
    );
  }
}

function assertManagedImageOwnership(
  contentMd: string,
  ownedImagePaths: readonly string[],
  newImagePaths: readonly string[],
): Set<string> {
  const referenced = managedImagePathsInMarkdown(contentMd);
  const allowed = new Set([...ownedImagePaths, ...newImagePaths]);
  const foreign = [...referenced].find((imagePath) => !allowed.has(imagePath));
  if (foreign) {
    throw new RepositoryError(
      "CONFLICT",
      "Managed images can only be used by the note that owns them.",
      { imagePath: foreign },
    );
  }
  const unreferenced = newImagePaths.find((imagePath) => !referenced.has(imagePath));
  if (unreferenced) {
    throw new RepositoryError(
      "VALIDATION",
      "Every uploaded image must be referenced by the note content.",
      { imagePath: unreferenced },
    );
  }
  return referenced;
}

function toNoteSummary(row: NoteRow): NoteSummaryDto {
  return {
    id: row.id,
    folderId: row.folderId,
    parentId: row.parentId,
    title: row.title,
    tags: tagsFromJson(row.tags),
    updatedAt: row.updatedAt,
  };
}

function toNoteDetail(row: NoteRow): NoteDetailDto {
  return {
    ...toNoteSummary(row),
    contentMd: row.contentMd,
    createdAt: row.createdAt,
  };
}
