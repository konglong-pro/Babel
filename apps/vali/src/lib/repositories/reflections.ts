import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { noteImages, reflections } from "@/lib/db/schema";
import type { ReflectionDetailDto, ReflectionSummaryDto } from "@/lib/types";

import { RepositoryError } from "./errors";
import {
  listOutgoingReflectionLinks,
  replaceSourceReflectionLinks,
  resolveIncomingLinksForTitle,
} from "./links";
import {
  assertManagedImageOwnership,
  assertPreparedImageRemoval,
  normalizeNewImagePaths,
} from "./notes";
import { normalizeMarkdown } from "./shared";

type ReflectionRow = typeof reflections.$inferSelect;

export interface UpdatedReflectionResult {
  reflection: ReflectionDetailDto;
  removedImagePaths: string[];
}

export function normalizeReflectionDate(value: unknown): string {
  if (typeof value !== "string") {
    throw new RepositoryError("VALIDATION", "date must be a YYYY-MM-DD string.", {
      field: "date",
    });
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new RepositoryError("VALIDATION", "date must use YYYY-MM-DD.", {
      field: "date",
    });
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) {
    throw new RepositoryError("VALIDATION", "date must be a valid calendar day.", {
      field: "date",
    });
  }
  return value;
}

export function listReflections(): ReflectionSummaryDto[] {
  return db
    .select()
    .from(reflections)
    .orderBy(desc(reflections.date))
    .all()
    .map(toSummary);
}

export function getReflection(date: string): ReflectionDetailDto | null {
  const normalizedDate = normalizeReflectionDate(date);
  const row = db
    .select()
    .from(reflections)
    .where(eq(reflections.date, normalizedDate))
    .get();
  return row
    ? toDetail(row, listOutgoingReflectionLinks(normalizedDate))
    : null;
}

export function listReflectionImagePaths(date: string): string[] {
  const normalizedDate = normalizeReflectionDate(date);
  return db
    .select({ imagePath: noteImages.imagePath })
    .from(noteImages)
    .where(eq(noteImages.reflectionDate, normalizedDate))
    .all()
    .map(({ imagePath }) => imagePath);
}

export function saveReflection(
  date: string,
  contentMd: string,
  newImagePaths: readonly string[] = [],
  expectedRemovedImagePaths?: readonly string[],
): UpdatedReflectionResult {
  const normalizedDate = normalizeReflectionDate(date);
  const normalizedContent = normalizeMarkdown(contentMd, "contentMd");
  const imagePaths = normalizeNewImagePaths(newImagePaths);
  const current = db
    .select()
    .from(reflections)
    .where(eq(reflections.date, normalizedDate))
    .get();
  const ownedImagePaths = current ? listReflectionImagePaths(normalizedDate) : [];
  const referencedImagePaths = assertManagedImageOwnership(
    normalizedContent,
    ownedImagePaths,
    imagePaths,
  );
  const removedImagePaths = ownedImagePaths.filter(
    (imagePath) => !referencedImagePaths.has(imagePath),
  );
  assertPreparedImageRemoval(removedImagePaths, expectedRemovedImagePaths);

  const row = db.transaction((transaction) => {
    const saved = current
      ? transaction
          .update(reflections)
          .set({
            contentMd: normalizedContent,
            updatedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
          })
          .where(eq(reflections.date, normalizedDate))
          .returning()
          .get()
      : transaction
          .insert(reflections)
          .values({ date: normalizedDate, contentMd: normalizedContent })
          .returning()
          .get();
    if (removedImagePaths.length > 0) {
      transaction
        .delete(noteImages)
        .where(and(
          eq(noteImages.reflectionDate, normalizedDate),
          inArray(noteImages.imagePath, removedImagePaths),
        ))
        .run();
    }
    if (imagePaths.length > 0) {
      transaction
        .insert(noteImages)
        .values(imagePaths.map((imagePath) => ({
          reflectionDate: normalizedDate,
          imagePath,
        })))
        .run();
    }
    replaceSourceReflectionLinks(transaction, normalizedDate, normalizedContent);
    resolveIncomingLinksForTitle(transaction, normalizedDate);
    return saved;
  });

  return {
    reflection: toDetail(row, listOutgoingReflectionLinks(normalizedDate)),
    removedImagePaths,
  };
}

function toSummary(row: ReflectionRow): ReflectionSummaryDto {
  return {
    kind: "reflection",
    date: row.date,
    title: row.date,
    updatedAt: row.updatedAt,
  };
}

function toDetail(
  row: ReflectionRow,
  links: ReflectionDetailDto["links"],
): ReflectionDetailDto {
  return {
    ...toSummary(row),
    contentMd: row.contentMd,
    createdAt: row.createdAt,
    links,
  };
}
