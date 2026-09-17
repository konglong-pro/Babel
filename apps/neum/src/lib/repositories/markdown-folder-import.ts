import {
  folderImportPathKey,
  normalizeFolderImportTitle,
  type MarkdownFolderCommitResult,
} from "@babel-apps/platform/imports/core";
import type { PreparedMarkdownFolderRecord } from "@babel-apps/platform/imports/server";

import { getNeumDatabase } from "@/lib/db/client";
import { identityKey } from "@/lib/identity";
import {
  managedImagePathsInMarkdown,
  normalizeStoredNoteImagePath,
} from "@/lib/storage";

import { RepositoryError } from "./errors";
import { replaceSourceEntryLinks, resolveIncomingLinksForTitle } from "./links";
import { normalizeRequiredText, normalizeTags } from "./shared";

export interface PersistedMarkdownFolderRecord extends PreparedMarkdownFolderRecord {
  imagePaths: string[];
}

export function listMarkdownFolderImportTitles(): string[] {
  return (getNeumDatabase().sqlite
    .prepare('SELECT "title" FROM "entry" ORDER BY "id"')
    .all() as Array<{ title: string }>).map(({ title }) => title);
}

export function importMarkdownFolderBatch(
  baseFolderId: number,
  records: readonly PersistedMarkdownFolderRecord[],
): MarkdownFolderCommitResult {
  const { sqlite } = getNeumDatabase();
  return sqlite.transaction(() => {
    requireFolder(sqlite, baseFolderId);
    assertUniqueTitles(records, listMarkdownFolderImportTitles());
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
        const nameKey = identityKey(segment);
        const match = sqlite.prepare(
          'SELECT "id" FROM "folder" WHERE "parent_id" = ? AND "name_key" = ?',
        ).get(parentId, nameKey) as { id: number } | undefined;
        if (match) {
          parentId = match.id;
        } else {
          const position = (sqlite.prepare(
            'SELECT COUNT(*) AS "count" FROM "folder" WHERE "parent_id" = ?',
          ).get(parentId) as { count: number }).count;
          const inserted = sqlite.prepare(
            'INSERT INTO "folder" ("parent_id", "name", "name_key", "position") VALUES (?, ?, ?, ?) RETURNING "id"',
          ).get(parentId, segment, nameKey, position) as { id: number };
          parentId = inserted.id;
          createdFolderCount += 1;
        }
        mappedFolders.set(key, parentId);
      }
      return parentId;
    };

    for (const record of records) {
      const folderId = record.folder.kind === "existing"
        ? requireFolder(sqlite, record.folder.folderId)
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
        const parentId = resolveParent(sqlite, record, folderId, insertedIds, targetFolderIds);
        const title = normalizeRequiredText(record.title, "title");
        const imagePaths = normalizeImages(record.contentMd, record.imagePaths);
        const position = Number((sqlite.prepare(
          `SELECT COUNT(*) AS "count" FROM "entry"
           WHERE "folder_id" = ? AND "kind" = 'knowledge'
             AND ((? IS NULL AND "parent_id" IS NULL) OR "parent_id" = ?)`,
        ).get(folderId, parentId, parentId) as { count: number }).count);
        const inserted = sqlite.prepare(
          `INSERT INTO "entry"
            ("parent_id", "folder_id", "kind", "title", "notes_md", "code", "language", "filename", "version", "position")
           VALUES (?, ?, 'knowledge', ?, ?, NULL, NULL, NULL, 1, ?)
           RETURNING "id"`,
        ).get(parentId, folderId, title, record.contentMd, position) as { id: number };
        for (const imagePath of imagePaths) {
          sqlite.prepare(
            'INSERT INTO "entry_image" ("entry_id", "image_path") VALUES (?, ?)',
          ).run(inserted.id, imagePath);
        }
        for (const tag of normalizeTags(record.tags)) {
          const tagKey = identityKey(tag);
          sqlite.prepare(
            'INSERT OR IGNORE INTO "tag" ("name", "name_key") VALUES (?, ?)',
          ).run(tag, tagKey);
          const tagRow = sqlite.prepare(
            'SELECT "id" FROM "tag" WHERE "name_key" = ?',
          ).get(tagKey) as { id: number };
          sqlite.prepare(
            'INSERT INTO "entry_tag" ("entry_id", "tag_id") VALUES (?, ?)',
          ).run(inserted.id, tagRow.id);
        }
        insertedIds.set(sourceKey, inserted.id);
        remaining.delete(sourceKey);
        insertedThisPass += 1;
      }
      if (insertedThisPass === 0) {
        throw new RepositoryError("CONFLICT", "Imported parent pages contain a cycle.");
      }
    }

    for (const record of records) {
      replaceSourceEntryLinks(
        sqlite,
        insertedIds.get(folderImportPathKey(record.sourcePath))!,
        record.contentMd,
      );
    }
    for (const record of records) resolveIncomingLinksForTitle(sqlite, record.title);
    return {
      imported: records.map((record) => ({
        sourcePath: record.sourcePath,
        id: insertedIds.get(folderImportPathKey(record.sourcePath))!,
        folderId: targetFolderIds.get(folderImportPathKey(record.sourcePath))!,
        title: record.title,
      })),
      createdFolderCount,
    };
  })();
}

