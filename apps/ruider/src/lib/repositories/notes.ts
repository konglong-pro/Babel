import { and, asc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { folders, noteImages, notes } from "@/lib/db/schema";
import { managedImagePathsInMarkdown, normalizeStoredNoteImagePath } from "@/lib/storage";
import type { NoteDetailDto, NoteSummaryDto } from "@/lib/types";

import { RepositoryError } from "./errors";
import {
  listOutgoingNoteLinks,
  reconcileNoteTitleChange,
  replaceSourceNoteLinks,
  resolveIncomingLinksForTitle,
} from "./links";
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
  position?: number;
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
      .orderBy(asc(notes.position), asc(notes.id))
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
    .orderBy(asc(notes.position), asc(notes.id))
    .all()
    .map(toNoteSummary);
}

export function getNote(id: number): NoteDetailDto | null {
  assertPositiveId(id, "id");
  const row = db.select().from(notes).where(eq(notes.id, id)).get();
  return row ? toNoteDetail(row, listOutgoingNoteLinks(id)) : null;
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
  if (parentId !== null) requireNoteParent(parentId, input.folderId);
  const title = normalizeRequiredText(input.title, "title");
  const contentMd = normalizeMarkdown(input.contentMd ?? "", "contentMd");
  const tags = tagsToJson(input.tags ?? []);
  const imagePaths = normalizeNewImagePaths(newImagePaths);
  assertManagedImageOwnership(contentMd, [], imagePaths);

  return db.transaction((transaction) => {
    transaction
      .update(notes)
      .set({ position: sql`${notes.position} + 1` })
      .where(noteScopeCondition(input.folderId, parentId))
      .run();
    const inserted = transaction
      .insert(notes)
      .values({ folderId: input.folderId, parentId, title, contentMd, tags, position: 0 })
      .returning()
      .get();
    if (imagePaths.length > 0) {
      transaction
        .insert(noteImages)
        .values(imagePaths.map((imagePath) => ({ noteId: inserted.id, imagePath })))
        .run();
    }
    replaceSourceNoteLinks(transaction, inserted.id, contentMd);
    resolveIncomingLinksForTitle(transaction, title);
    return toNoteDetail(
      inserted,
      listOutgoingNoteLinks(inserted.id, transaction),
    );
  });
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
    position?: number;
    updatedAt: SQL;
  } = { updatedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))` };
  let changed = imagePaths.length > 0;
  let movedDescendantIds: number[] = [];
  let folderChanged = false;
  if (input.folderId !== undefined) {
    requireFolder(input.folderId);
    changes.folderId = input.folderId;
    if (input.folderId !== current.folderId) {
      folderChanged = true;
      movedDescendantIds = noteDescendantIds(id);
    }
    changed = true;
  }
  if (input.parentId !== undefined || folderChanged) {
    const parentId = input.parentId === undefined ? null : input.parentId ?? null;
    assertValidParent(id, parentId, changes.folderId ?? current.folderId);
    changes.parentId = parentId;
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
  const nextFolderId = changes.folderId ?? current.folderId;
  const nextParentId = changes.parentId === undefined ? current.parentId : changes.parentId;
  const requestedPosition = input.position === undefined
    ? undefined
    : normalizePosition(input.position);
  const orderPlan =
    nextFolderId !== current.folderId ||
    nextParentId !== current.parentId ||
    requestedPosition !== undefined
      ? planNoteOrder(current, nextFolderId, nextParentId, requestedPosition)
      : null;
  if (orderPlan !== null) {
    changes.position = orderPlan.position;
    changed = true;
  }
  if (!changed) return { note: getNote(id)!, removedImagePaths: [] };

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

  const updated = db.transaction((transaction) => {
    for (const change of orderPlan?.siblings ?? []) {
      transaction.update(notes)
        .set({ position: change.position })
        .where(eq(notes.id, change.id))
        .run();
    }
    const row = transaction
      .update(notes)
      .set(changes)
      .where(eq(notes.id, id))
      .returning()
      .get();
    if (changes.folderId !== undefined && movedDescendantIds.length > 0) {
      transaction
        .update(notes)
        .set({ folderId: changes.folderId, updatedAt: changes.updatedAt })
        .where(inArray(notes.id, movedDescendantIds))
        .run();
    }
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
    replaceSourceNoteLinks(transaction, id, contentMd);
    if (input.title !== undefined) {
      reconcileNoteTitleChange(transaction, id, current.title, changes.title!);
    }
    return toNoteDetail(row, listOutgoingNoteLinks(id, transaction));
  });

  return { note: updated, removedImagePaths };
}

export function deleteNote(
  id: number,
  expectedImagePaths?: readonly string[],
): DeletedNoteResult | null {
  assertPositiveId(id, "id");
  const current = db
    .select({
      id: notes.id,
      folderId: notes.folderId,
      parentId: notes.parentId,
      title: notes.title,
    })
    .from(notes)
    .where(eq(notes.id, id))
    .get();
  if (!current) return null;
  const child = db
    .select({ id: notes.id })
    .from(notes)
    .where(eq(notes.parentId, id))
    .get();
  if (child) {
    throw new RepositoryError("NOT_EMPTY", "Notes with child pages cannot be deleted.", {
      noteId: id,
    });
  }
  const imagePaths = listNoteImagePaths(id);
  assertPreparedImageRemoval(imagePaths, expectedImagePaths);
  db.transaction((transaction) => {
    transaction.delete(notes).where(eq(notes.id, id)).run();
    normalizeNoteScope(current.folderId, current.parentId);
    resolveIncomingLinksForTitle(transaction, current.title);
  });
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

interface NoteOrderPlan {
  position: number;
  siblings: Array<{ id: number; position: number }>;
}

function planNoteOrder(
  current: NoteRow,
  folderId: number,
  parentId: number | null,
  requestedPosition: number | undefined,
): NoteOrderPlan {
  const sameScope = current.folderId === folderId && current.parentId === parentId;
  const sourceIds = orderedNoteIds(current.folderId, current.parentId)
    .filter((id) => id !== current.id);
  const targetIds = sameScope
    ? sourceIds
    : orderedNoteIds(folderId, parentId).filter((id) => id !== current.id);
  const position = Math.min(requestedPosition ?? targetIds.length, targetIds.length);
  const orderedTargetIds = [...targetIds];
  orderedTargetIds.splice(position, 0, current.id);
  return {
    position,
    siblings: [
      ...(sameScope ? [] : sourceIds.map((id, index) => ({ id, position: index }))),
      ...orderedTargetIds
        .map((id, index) => ({ id, position: index }))
        .filter(({ id }) => id !== current.id),
    ],
  };
}

function orderedNoteIds(folderId: number, parentId: number | null): number[] {
  return db.select({ id: notes.id })
    .from(notes)
    .where(noteScopeCondition(folderId, parentId))
    .orderBy(asc(notes.position), asc(notes.id))
    .all()
    .map(({ id }) => id);
}

function noteScopeCondition(folderId: number, parentId: number | null): SQL {
  return and(
    eq(notes.folderId, folderId),
    parentId === null ? isNull(notes.parentId) : eq(notes.parentId, parentId),
  )!;
}

function normalizeNoteScope(folderId: number, parentId: number | null): void {
  for (const [position, id] of orderedNoteIds(folderId, parentId).entries()) {
    db.update(notes).set({ position }).where(eq(notes.id, id)).run();
  }
}

function normalizePosition(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RepositoryError("VALIDATION", "position must be a non-negative integer.", {
      field: "position",
    });
  }
  return value;
}

function toNoteSummary(row: NoteRow): NoteSummaryDto {
  return {
    id: row.id,
    parentId: row.parentId,
    folderId: row.folderId,
    title: row.title,
    tags: tagsFromJson(row.tags),
    position: row.position,
    updatedAt: row.updatedAt,
  };
}

function requireNoteParent(parentId: number, folderId: number): NoteRow {
  const parent = db.select().from(notes).where(eq(notes.id, parentId)).get();
  if (!parent) {
    throw new RepositoryError("NOT_FOUND", "Parent note not found.", { parentId });
  }
  if (parent.folderId !== folderId) {
    throw new RepositoryError("CONFLICT", "Parent and child notes must use the same folder.", {
      parentId,
      folderId,
    });
  }
  return parent;
}

function noteDescendantIds(noteId: number): number[] {
  const rows = db.select({ id: notes.id, parentId: notes.parentId }).from(notes).all();
  const grouped = new Map<number, number[]>();
  for (const row of rows) {
    if (row.parentId === null) continue;
    const children = grouped.get(row.parentId) ?? [];
    children.push(row.id);
    grouped.set(row.parentId, children);
  }

  const descendants: number[] = [];
  const visited = new Set([noteId]);
  const stack = [...(grouped.get(noteId) ?? [])];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined || visited.has(current)) continue;
    visited.add(current);
    descendants.push(current);
    stack.push(...(grouped.get(current) ?? []));
  }
  return descendants;
}

function assertValidParent(noteId: number, parentId: number | null, folderId: number): void {
  if (parentId === null) return;
  if (parentId === noteId) {
    throw new RepositoryError("CONFLICT", "A note cannot be its own parent.", {
      noteId,
      parentId,
    });
  }

  let cursor: number | null = parentId;
  const visited = new Set<number>();
  while (cursor !== null) {
    if (cursor === noteId) {
      throw new RepositoryError("CONFLICT", "Moving this note would create a cycle.", {
        noteId,
        parentId,
      });
    }
    if (visited.has(cursor)) {
      throw new RepositoryError("CONFLICT", "The existing note hierarchy contains a cycle.", {
        noteId,
        parentId,
      });
    }
    visited.add(cursor);
    cursor = requireNoteParent(cursor, folderId).parentId;
  }
}

function toNoteDetail(
  row: NoteRow,
  links: NoteDetailDto["links"],
): NoteDetailDto {
  return {
    ...toNoteSummary(row),
    contentMd: row.contentMd,
    createdAt: row.createdAt,
    links,
  };
}
