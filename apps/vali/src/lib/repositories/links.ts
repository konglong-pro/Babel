import { extractWikilinks, normalizeTitleKey } from "@babel-apps/markdown/core";
import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";

import { db, sqlite } from "@/lib/db/client";
import {
  noteLinks,
  notes,
  reflectionLinks,
  reflections,
} from "@/lib/db/schema";
import type {
  BacklinkDto,
  DocumentBacklinkDto,
  DocumentTitleDto,
  NoteLinkDto,
  NoteTitleDto,
} from "@/lib/types";

import { assertPositiveId } from "./shared";

// SQLite NOCASE is ASCII-only; the BINARY title index cannot preserve this normalizer.
sqlite.function("babel_normalize_title_key", { deterministic: true }, normalizeTitleKey);

export type NoteLinkTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface UnresolvedNoteLink {
  sourceId: number;
  sourceTitle: string;
  targetTitleKey: string;
}

export interface RebuildNoteLinksResult {
  sources: number;
  links: number;
  unresolved: UnresolvedNoteLink[];
}

interface TargetReference {
  noteId: number | null;
  reflectionDate: string | null;
}

export function listOutgoingNoteLinks(
  noteId: number,
  transaction?: NoteLinkTransaction,
): NoteLinkDto[] {
  assertPositiveId(noteId, "noteId");
  return (transaction ?? db)
    .select({
      titleKey: noteLinks.targetTitleKey,
      targetId: noteLinks.targetNoteId,
      targetDate: noteLinks.targetReflectionDate,
    })
    .from(noteLinks)
    .where(eq(noteLinks.sourceNoteId, noteId))
    .orderBy(asc(noteLinks.targetTitleKey))
    .all()
    .map(toLinkDto);
}

export function listOutgoingReflectionLinks(
  date: string,
  transaction?: NoteLinkTransaction,
): NoteLinkDto[] {
  return (transaction ?? db)
    .select({
      titleKey: reflectionLinks.targetTitleKey,
      targetId: reflectionLinks.targetNoteId,
      targetDate: reflectionLinks.targetReflectionDate,
    })
    .from(reflectionLinks)
    .where(eq(reflectionLinks.sourceReflectionDate, date))
    .orderBy(asc(reflectionLinks.targetTitleKey))
    .all()
    .map(toLinkDto);
}

function toLinkDto(row: {
  titleKey: string;
  targetId: number | null;
  targetDate: string | null;
}): NoteLinkDto {
  return row.targetDate === null
    ? { titleKey: row.titleKey, targetId: row.targetId }
    : {
        titleKey: row.titleKey,
        targetId: null,
        targetKind: "reflection",
        targetDate: row.targetDate,
      };
}

/** Note-only compatibility helper retained for repository callers. */
export function listBacklinks(noteId: number): BacklinkDto[] {
  assertPositiveId(noteId, "noteId");
  return db
    .select({ id: notes.id, title: notes.title, folderId: notes.folderId })
    .from(noteLinks)
    .innerJoin(notes, eq(noteLinks.sourceNoteId, notes.id))
    .where(eq(noteLinks.targetNoteId, noteId))
    .orderBy(desc(notes.updatedAt), desc(notes.id))
    .all();
}

export function listDocumentBacklinksForNote(noteId: number): DocumentBacklinkDto[] {
  assertPositiveId(noteId, "noteId");
  const noteSources = db
    .select({
      id: notes.id,
      title: notes.title,
      folderId: notes.folderId,
      updatedAt: notes.updatedAt,
    })
    .from(noteLinks)
    .innerJoin(notes, eq(noteLinks.sourceNoteId, notes.id))
    .where(eq(noteLinks.targetNoteId, noteId))
    .all()
    .map(({ updatedAt, ...source }) => ({ ...source, kind: "note" as const, updatedAt }));
  const reflectionSources = db
    .select({
      date: reflections.date,
      updatedAt: reflections.updatedAt,
    })
    .from(reflectionLinks)
    .innerJoin(
      reflections,
      eq(reflectionLinks.sourceReflectionDate, reflections.date),
    )
    .where(eq(reflectionLinks.targetNoteId, noteId))
    .all()
    .map((source) => ({
      ...source,
      kind: "reflection" as const,
      title: source.date,
    }));
  return sortBacklinks([...noteSources, ...reflectionSources]);
}

export function listDocumentBacklinksForReflection(
  date: string,
): DocumentBacklinkDto[] {
  const noteSources = db
    .select({
      id: notes.id,
      title: notes.title,
      folderId: notes.folderId,
      updatedAt: notes.updatedAt,
    })
    .from(noteLinks)
    .innerJoin(notes, eq(noteLinks.sourceNoteId, notes.id))
    .where(eq(noteLinks.targetReflectionDate, date))
    .all()
    .map(({ updatedAt, ...source }) => ({ ...source, kind: "note" as const, updatedAt }));
  const reflectionSources = db
    .select({
      date: reflections.date,
      updatedAt: reflections.updatedAt,
    })
    .from(reflectionLinks)
    .innerJoin(
      reflections,
      eq(reflectionLinks.sourceReflectionDate, reflections.date),
    )
    .where(eq(reflectionLinks.targetReflectionDate, date))
    .all()
    .map((source) => ({
      ...source,
      kind: "reflection" as const,
      title: source.date,
    }));
  return sortBacklinks([...noteSources, ...reflectionSources]);
}

