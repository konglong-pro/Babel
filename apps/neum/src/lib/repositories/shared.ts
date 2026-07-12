import { asc, eq, inArray, sql } from "drizzle-orm";

import { getNeumDatabase } from "@/lib/db/client";
import { entries, entryTags, folders, tags } from "@/lib/db/schema";
import { identityKey } from "@/lib/identity";
import type { EntryKind, FolderDto } from "@/lib/types";

import { RepositoryError } from "./errors";

type FolderRow = typeof folders.$inferSelect;

export function assertPositiveId(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RepositoryError("VALIDATION", `${label} must be a positive integer.`, {
      field: label,
    });
  }
}

export function normalizeRequiredText(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new RepositoryError("VALIDATION", `${label} must be a string.`, {
      field: label,
    });
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new RepositoryError("VALIDATION", `${label} is required.`, {
      field: label,
    });
  }
  return normalized;
}

export function normalizeOptionalText(
  value: unknown,
  label: string,
): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new RepositoryError("VALIDATION", `${label} must be a string or null.`, {
      field: label,
    });
  }
  const normalized = value.trim();
  return normalized || null;
}

export function normalizeVerbatimText(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new RepositoryError("VALIDATION", `${label} must be a string.`, {
      field: label,
    });
  }
  return value;
}

export function normalizeEntryKind(value: unknown): EntryKind {
  if (value !== "knowledge" && value !== "snippet") {
    throw new RepositoryError(
      "VALIDATION",
      "kind must be either knowledge or snippet.",
      { field: "kind" },
    );
  }
  return value;
}

export function normalizeTags(value: readonly string[]): string[] {
  if (!Array.isArray(value) || value.some((tag) => typeof tag !== "string")) {
    throw new RepositoryError("VALIDATION", "Tags must be an array of strings.", {
      field: "tags",
    });
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const rawTag of value) {
    const tag = rawTag.trim();
    const key = identityKey(tag);
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }
  return result;
}

export function findFolder(id: number): FolderRow | null {
  assertPositiveId(id, "folderId");
  const { db } = getNeumDatabase();
  return db.select().from(folders).where(eq(folders.id, id)).get() ?? null;
}

export function requireFolder(id: number): FolderRow {
  const folder = findFolder(id);
  if (!folder) {
    throw new RepositoryError("NOT_FOUND", "Folder not found.", { folderId: id });
  }
  return folder;
}

export function descendantFolderIds(folderId: number): number[] {
  requireFolder(folderId);
  const { db } = getNeumDatabase();
  const rows = db
    .select({ id: folders.id, parentId: folders.parentId })
    .from(folders)
    .all();
  const descendants = new Set<number>([folderId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (
        row.parentId !== null &&
        descendants.has(row.parentId) &&
        !descendants.has(row.id)
      ) {
        descendants.add(row.id);
        changed = true;
      }
    }
  }
  return [...descendants];
}

export function tagsByEntryIds(entryIds: readonly number[]): Map<number, string[]> {
  const result = new Map<number, string[]>();
  entryIds.forEach((id) => result.set(id, []));
  if (entryIds.length === 0) return result;
  const { db } = getNeumDatabase();
  const rows = db
    .select({ entryId: entryTags.entryId, name: tags.name })
    .from(entryTags)
    .innerJoin(tags, eq(tags.id, entryTags.tagId))
    .where(inArray(entryTags.entryId, [...entryIds]))
    .orderBy(asc(tags.name), asc(tags.id))
    .all();
  for (const row of rows) result.get(row.entryId)?.push(row.name);
  return result;
}

export function tagNamesForEntry(entryId: number): string[] {
  return tagsByEntryIds([entryId]).get(entryId) ?? [];
}

export function replaceEntryTags(entryId: number, rawTags: readonly string[]): void {
  const { db } = getNeumDatabase();
  const normalized = normalizeTags(rawTags);
  db.delete(entryTags).where(eq(entryTags.entryId, entryId)).run();
  for (const name of normalized) {
    const nameKey = identityKey(name);
    let tag = db
      .select({ id: tags.id })
      .from(tags)
      .where(eq(tags.nameKey, nameKey))
      .get();
    tag ??= db
      .insert(tags)
      .values({ name, nameKey })
      .returning({ id: tags.id })
      .get();
    db.insert(entryTags).values({ entryId, tagId: tag.id }).run();
  }
  pruneUnusedTags();
}

export function pruneUnusedTags(): void {
  const { db } = getNeumDatabase();
  db.run(sql`DELETE FROM ${tags}
    WHERE NOT EXISTS (
      SELECT 1 FROM ${entryTags} WHERE ${entryTags.tagId} = ${tags.id}
    )`);
}

export function toFolderDto(folder: FolderRow): FolderDto {
  return {
    id: folder.id,
    parentId: folder.parentId,
    name: folder.name,
    createdAt: folder.createdAt,
    updatedAt: folder.updatedAt,
  };
}

export function isSqliteConstraint(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string" &&
    (error as { code: string }).code.startsWith("SQLITE_CONSTRAINT")
  );
}

export const nowSql = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export type EntryRow = typeof entries.$inferSelect;
