import { extractWikilinks, normalizeTitleKey } from "@babel-apps/markdown/core";
import { and, asc, desc, eq, isNull, ne } from "drizzle-orm";

import { db, sqlite } from "@/lib/db/client";
import { exercises, knowledgeNotes, noteLinks } from "@/lib/db/schema";
import type {
  BacklinksDto,
  LinkEntityKind,
  NoteLinkDto,
  NoteTitleDto,
} from "@/lib/types";

import { assertPositiveId } from "./shared";

// SQLite NOCASE is ASCII-only; the BINARY title index cannot preserve this normalizer.
sqlite.function("babel_normalize_title_key", { deterministic: true }, normalizeTitleKey);

export type NoteLinkTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

interface LinkTarget {
  id: number;
  kind: LinkEntityKind;
}

export interface UnresolvedNoteLink {
  sourceKind: LinkEntityKind;
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
  sourceKind: LinkEntityKind,
  sourceId: number,
  transaction?: NoteLinkTransaction,
): NoteLinkDto[] {
  assertPositiveId(sourceId, "sourceId");
  return (transaction ?? db)
    .select({
      titleKey: noteLinks.targetTitleKey,
      targetId: noteLinks.targetId,
      targetKind: noteLinks.targetKind,
    })
    .from(noteLinks)
    .where(
      and(
        eq(noteLinks.sourceKind, sourceKind),
        eq(noteLinks.sourceId, sourceId),
      ),
    )
    .orderBy(asc(noteLinks.targetTitleKey))
    .all();
}

export function listBacklinks(
  targetKind: LinkEntityKind,
  targetId: number,
): BacklinksDto {
  assertPositiveId(targetId, "targetId");
  const target = and(
    eq(noteLinks.targetKind, targetKind),
    eq(noteLinks.targetId, targetId),
  );
  return {
    knowledge: db
      .select({
        id: knowledgeNotes.id,
        title: knowledgeNotes.title,
        folderId: knowledgeNotes.folderId,
      })
      .from(noteLinks)
      .innerJoin(
        knowledgeNotes,
        and(
          eq(noteLinks.sourceKind, "knowledge"),
          eq(noteLinks.sourceId, knowledgeNotes.id),
        ),
      )
      .where(target)
      .orderBy(desc(knowledgeNotes.updatedAt), desc(knowledgeNotes.id))
      .all(),
    exercises: db
      .select({
        id: exercises.id,
        title: exercises.title,
        folderId: exercises.folderId,
      })
      .from(noteLinks)
      .innerJoin(
        exercises,
        and(
          eq(noteLinks.sourceKind, "exercise"),
          eq(noteLinks.sourceId, exercises.id),
        ),
      )
      .where(target)
      .orderBy(desc(exercises.updatedAt), desc(exercises.id))
      .all(),
  };
}

