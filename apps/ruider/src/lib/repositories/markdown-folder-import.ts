import { and, eq, isNull } from "drizzle-orm";
import {
  folderImportPathKey,
  normalizeFolderImportTitle,
  type MarkdownFolderCommitResult,
} from "@babel-apps/platform/imports/core";
import type { PreparedMarkdownFolderRecord } from "@babel-apps/platform/imports/server";

import { db } from "@/lib/db/client";
import { folders, noteImages, notes } from "@/lib/db/schema";
import { managedImagePathsInMarkdown, normalizeStoredNoteImagePath } from "@/lib/storage";

import { RepositoryError } from "./errors";
import { replaceSourceNoteLinks, resolveIncomingLinksForTitle } from "./links";
import { normalizeMarkdown, normalizeRequiredText, tagsToJson } from "./shared";

export interface PersistedMarkdownFolderRecord extends PreparedMarkdownFolderRecord {
  imagePaths: string[];
}

export function listMarkdownFolderImportTitles(): string[] {
  return db.select({ title: notes.title }).from(notes).all().map(({ title }) => title);
}

export function importMarkdownFolderBatch(
  baseFolderId: number,
  records: readonly PersistedMarkdownFolderRecord[],
): MarkdownFolderCommitResult {
  return db.transaction((transaction) => {
    const baseFolder = transaction.select().from(folders).where(eq(folders.id, baseFolderId)).get();
    if (!baseFolder) {
      throw new RepositoryError("NOT_FOUND", "The selected destination folder no longer exists.", {
        folderId: baseFolderId,
      });
    }
    assertUniqueImportTitles(
      records,
      transaction.select({ title: notes.title }).from(notes).all().map(({ title }) => title),
    );

    let createdFolderCount = 0;
    const mappedFolders = new Map<string, number>([["", baseFolderId]]);
    const targetFolderIds = new Map<string, number>();
    const resolveMappedFolder = (mappedPath: string): number => {
      const cached = mappedFolders.get(folderImportPathKeyOrRoot(mappedPath));
      if (cached !== undefined) return cached;
      let parentId = baseFolderId;
      let traversed = "";
      for (const segment of mappedPath.split("/")) {
        traversed = traversed ? `${traversed}/${segment}` : segment;
        const key = folderImportPathKeyOrRoot(traversed);
        const existingId = mappedFolders.get(key);
        if (existingId !== undefined) {
          parentId = existingId;
          continue;
        }
        const siblings = transaction.select().from(folders).where(eq(folders.parentId, parentId)).all();
        const matches = siblings.filter((folder) =>
          normalizeFolderImportTitle(folder.name) === normalizeFolderImportTitle(segment));
        if (matches.length > 1) {
          throw new RepositoryError(
            "CONFLICT",
            `Folder mapping “${traversed}” is ambiguous.`,
            { path: traversed },
          );
        }
        if (matches.length === 1) {
          parentId = matches[0].id;
        } else {
          const inserted = transaction.insert(folders).values({
            parentId,
            name: normalizeRequiredText(segment, "folderName"),
            position: siblings.length,
          }).returning({ id: folders.id }).get();
          parentId = inserted.id;
          createdFolderCount += 1;
        }
        mappedFolders.set(key, parentId);
      }
      return parentId;
    };

    for (const record of records) {
      const folderId = record.folder.kind === "existing"
        ? requireImportFolder(transaction, record.folder.folderId)
        : resolveMappedFolder(record.folder.path);
      targetFolderIds.set(folderImportPathKey(record.sourcePath), folderId);
    }

    const insertedIds = new Map<string, number>();
    const remaining = new Map(records.map((record) => [folderImportPathKey(record.sourcePath), record]));
    while (remaining.size > 0) {
      let insertedThisPass = 0;
      for (const [sourceKey, record] of [...remaining]) {
        if (
          record.parent?.kind === "batch" &&
          !insertedIds.has(folderImportPathKey(record.parent.sourcePath))
        ) continue;
        const folderId = targetFolderIds.get(sourceKey)!;
        const parentId = resolveImportParent(
          transaction,
          record,
          folderId,
          insertedIds,
          targetFolderIds,
        );
        const title = normalizeRequiredText(record.title, "title");
        const contentMd = normalizeMarkdown(record.contentMd, "contentMd");
        const imagePaths = normalizeImportedImagePaths(contentMd, record.imagePaths);
        const siblings = transaction.select({ id: notes.id }).from(notes).where(and(
          eq(notes.folderId, folderId),
          parentId === null ? isNull(notes.parentId) : eq(notes.parentId, parentId),
        )).all();
        const row = transaction.insert(notes).values({
          folderId,
          parentId,
          title,
          contentMd,
          tags: tagsToJson(record.tags),
          position: siblings.length,
        }).returning({ id: notes.id }).get();
        if (imagePaths.length > 0) {
          transaction.insert(noteImages).values(
            imagePaths.map((imagePath) => ({ noteId: row.id, imagePath })),
          ).run();
        }
        insertedIds.set(sourceKey, row.id);
        remaining.delete(sourceKey);
        insertedThisPass += 1;
      }
      if (insertedThisPass === 0) {
        throw new RepositoryError("CONFLICT", "Imported parent pages contain a cycle.");
      }
    }

    for (const record of records) {
      const id = insertedIds.get(folderImportPathKey(record.sourcePath))!;
      replaceSourceNoteLinks(transaction, id, record.contentMd);
    }
    for (const record of records) resolveIncomingLinksForTitle(transaction, record.title);

    return {
      imported: records.map((record) => ({
        sourcePath: record.sourcePath,
        id: insertedIds.get(folderImportPathKey(record.sourcePath))!,
        folderId: targetFolderIds.get(folderImportPathKey(record.sourcePath))!,
        title: record.title,
      })),
      createdFolderCount,
    };
  });
}

type ImportTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function requireImportFolder(transaction: ImportTransaction, folderId: number): number {
  const folder = transaction.select({ id: folders.id }).from(folders).where(eq(folders.id, folderId)).get();
  if (!folder) {
    throw new RepositoryError("NOT_FOUND", "A destination folder no longer exists.", { folderId });
  }
  return folder.id;
}

function resolveImportParent(
  transaction: ImportTransaction,
  record: PersistedMarkdownFolderRecord,
  folderId: number,
  insertedIds: ReadonlyMap<string, number>,
  targetFolderIds: ReadonlyMap<string, number>,
): number | null {
  if (record.parent === null) return null;
  if (record.parent.kind === "existing") {
    const parent = transaction.select({ id: notes.id, folderId: notes.folderId })
      .from(notes).where(eq(notes.id, record.parent.id)).get();
    if (!parent || parent.folderId !== folderId) {
      throw new RepositoryError("CONFLICT", "Parent page must exist in the destination folder.");
    }
    return parent.id;
  }
  const parentKey = folderImportPathKey(record.parent.sourcePath);
  if (targetFolderIds.get(parentKey) !== folderId) {
    throw new RepositoryError("CONFLICT", "Imported parent page must use the same destination folder.");
  }
  const parentId = insertedIds.get(parentKey);
  if (parentId === undefined) {
    throw new RepositoryError("CONFLICT", "Imported parent page could not be resolved.");
  }
  return parentId;
}

function assertUniqueImportTitles(
  records: readonly PersistedMarkdownFolderRecord[],
  existingTitles: readonly string[],
): void {
  const occupied = new Set(existingTitles.map(normalizeFolderImportTitle));
  for (const record of records) {
    const key = normalizeFolderImportTitle(record.title);
    if (!key || occupied.has(key)) {
      throw new RepositoryError("CONFLICT", `Title “${record.title}” is already used.`, {
        sourcePath: record.sourcePath,
      });
    }
    occupied.add(key);
  }
}

function normalizeImportedImagePaths(
  contentMd: string,
  imagePaths: readonly string[],
): string[] {
  const normalized = imagePaths.map(normalizeStoredNoteImagePath);
  const referenced = managedImagePathsInMarkdown(contentMd);
  if (
    new Set(normalized).size !== normalized.length ||
    referenced.size !== normalized.length ||
    normalized.some((imagePath) => !referenced.has(imagePath))
  ) {
    throw new RepositoryError(
      "VALIDATION",
      "Imported image ownership does not match the reviewed Markdown.",
    );
  }
  return normalized;
}

function folderImportPathKeyOrRoot(value: string): string {
  return value ? folderImportPathKey(value) : "";
}
