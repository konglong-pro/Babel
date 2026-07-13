import { extractWikilinks, normalizeTitleKey } from "@babel-apps/markdown/core";
import { and, asc, desc, eq, isNull, ne } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { noteLinks, notes } from "@/lib/db/schema";
import type { BacklinkDto, NoteLinkDto, NoteTitleDto } from "@/lib/types";

import { assertPositiveId } from "./shared";

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

export function listOutgoingNoteLinks(
  noteId: number,
  transaction?: NoteLinkTransaction,
): NoteLinkDto[] {
  assertPositiveId(noteId, "noteId");
  return (transaction ?? db)
    .select({
      titleKey: noteLinks.targetTitleKey,
      targetId: noteLinks.targetNoteId,
    })
    .from(noteLinks)
    .where(eq(noteLinks.sourceNoteId, noteId))
    .orderBy(asc(noteLinks.targetTitleKey))
    .all();
}

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

export function listNoteTitles(query: string, limit = 20): NoteTitleDto[] {
  const queryKey = normalizeTitleKey(query);
  const rows = db
    .select({ id: notes.id, title: notes.title })
    .from(notes)
    .orderBy(asc(notes.id))
    .all();

  return rows
    .filter(({ title }) => normalizeTitleKey(title).includes(queryKey))
    .sort((left, right) =>
      left.title.localeCompare(right.title, "en-US", { sensitivity: "base" }) ||
      left.id - right.id
    )
    .slice(0, limit);
}

export function replaceSourceNoteLinks(
  transaction: NoteLinkTransaction,
  sourceNoteId: number,
  contentMd: string,
): void {
  transaction.delete(noteLinks).where(eq(noteLinks.sourceNoteId, sourceNoteId)).run();
  const extractedByKey = new Map(
    extractWikilinks(contentMd).map((wikilink) => [wikilink.titleKey, wikilink]),
  );
  if (extractedByKey.size === 0) return;

  const targets = titleTargets(
    transaction
      .select({ id: notes.id, title: notes.title })
      .from(notes)
      .orderBy(asc(notes.id))
      .all(),
  );
  transaction
    .insert(noteLinks)
    .values([...extractedByKey.keys()].map((targetTitleKey) => ({
      sourceNoteId,
      targetTitleKey,
      targetNoteId: targets.get(targetTitleKey) ?? null,
    })))
    .run();
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
    .where(and(
      eq(noteLinks.targetNoteId, noteId),
      ne(noteLinks.targetTitleKey, nextKey),
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
    const sourceRows = transaction
      .select({ id: notes.id, title: notes.title, contentMd: notes.contentMd })
      .from(notes)
      .orderBy(asc(notes.id))
      .all();
    const targets = titleTargets(sourceRows);
    const values: Array<{
      sourceNoteId: number;
      targetTitleKey: string;
      targetNoteId: number | null;
    }> = [];

    transaction.delete(noteLinks).run();
    for (const source of sourceRows) {
      const titleKeys = new Set(
        extractWikilinks(source.contentMd).map(({ titleKey }) => titleKey),
      );
      for (const targetTitleKey of titleKeys) {
        values.push({
          sourceNoteId: source.id,
          targetTitleKey,
          targetNoteId: targets.get(targetTitleKey) ?? null,
        });
      }
    }
    for (let offset = 0; offset < values.length; offset += 200) {
      transaction.insert(noteLinks).values(values.slice(offset, offset + 200)).run();
    }

    const unresolved = transaction
      .select({
        sourceId: notes.id,
        sourceTitle: notes.title,
        targetTitleKey: noteLinks.targetTitleKey,
      })
      .from(noteLinks)
      .innerJoin(notes, eq(noteLinks.sourceNoteId, notes.id))
      .where(isNull(noteLinks.targetNoteId))
      .orderBy(asc(notes.id), asc(noteLinks.targetTitleKey))
      .all();
    return { sources: sourceRows.length, links: values.length, unresolved };
  });
}

function resolveTitleKey(transaction: NoteLinkTransaction, titleKey: string): void {
  if (!titleKey) return;
  const targetId = transaction
    .select({ id: notes.id, title: notes.title })
    .from(notes)
    .orderBy(asc(notes.id))
    .all()
    .find(({ title }) => normalizeTitleKey(title) === titleKey)?.id ?? null;
  transaction
    .update(noteLinks)
    .set({ targetNoteId: targetId })
    .where(eq(noteLinks.targetTitleKey, titleKey))
    .run();
}

function titleTargets(rows: readonly { id: number; title: string }[]): Map<string, number> {
  const targets = new Map<string, number>();
  for (const row of rows) {
    const titleKey = normalizeTitleKey(row.title);
    if (!targets.has(titleKey)) targets.set(titleKey, row.id);
  }
  return targets;
}
