import { desc, or, sql, type AnyColumn, type SQL } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { notes, reflections } from "@/lib/db/schema";
import type { DocumentSearchResultsDto, SearchResultsDto } from "@/lib/types";

import { tagsFromJson } from "./shared";

export function searchNotes(query: string): SearchResultsDto {
  const normalized = typeof query === "string" ? query.trim() : "";
  if (!normalized) return { notes: [] };

  const pattern = `%${escapeLike(normalized)}%`;
  const matches = db
    .select()
    .from(notes)
    .where(
      or(
        likeLiteral(notes.title, pattern),
        likeLiteral(notes.contentMd, pattern),
        likeLiteral(notes.tags, pattern),
      ),
    )
    .orderBy(desc(notes.updatedAt), desc(notes.id))
    .all()
    .map((row) => ({
      id: row.id,
      folderId: row.folderId,
      parentId: row.parentId,
      title: row.title,
      tags: tagsFromJson(row.tags),
      updatedAt: row.updatedAt,
    }));
  return { notes: matches };
}

export function searchDocuments(query: string): DocumentSearchResultsDto {
  const normalized = typeof query === "string" ? query.trim() : "";
  if (!normalized) return { results: [] };

  const pattern = `%${escapeLike(normalized)}%`;
  const noteMatches = db
    .select()
    .from(notes)
    .where(or(
      likeLiteral(notes.title, pattern),
      likeLiteral(notes.contentMd, pattern),
      likeLiteral(notes.tags, pattern),
    ))
    .all()
    .map((row) => ({
      kind: "note" as const,
      id: row.id,
      folderId: row.folderId,
      parentId: row.parentId,
      title: row.title,
      tags: tagsFromJson(row.tags),
      updatedAt: row.updatedAt,
    }));
  const reflectionMatches = db
    .select()
    .from(reflections)
    .where(or(
      likeLiteral(reflections.date, pattern),
      likeLiteral(reflections.contentMd, pattern),
    ))
    .all()
    .map((row) => ({
      kind: "reflection" as const,
      date: row.date,
      title: row.date,
      updatedAt: row.updatedAt,
    }));

  return {
    results: [...noteMatches, ...reflectionMatches].sort((left, right) => {
      const byUpdated = right.updatedAt.localeCompare(left.updatedAt);
      if (byUpdated !== 0) return byUpdated;
      if (left.kind !== right.kind) return left.kind === "note" ? -1 : 1;
      return left.title.localeCompare(right.title);
    }),
  };
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function likeLiteral(column: AnyColumn, pattern: string): SQL {
  return sql`${column} LIKE ${pattern} ESCAPE ${"\\"}`;
}