type SortableBacklink =
  | ({ kind: "note"; updatedAt: string } & BacklinkDto)
  | Extract<DocumentBacklinkDto, { kind: "reflection" }>;

function sortBacklinks(
  rows: SortableBacklink[],
): DocumentBacklinkDto[] {
  return rows
    .sort((left, right) => {
      const byUpdated = right.updatedAt.localeCompare(left.updatedAt);
      if (byUpdated !== 0) return byUpdated;
      return left.title.localeCompare(right.title);
    })
    .map((row) => {
      if (row.kind === "reflection") return row;
      return {
        kind: "note" as const,
        id: row.id,
        title: row.title,
        folderId: row.folderId,
      };
    });
}

/** Note-only compatibility helper retained for repository callers. */
export function listNoteTitles(query: string, limit = 20): NoteTitleDto[] {
  const pattern = `${escapeLike(normalizeTitleKey(query))}%`;
  return db
    .select({ id: notes.id, title: notes.title })
    .from(notes)
    .where(sql`babel_normalize_title_key(${notes.title}) LIKE ${pattern} ESCAPE ${"\\"}`)
    .orderBy(sql`${notes.title} COLLATE NOCASE`, asc(notes.id))
    .limit(limit)
    .all();
}

export function listDocumentTitles(query: string, limit = 20): DocumentTitleDto[] {
  const normalizedQuery = normalizeTitleKey(query);
  const pattern = `${escapeLike(normalizedQuery)}%`;
  const noteRows = db
    .select({ id: notes.id, title: notes.title })
    .from(notes)
    .where(sql`babel_normalize_title_key(${notes.title}) LIKE ${pattern} ESCAPE ${"\\"}`)
    .orderBy(sql`${notes.title} COLLATE NOCASE`, asc(notes.id))
    .all();
  const noteKeys = new Set(
    db.select({ title: notes.title }).from(notes).all().map(({ title }) => normalizeTitleKey(title)),
  );
  const reflectionRows = db
    .select({ date: reflections.date })
    .from(reflections)
    .where(sql`${reflections.date} LIKE ${pattern} ESCAPE ${"\\"}`)
    .orderBy(desc(reflections.date))
    .all()
    .filter(({ date }) => !noteKeys.has(normalizeTitleKey(date)));
  return [
    ...noteRows.map((row) => ({ ...row, kind: "note" as const })),
    ...reflectionRows.map(({ date }) => ({
      kind: "reflection" as const,
      id: Number(date.replaceAll("-", "")),
      date,
      title: date,
    })),
  ].slice(0, limit);
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

export function replaceSourceNoteLinks(
  transaction: NoteLinkTransaction,
  sourceNoteId: number,
  contentMd: string,
): void {
  transaction.delete(noteLinks).where(eq(noteLinks.sourceNoteId, sourceNoteId)).run();
  const extracted = extractedTitleKeys(contentMd);
  if (extracted.length === 0) return;
  const targets = titleTargets(transaction);
  transaction
    .insert(noteLinks)
    .values(extracted.map((targetTitleKey) => ({
      sourceNoteId,
      targetTitleKey,
      targetNoteId: targets.get(targetTitleKey)?.noteId ?? null,
      targetReflectionDate: targets.get(targetTitleKey)?.reflectionDate ?? null,
    })))
    .run();
}

export function replaceSourceReflectionLinks(
  transaction: NoteLinkTransaction,
  sourceReflectionDate: string,
  contentMd: string,
): void {
  transaction
    .delete(reflectionLinks)
    .where(eq(reflectionLinks.sourceReflectionDate, sourceReflectionDate))
    .run();
  const extracted = extractedTitleKeys(contentMd);
  if (extracted.length === 0) return;
  const targets = titleTargets(transaction);
  transaction
    .insert(reflectionLinks)
    .values(extracted.map((targetTitleKey) => ({
      sourceReflectionDate,
      targetTitleKey,
      targetNoteId: targets.get(targetTitleKey)?.noteId ?? null,
      targetReflectionDate: targets.get(targetTitleKey)?.reflectionDate ?? null,
    })))
    .run();
}

function extractedTitleKeys(contentMd: string): string[] {
  return [...new Map(
    extractWikilinks(contentMd).map((wikilink) => [wikilink.titleKey, wikilink]),
  ).keys()];
}

export function reconcileNoteTitleChange(
  transaction: NoteLinkTransaction,
  noteId: number,
  previousTitle: string,
  nextTitle: string,
): void {
  const previousKey = normalizeTitleKey(previousTitle);
  const nextKey = normalizeTitleKey(nextTitle);
  if (previousKey === nextKey) return;

  transaction
    .update(noteLinks)
    .set({ targetNoteId: null })
    .where(and(eq(noteLinks.targetNoteId, noteId), ne(noteLinks.targetTitleKey, nextKey)))
    .run();
  transaction
    .update(reflectionLinks)
    .set({ targetNoteId: null })
    .where(and(
      eq(reflectionLinks.targetNoteId, noteId),
      ne(reflectionLinks.targetTitleKey, nextKey),
    ))
    .run();
  resolveTitleKey(transaction, previousKey);
  resolveTitleKey(transaction, nextKey);
}

export function resolveIncomingLinksForTitle(
  transaction: NoteLinkTransaction,
  title: string,
): void {
  resolveTitleKey(transaction, normalizeTitleKey(title));
}

export function rebuildAllNoteLinks(): RebuildNoteLinksResult {
  return db.transaction((transaction) => {
    const noteSources = transaction
      .select({ id: notes.id, title: notes.title, contentMd: notes.contentMd })
      .from(notes)
      .orderBy(asc(notes.id))
      .all();
    const reflectionSources = transaction
      .select({ date: reflections.date, contentMd: reflections.contentMd })
      .from(reflections)
      .orderBy(asc(reflections.date))
      .all();
    const targets = titleTargets(transaction);
    const noteValues = noteSources.flatMap((source) =>
      extractedTitleKeys(source.contentMd).map((targetTitleKey) => ({
        sourceNoteId: source.id,
        targetTitleKey,
        targetNoteId: targets.get(targetTitleKey)?.noteId ?? null,
        targetReflectionDate: targets.get(targetTitleKey)?.reflectionDate ?? null,
      })),
    );
    const reflectionValues = reflectionSources.flatMap((source) =>
      extractedTitleKeys(source.contentMd).map((targetTitleKey) => ({
        sourceReflectionDate: source.date,
        targetTitleKey,
        targetNoteId: targets.get(targetTitleKey)?.noteId ?? null,
        targetReflectionDate: targets.get(targetTitleKey)?.reflectionDate ?? null,
      })),
    );

    transaction.delete(noteLinks).run();
    transaction.delete(reflectionLinks).run();
    for (let offset = 0; offset < noteValues.length; offset += 200) {
      transaction.insert(noteLinks).values(noteValues.slice(offset, offset + 200)).run();
    }
    for (let offset = 0; offset < reflectionValues.length; offset += 200) {
      transaction
        .insert(reflectionLinks)
        .values(reflectionValues.slice(offset, offset + 200))
        .run();
    }

    const unresolved = transaction
      .select({
        sourceId: notes.id,
        sourceTitle: notes.title,
        targetTitleKey: noteLinks.targetTitleKey,
      })
      .from(noteLinks)
      .innerJoin(notes, eq(noteLinks.sourceNoteId, notes.id))
      .where(and(isNull(noteLinks.targetNoteId), isNull(noteLinks.targetReflectionDate)))
      .orderBy(asc(notes.id), asc(noteLinks.targetTitleKey))
      .all();
    return {
      sources: noteSources.length,
      links: noteValues.length,
      unresolved,
    };
  });
}

function resolveTitleKey(transaction: NoteLinkTransaction, titleKey: string): void {
  if (!titleKey) return;
  const target = titleTargets(transaction).get(titleKey) ?? {
    noteId: null,
    reflectionDate: null,
  };
  transaction
    .update(noteLinks)
    .set({
      targetNoteId: target.noteId,
      targetReflectionDate: target.reflectionDate,
    })
    .where(eq(noteLinks.targetTitleKey, titleKey))
    .run();
  transaction
    .update(reflectionLinks)
    .set({
      targetNoteId: target.noteId,
      targetReflectionDate: target.reflectionDate,
    })
    .where(eq(reflectionLinks.targetTitleKey, titleKey))
    .run();
}

function titleTargets(transaction: NoteLinkTransaction): Map<string, TargetReference> {
  const targets = new Map<string, TargetReference>();
  for (const row of transaction
    .select({ id: notes.id, title: notes.title })
    .from(notes)
    .orderBy(asc(notes.id))
    .all()) {
    const titleKey = normalizeTitleKey(row.title);
    if (!targets.has(titleKey)) {
      targets.set(titleKey, { noteId: row.id, reflectionDate: null });
    }
  }
  for (const row of transaction
    .select({ date: reflections.date })
    .from(reflections)
    .orderBy(asc(reflections.date))
    .all()) {
    const titleKey = normalizeTitleKey(row.date);
    if (!targets.has(titleKey)) {
      targets.set(titleKey, { noteId: null, reflectionDate: row.date });
    }
  }
  return targets;
}
