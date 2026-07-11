import { asc, desc, or, sql, type AnyColumn, type SQL } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { exercises, knowledgeNotes } from "@/lib/db/schema";
import type { SearchResultsDto } from "@/lib/types";

import { tagsFromJson } from "./shared";

export function searchArchive(query: string): SearchResultsDto {
  const normalized = typeof query === "string" ? query.trim() : "";
  if (!normalized) {
    return { knowledge: [], exercises: [] };
  }

  const pattern = `%${escapeLike(normalized)}%`;
  const knowledge = db
    .select()
    .from(knowledgeNotes)
    .where(
      or(
        likeLiteral(knowledgeNotes.title, pattern),
        likeLiteral(knowledgeNotes.contentMd, pattern),
        likeLiteral(knowledgeNotes.tags, pattern),
      ),
    )
    .orderBy(desc(knowledgeNotes.updatedAt), asc(knowledgeNotes.title))
    .all()
    .map((row) => ({
      id: row.id,
      folderId: row.folderId,
      title: row.title,
      tags: tagsFromJson(row.tags),
      updatedAt: row.updatedAt,
    }));

  const matchingExercises = db
    .select()
    .from(exercises)
    .where(
      or(
        likeLiteral(exercises.title, pattern),
        likeLiteral(exercises.solutionMd, pattern),
        likeLiteral(exercises.tags, pattern),
      ),
    )
    .orderBy(desc(exercises.updatedAt), asc(exercises.title))
    .all()
    .map((row) => ({
      id: row.id,
      folderId: row.folderId,
      title: row.title,
      imagePath: row.imagePath,
      tags: tagsFromJson(row.tags),
      updatedAt: row.updatedAt,
    }));

  return { knowledge, exercises: matchingExercises };
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function likeLiteral(column: AnyColumn, pattern: string): SQL {
  return sql`${column} LIKE ${pattern} ESCAPE ${"\\"}`;
}
