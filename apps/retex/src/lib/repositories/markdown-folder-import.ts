import { and, eq, isNull } from "drizzle-orm";
import {
  folderImportPathKey,
  normalizeFolderImportTitle,
  type MarkdownFolderCommitResult,
} from "@babel-apps/platform/imports/core";
import type { PreparedMarkdownFolderRecord } from "@babel-apps/platform/imports/server";

import { db } from "@/lib/db/client";
import { exercises, folders, knowledgeNotes } from "@/lib/db/schema";

import { RepositoryError } from "./errors";
import { replaceSourceNoteLinks, resolveIncomingLinksForTitle } from "./links";
import { insertNoteImages, prepareNewNoteImages } from "./note-images";
import { normalizeMarkdown, normalizeRequiredText, tagsToJson } from "./shared";

export interface PersistedMarkdownFolderRecord extends PreparedMarkdownFolderRecord {
  imagePaths: string[];
}

export function listMarkdownFolderImportTitles(): string[] {
  return [
    ...db.select({ title: knowledgeNotes.title }).from(knowledgeNotes).all(),
    ...db.select({ title: exercises.title }).from(exercises).all(),
  ].map(({ title }) => title);
}

export function importMarkdownFolderBatch(
  baseFolderId: number,
  records: readonly PersistedMarkdownFolderRecord[],
): MarkdownFolderCommitResult {
  return db.transaction((transaction) => {
    requireKnowledgeFolder(transaction, baseFolderId);
    assertUniqueTitles(records, [
      ...transaction.select({ title: knowledgeNotes.title }).from(knowledgeNotes).all(),
      ...transaction.select({ title: exercises.title }).from(exercises).all(),
    ].map(({ title }) => title));
    let createdFolderCount = 0;
    const mappedFolders = new Map<string, number>([["", baseFolderId]]);
    const targetFolderIds = new Map<string, number>();
    const resolveMappedFolder = (mappedPath: string): number => {
      const cached = mappedFolders.get(keyOrRoot(mappedPath));
      if (cached !== undefined) return cached;
      let parentId = baseFolderId;
      let traversed = "";
      for (const rawSegment of mappedPath.split("/")) {
        const segment = normalizeRequiredText(rawSegment, "folderName");
        traversed = traversed ? `${traversed}/${segment}` : segment;
        const key = keyOrRoot(traversed);
        const cachedId = mappedFolders.get(key);
        if (cachedId !== undefined) {
          parentId = cachedId;
          continue;
        }
        const siblings = transaction.select().from(folders).where(and(
          eq(folders.type, "knowledge"),
          eq(folders.parentId, parentId),
        )).all();
        const matches = siblings.filter((folder) =>
          normalizeFolderImportTitle(folder.name) === normalizeFolderImportTitle(segment));
        if (matches.length > 1) {
          throw new RepositoryError("CONFLICT", `Folder mapping “${traversed}” is ambiguous.`);
        }
        if (matches.length === 1) parentId = matches[0].id;
        else {
          parentId = transaction.insert(folders).values({
            type: "knowledge",
            parentId,
            name: segment,
            position: siblings.length,
          }).returning({ id: folders.id }).get().id;
          createdFolderCount += 1;
        }
        mappedFolders.set(key, parentId);
      }
      return parentId;
    };

    for (const record of records) {
      const folderId = record.folder.kind === "existing"
        ? requireKnowledgeFolder(transaction, record.folder.folderId)
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
        const parentId = resolveParent(transaction, record, folderId, insertedIds, targetFolderIds);
        const title = normalizeRequiredText(record.title, "title");
        const contentMd = normalizeMarkdown(record.contentMd, "contentMd");
        const imagePaths = prepareNewNoteImages([contentMd], record.imagePaths);
        const siblings = transaction.select({ id: knowledgeNotes.id }).from(knowledgeNotes).where(and(
          eq(knowledgeNotes.folderId, folderId),
          parentId === null ? isNull(knowledgeNotes.parentId) : eq(knowledgeNotes.parentId, parentId),
        )).all();
        const row = transaction.insert(knowledgeNotes).values({
          folderId,
          parentId,
          title,
          contentMd,
          tags: tagsToJson(record.tags),
          position: siblings.length,
        }).returning({ id: knowledgeNotes.id }).get();
        insertNoteImages(transaction, "knowledge", row.id, imagePaths);
        insertedIds.set(sourceKey, row.id);
        remaining.delete(sourceKey);
        insertedThisPass += 1;
      }
      if (insertedThisPass === 0) {
        throw new RepositoryError("CONFLICT", "Imported parent pages contain a cycle.");
      }
    }
    for (const record of records) {
      replaceSourceNoteLinks(
        transaction,
        "knowledge",
        insertedIds.get(folderImportPathKey(record.sourcePath))!,
        [record.contentMd],
      );
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

function requireKnowledgeFolder(transaction: ImportTransaction, folderId: number): number {
  const folder = transaction.select({ id: folders.id, type: folders.type })
    .from(folders).where(eq(folders.id, folderId)).get();
  if (!folder || folder.type !== "knowledge") {
    throw new RepositoryError("NOT_FOUND", "A knowledge destination folder no longer exists.", { folderId });
  }
  return folder.id;
}

function resolveParent(
  transaction: ImportTransaction,
  record: PersistedMarkdownFolderRecord,
  folderId: number,
  insertedIds: ReadonlyMap<string, number>,
  targetFolderIds: ReadonlyMap<string, number>,
): number | null {
  if (record.parent === null) return null;
  if (record.parent.kind === "existing") {
    const parent = transaction.select({ id: knowledgeNotes.id, folderId: knowledgeNotes.folderId })
      .from(knowledgeNotes).where(eq(knowledgeNotes.id, record.parent.id)).get();
    if (!parent || parent.folderId !== folderId) {
      throw new RepositoryError("CONFLICT", "Parent knowledge page must be in the destination folder.");
    }
    return parent.id;
  }
  const parentKey = folderImportPathKey(record.parent.sourcePath);
  if (targetFolderIds.get(parentKey) !== folderId) {
    throw new RepositoryError("CONFLICT", "Imported parent page must use the same destination folder.");
  }
  const parentId = insertedIds.get(parentKey);
  if (parentId === undefined) throw new RepositoryError("CONFLICT", "Imported parent page could not be resolved.");
  return parentId;
}

function assertUniqueTitles(records: readonly PersistedMarkdownFolderRecord[], existing: readonly string[]): void {
  const occupied = new Set(existing.map(normalizeFolderImportTitle));
  for (const record of records) {
    const key = normalizeFolderImportTitle(record.title);
    if (!key || occupied.has(key)) {
      throw new RepositoryError("CONFLICT", `Title “${record.title}” is already used.`);
    }
    occupied.add(key);
  }
}

function keyOrRoot(value: string): string {
  return value ? folderImportPathKey(value) : "";
}
