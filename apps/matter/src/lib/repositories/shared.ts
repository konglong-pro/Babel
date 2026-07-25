import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { folders } from "@/lib/db/schema";
import { NOTE_CONTENT_MAX_BYTES, utf8ByteLength } from "@/lib/note-limits";
import {
  folderTypes,
  type FolderDto,
  type FolderType,
} from "@/lib/types";

import { RepositoryError } from "./errors";

type FolderRow = typeof folders.$inferSelect;

export function assertPositiveId(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RepositoryError("VALIDATION", `${label} must be a positive integer.`, {
      field: label,
    });
  }
}

export function assertFolderType(value: unknown): asserts value is FolderType {
  if (
    typeof value !== "string" ||
    !(folderTypes as readonly string[]).includes(value)
  ) {
    throw new RepositoryError(
      "VALIDATION",
      'Folder type must be either "knowledge" or "exercise".',
      {
      field: "type",
      },
    );
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

  if (utf8ByteLength(value) > NOTE_CONTENT_MAX_BYTES) {
    throw new RepositoryError(
      "CONTENT_TOO_LARGE",
      "Markdown content must not exceed 10 MiB.",
      { field: label, maxBytes: NOTE_CONTENT_MAX_BYTES },
    );
  }

  return value;
}

export function normalizeRequiredMarkdown(value: unknown, label: string): string {
  const markdown = normalizeMarkdown(value, label);
  if (!markdown.trim()) {
    throw new RepositoryError("VALIDATION", `${label} is required.`, {
      field: label,
    });
  }

  return markdown;
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
    if (!value || seen.has(value)) {
      continue;
    }

    seen.add(value);
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
    if (!Array.isArray(parsed)) {
      return [];
    }

    return normalizeTags(parsed.filter((tag): tag is string => typeof tag === "string"));
  } catch {
    return [];
  }
}

export function findFolder(id: number): FolderRow | null {
  assertPositiveId(id, "folderId");
  return db.select().from(folders).where(eq(folders.id, id)).get() ?? null;
}

export function requireFolder(id: number, expectedType?: FolderType): FolderRow {
  const folder = findFolder(id);
  if (!folder) {
    throw new RepositoryError("NOT_FOUND", "Folder not found.", { folderId: id });
  }

  if (expectedType && folder.type !== expectedType) {
    throw new RepositoryError(
      "VALIDATION",
      expectedType === "knowledge"
        ? "Knowledge notes can only be stored in Knowledge folders."
        : "Exercises can only be stored in Exercise folders.",
      { folderId: id, expectedType, actualType: folder.type },
    );
  }

  return folder;
}

export function toFolderDto(folder: FolderRow): FolderDto {
  return {
    id: folder.id,
    parentId: folder.parentId,
    type: folder.type,
    name: folder.name,
    createdAt: folder.createdAt,
    updatedAt: folder.updatedAt,
  };
}
