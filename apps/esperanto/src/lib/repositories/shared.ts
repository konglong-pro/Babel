import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { folders } from "@/lib/db/schema";
import type { FolderDto } from "@/lib/types";

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

export function normalizeMarkdown(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new RepositoryError("VALIDATION", `${label} must be a string.`, {
      field: label,
    });
  }
  return value;
}

export function normalizeTags(tags: readonly string[]): string[] {
  if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string")) {
    throw new RepositoryError("VALIDATION", "Tags must be an array of strings.", {
      field: "tags",
    });
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    const value = tag.trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    normalized.push(value);
  }
  return normalized;
}

export function tagsToJson(tags: readonly string[]): string {
  return JSON.stringify(normalizeTags(tags));
}

export function tagsFromJson(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return normalizeTags(
      parsed.filter((tag): tag is string => typeof tag === "string"),
    );
  } catch {
    return [];
  }
}

export function findFolder(id: number): FolderRow | null {
  assertPositiveId(id, "folderId");
  return db.select().from(folders).where(eq(folders.id, id)).get() ?? null;
}

export function requireFolder(id: number): FolderRow {
  const folder = findFolder(id);
  if (!folder) {
    throw new RepositoryError("NOT_FOUND", "Folder not found.", { folderId: id });
  }
  return folder;
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