export function listNoteTitles(query: string, limit = 20): NoteTitleDto[] {
  const pattern = `${escapeLike(normalizeTitleKey(query))}%`;
  return sqlite
    .prepare(
      `SELECT "id", "title", "kind"
       FROM (
         SELECT "id", "title", 'knowledge' AS "kind", 0 AS "kind_priority"
         FROM "knowledge_note"
         WHERE babel_normalize_title_key("title") LIKE ? ESCAPE '\\'
         UNION ALL
         SELECT "id", "title", 'exercise' AS "kind", 1 AS "kind_priority"
         FROM "exercise"
         WHERE babel_normalize_title_key("title") LIKE ? ESCAPE '\\'
       )
       ORDER BY "title" COLLATE NOCASE, "kind_priority", "id"
       LIMIT ?`,
    )
    .all(pattern, pattern, limit) as NoteTitleDto[];
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

export function replaceSourceNoteLinks(
  transaction: NoteLinkTransaction,
  sourceKind: LinkEntityKind,
  sourceId: number,
  markdownSources: readonly string[],
): void {
  transaction
    .delete(noteLinks)
    .where(
      and(
        eq(noteLinks.sourceKind, sourceKind),
        eq(noteLinks.sourceId, sourceId),
      ),
    )
    .run();
  const titleKeys = new Set(
    markdownSources.flatMap((markdown) =>
      extractWikilinks(markdown).map(({ titleKey }) => titleKey),
    ),
  );
  if (titleKeys.size === 0) return;

  const targets = titleTargets(transaction);
  transaction
    .insert(noteLinks)
    .values([...titleKeys].map((targetTitleKey) => {
      const target = targets.get(targetTitleKey);
      return {
        sourceKind,
        sourceId,
        targetTitleKey,
        targetKind: target?.kind ?? null,
        targetId: target?.id ?? null,
      };
    }))
    .run();
}

export function reconcileNoteTitleChange(
  transaction: NoteLinkTransaction,
  targetKind: LinkEntityKind,
  targetId: number,
  previousTitle: string,
  nextTitle: string,
): void {
  const previousKey = normalizeTitleKey(previousTitle);
  const nextKey = normalizeTitleKey(nextTitle);
  if (previousKey === nextKey) return;

  transaction
    .update(noteLinks)
    .set({ targetKind: null, targetId: null })
    .where(
      and(
        eq(noteLinks.targetKind, targetKind),
        eq(noteLinks.targetId, targetId),
        ne(noteLinks.targetTitleKey, nextKey),
      ),
    )
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

export function deleteEntityLinks(
  transaction: NoteLinkTransaction,
  kind: LinkEntityKind,
  id: number,
  title: string,
): void {
  transaction
    .delete(noteLinks)
    .where(and(eq(noteLinks.sourceKind, kind), eq(noteLinks.sourceId, id)))
    .run();
  transaction
    .update(noteLinks)
    .set({ targetKind: null, targetId: null })
    .where(and(eq(noteLinks.targetKind, kind), eq(noteLinks.targetId, id)))
    .run();
  resolveIncomingLinksForTitle(transaction, title);
}

export function rebuildAllNoteLinks(): RebuildNoteLinksResult {
  return db.transaction((transaction) => {
    const knowledge = transaction
      .select({
        id: knowledgeNotes.id,
        title: knowledgeNotes.title,
        contentMd: knowledgeNotes.contentMd,
      })
      .from(knowledgeNotes)
      .orderBy(asc(knowledgeNotes.id))
      .all();
    const exerciseRows = transaction
      .select({
        id: exercises.id,
        title: exercises.title,
        answerMd: exercises.answerMd,
        solutionMd: exercises.solutionMd,
      })
      .from(exercises)
      .orderBy(asc(exercises.id))
      .all();
    const targets = targetsFromRows(knowledge, exerciseRows);
    const values: Array<{
      sourceKind: LinkEntityKind;
      sourceId: number;
      targetTitleKey: string;
      targetKind: LinkEntityKind | null;
      targetId: number | null;
    }> = [];

    transaction.delete(noteLinks).run();
    for (const source of knowledge) {
      appendSourceValues(
        values,
        targets,
        "knowledge",
        source.id,
        [source.contentMd],
      );
    }
    for (const source of exerciseRows) {
      appendSourceValues(
        values,
        targets,
        "exercise",
        source.id,
        [source.answerMd, source.solutionMd],
      );
    }
    for (let offset = 0; offset < values.length; offset += 200) {
      transaction.insert(noteLinks).values(values.slice(offset, offset + 200)).run();
    }

    const unresolvedRows = transaction
      .select({
        sourceKind: noteLinks.sourceKind,
        sourceId: noteLinks.sourceId,
        targetTitleKey: noteLinks.targetTitleKey,
      })
      .from(noteLinks)
      .where(isNull(noteLinks.targetId))
      .orderBy(
        asc(noteLinks.sourceKind),
        asc(noteLinks.sourceId),
        asc(noteLinks.targetTitleKey),
      )
      .all();
    const knowledgeTitles = new Map(knowledge.map(({ id, title }) => [id, title]));
    const exerciseTitles = new Map(exerciseRows.map(({ id, title }) => [id, title]));
    return {
      sources: knowledge.length + exerciseRows.length,
      links: values.length,
      unresolved: unresolvedRows.map((row) => ({
        ...row,
        sourceTitle: row.sourceKind === "knowledge"
          ? (knowledgeTitles.get(row.sourceId) ?? "")
          : (exerciseTitles.get(row.sourceId) ?? ""),
      })),
    };
  });
}

function appendSourceValues(
  values: Array<{
    sourceKind: LinkEntityKind;
    sourceId: number;
    targetTitleKey: string;
    targetKind: LinkEntityKind | null;
    targetId: number | null;
  }>,
  targets: ReadonlyMap<string, LinkTarget>,
  sourceKind: LinkEntityKind,
  sourceId: number,
  markdownSources: readonly string[],
): void {
  const titleKeys = new Set(
    markdownSources.flatMap((markdown) =>
      extractWikilinks(markdown).map(({ titleKey }) => titleKey),
    ),
  );
  for (const targetTitleKey of titleKeys) {
    const target = targets.get(targetTitleKey);
    values.push({
      sourceKind,
      sourceId,
      targetTitleKey,
      targetKind: target?.kind ?? null,
      targetId: target?.id ?? null,
    });
  }
}

function resolveTitleKey(
  transaction: NoteLinkTransaction,
  titleKey: string,
): void {
  if (!titleKey) return;
  const target = titleTargets(transaction).get(titleKey);
  transaction
    .update(noteLinks)
    .set({
      targetKind: target?.kind ?? null,
      targetId: target?.id ?? null,
    })
    .where(eq(noteLinks.targetTitleKey, titleKey))
    .run();
}

function titleTargets(transaction: NoteLinkTransaction): Map<string, LinkTarget> {
  return targetsFromRows(
    transaction
      .select({ id: knowledgeNotes.id, title: knowledgeNotes.title })
      .from(knowledgeNotes)
      .orderBy(asc(knowledgeNotes.id))
      .all(),
    transaction
      .select({ id: exercises.id, title: exercises.title })
      .from(exercises)
      .orderBy(asc(exercises.id))
      .all(),
  );
}

function targetsFromRows(
  knowledge: readonly { id: number; title: string }[],
  exerciseRows: readonly { id: number; title: string }[],
): Map<string, LinkTarget> {
  const targets = new Map<string, LinkTarget>();
  for (const row of knowledge) {
    const titleKey = normalizeTitleKey(row.title);
    if (!targets.has(titleKey)) {
      targets.set(titleKey, { kind: "knowledge", id: row.id });
    }
  }
  for (const row of exerciseRows) {
    const titleKey = normalizeTitleKey(row.title);
    if (!targets.has(titleKey)) {
      targets.set(titleKey, { kind: "exercise", id: row.id });
    }
  }
  return targets;
}