type Sqlite = ReturnType<typeof getNeumDatabase>["sqlite"];

function requireFolder(sqlite: Sqlite, folderId: number): number {
  const row = sqlite.prepare('SELECT "id" FROM "folder" WHERE "id" = ?').get(folderId) as
    | { id: number }
    | undefined;
  if (!row) throw new RepositoryError("NOT_FOUND", "A destination folder no longer exists.", { folderId });
  return row.id;
}

function resolveParent(
  sqlite: Sqlite,
  record: PersistedMarkdownFolderRecord,
  folderId: number,
  insertedIds: ReadonlyMap<string, number>,
  targetFolderIds: ReadonlyMap<string, number>,
): number | null {
  if (record.parent === null) return null;
  if (record.parent.kind === "existing") {
    const row = sqlite.prepare(
      `SELECT "id", "folder_id" AS "folderId" FROM "entry"
       WHERE "id" = ? AND "kind" = 'knowledge'`,
    ).get(record.parent.id) as { id: number; folderId: number } | undefined;
    if (!row || row.folderId !== folderId) {
      throw new RepositoryError("CONFLICT", "Parent page must be knowledge in the destination folder.");
    }
    return row.id;
  }
  const parentKey = folderImportPathKey(record.parent.sourcePath);
  if (targetFolderIds.get(parentKey) !== folderId) {
    throw new RepositoryError("CONFLICT", "Imported parent page must use the same destination folder.");
  }
  const parentId = insertedIds.get(parentKey);
  if (parentId === undefined) throw new RepositoryError("CONFLICT", "Imported parent page could not be resolved.");
  return parentId;
}

function assertUniqueTitles(
  records: readonly PersistedMarkdownFolderRecord[],
  existing: readonly string[],
): void {
  const occupied = new Set(existing.map(normalizeFolderImportTitle));
  for (const record of records) {
    const key = normalizeFolderImportTitle(record.title);
    if (!key || occupied.has(key)) {
      throw new RepositoryError("CONFLICT", `Title “${record.title}” is already used.`);
    }
    occupied.add(key);
  }
}

function normalizeImages(contentMd: string, rawPaths: readonly string[]): string[] {
  const imagePaths = rawPaths.map(normalizeStoredNoteImagePath);
  const referenced = managedImagePathsInMarkdown(contentMd);
  if (
    new Set(imagePaths).size !== imagePaths.length ||
    referenced.size !== imagePaths.length ||
    imagePaths.some((imagePath) => !referenced.has(imagePath))
  ) throw new RepositoryError("VALIDATION", "Imported image ownership does not match the reviewed Markdown.");
  return imagePaths;
}

function keyOrRoot(value: string): string {
  return value ? folderImportPathKey(value) : "";
}
