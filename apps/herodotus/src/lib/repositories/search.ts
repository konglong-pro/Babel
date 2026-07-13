import { desc, or, sql, type AnyColumn, type SQL } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { notes } from "@/lib/db/schema";
import type { SearchResultsDto } from "@/lib/types";

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
      parentId: row.parentId,
      folderId: row.folderId,
      title: row.title,
      tags: tagsFromJson(row.tags),
      updatedAt: row.updatedAt,
    }));
  return { notes: matches };
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function likeLiteral(column: AnyColumn, pattern: string): SQL {
  return sql`${column} LIKE ${pattern} ESCAPE ${"\\"}`;
}
