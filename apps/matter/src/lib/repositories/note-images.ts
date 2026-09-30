import { and, asc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { noteImages } from "@/lib/db/schema";
import {
  managedImagePathsInMarkdown,
  normalizeStoredNoteImagePath,
} from "@/lib/storage/note-images";
import type { LinkEntityKind } from "@/lib/types";

import { RepositoryError } from "./errors";
import { assertPositiveId } from "./shared";

export type NoteImageTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface PreparedNoteImageMutation {
  newImagePaths: string[];
  removedImagePaths: string[];
}

export function listNoteImagePaths(
  sourceKind: LinkEntityKind,
  sourceId: number,
  transaction?: NoteImageTransaction,
): string[] {
  assertPositiveId(sourceId, "sourceId");
  return (transaction ?? db)
    .select({ imagePath: noteImages.imagePath })
    .from(noteImages)
    .where(
      and(
        eq(noteImages.sourceKind, sourceKind),
        eq(noteImages.sourceId, sourceId),
      ),
    )
    .orderBy(asc(noteImages.imagePath))
    .all()
    .map(({ imagePath }) => imagePath);
}

export function prepareNewNoteImages(
  markdownSources: readonly string[],
  newImagePaths: readonly string[] = [],
): string[] {
  const normalized = normalizeNewImagePaths(newImagePaths);
  assertManagedImageOwnership(markdownSources, [], normalized);
  return normalized;
}

export function prepareNoteImageMutation(
  sourceKind: LinkEntityKind,
  sourceId: number,
  markdownSources: readonly string[],
  newImagePaths: readonly string[] = [],
  expectedRemovedImagePaths?: readonly string[],
): PreparedNoteImageMutation {
  const normalized = normalizeNewImagePaths(newImagePaths);
  const ownedImagePaths = listNoteImagePaths(sourceKind, sourceId);
  const referencedImagePaths = assertManagedImageOwnership(
    markdownSources,
    ownedImagePaths,
    normalized,
  );
  const removedImagePaths = ownedImagePaths.filter(
    (imagePath) => !referencedImagePaths.has(imagePath),
  );
  assertPreparedImageRemoval(removedImagePaths, expectedRemovedImagePaths);
  return { newImagePaths: normalized, removedImagePaths };
}

export function applyNoteImageMutation(
  transaction: NoteImageTransaction,
  sourceKind: LinkEntityKind,
  sourceId: number,
  prepared: PreparedNoteImageMutation,
): void {
  if (prepared.removedImagePaths.length > 0) {
    transaction
      .delete(noteImages)
      .where(
        and(
          eq(noteImages.sourceKind, sourceKind),
          eq(noteImages.sourceId, sourceId),
          inArray(noteImages.imagePath, prepared.removedImagePaths),
        ),
      )
      .run();
  }
  insertNoteImages(transaction, sourceKind, sourceId, prepared.newImagePaths);
}

export function insertNoteImages(
  transaction: NoteImageTransaction,
  sourceKind: LinkEntityKind,
  sourceId: number,
  imagePaths: readonly string[],
): void {
  if (imagePaths.length === 0) return;
  transaction
    .insert(noteImages)
    .values(imagePaths.map((imagePath) => ({ sourceKind, sourceId, imagePath })))
    .run();
}

export function assertNoteImageDeletionPrepared(
  sourceKind: LinkEntityKind,
  sourceId: number,
  expectedImagePaths?: readonly string[],
): string[] {
  const imagePaths = listNoteImagePaths(sourceKind, sourceId);
  assertPreparedImageRemoval(imagePaths, expectedImagePaths);
  return imagePaths;
}

export function deleteNoteImageRows(
  transaction: NoteImageTransaction,
  sourceKind: LinkEntityKind,
  sourceId: number,
): void {
  transaction
    .delete(noteImages)
    .where(
      and(
        eq(noteImages.sourceKind, sourceKind),
        eq(noteImages.sourceId, sourceId),
      ),
    )
    .run();
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
  markdownSources: readonly string[],
  ownedImagePaths: readonly string[],
  newImagePaths: readonly string[],
): Set<string> {
  const referenced = new Set<string>();
  for (const markdown of markdownSources) {
    for (const imagePath of managedImagePathsInMarkdown(markdown)) {
      referenced.add(imagePath);
    }
  }
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
