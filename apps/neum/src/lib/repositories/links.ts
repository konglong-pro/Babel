import type BetterSqlite3 from "better-sqlite3";

import { extractWikilinks, normalizeTitleKey } from "@babel-apps/markdown/core";

import { getNeumDatabase } from "@/lib/db/client";
import type {
  EntryBacklinkDto,
  EntryKind,
  EntryLinkDto,
  EntryTitleDto,
} from "@/lib/types";

import { assertPositiveId } from "./shared";

interface EntryTitleRow {
  id: number;
  kind: EntryKind;
  title: string;
}

interface EntrySourceRow extends EntryTitleRow {
  notesMd: string;
}

export interface UnresolvedEntryLink {
  sourceId: number;
  sourceTitle: string;
  targetTitleKey: string;
}

export interface RebuildEntryLinksResult {
  sources: number;
  links: number;
  unresolved: UnresolvedEntryLink[];
}

export function listOutgoingEntryLinks(
  entryId: number,
  sqlite: BetterSqlite3.Database = getNeumDatabase().sqlite,
): EntryLinkDto[] {
  assertPositiveId(entryId, "entryId");
  return sqlite
    .prepare(
      `SELECT link.target_title_key AS titleKey,
              link.target_entry_id AS targetId,
              target.kind AS targetKind
       FROM entry_link AS link
       LEFT JOIN entry AS target ON target.id = link.target_entry_id
       WHERE link.source_entry_id = ?
       ORDER BY link.target_title_key`,
    )
    .all(entryId) as EntryLinkDto[];
}

export function listEntryBacklinks(entryId: number): EntryBacklinkDto[] {
  assertPositiveId(entryId, "entryId");
  return getNeumDatabase().sqlite
    .prepare(
      `SELECT source.id,
              source.folder_id AS folderId,
              source.kind,
              source.title
       FROM entry_link AS link
       INNER JOIN entry AS source ON source.id = link.source_entry_id
       WHERE link.target_entry_id = ?
       ORDER BY source.updated_at DESC, source.id DESC`,
    )
    .all(entryId) as EntryBacklinkDto[];
}

export function listEntryTitles(query: string, limit = 20): EntryTitleDto[] {
  const queryKey = normalizeTitleKey(query);
  const rows = getNeumDatabase().sqlite
    .prepare('SELECT "id", "kind", "title" FROM "entry" ORDER BY "id"')
    .all() as EntryTitleRow[];

  return rows
    .filter(({ title }) => normalizeTitleKey(title).includes(queryKey))
    .sort(
      (left, right) =>
        left.title.localeCompare(right.title, "en-US", { sensitivity: "base" }) ||
        left.id - right.id,
    )
    .slice(0, limit);
}

export function replaceSourceEntryLinks(
  sqlite: BetterSqlite3.Database,
  sourceEntryId: number,
  notesMd: string,
): void {
  sqlite
    .prepare('DELETE FROM "entry_link" WHERE "source_entry_id" = ?')
    .run(sourceEntryId);
  const titleKeys = new Set(
    extractWikilinks(notesMd).map(({ titleKey }) => titleKey),
  );
  if (titleKeys.size === 0) return;

  const targets = titleTargets(readEntryTitles(sqlite));
  const insert = sqlite.prepare(
    `INSERT INTO "entry_link"
      ("source_entry_id", "target_title_key", "target_entry_id")
     VALUES (?, ?, ?)`,
  );
  for (const targetTitleKey of titleKeys) {
    insert.run(
      sourceEntryId,
      targetTitleKey,
      targets.get(targetTitleKey) ?? null,
    );
  }
}

export function reconcileEntryTitleChange(
  sqlite: BetterSqlite3.Database,
  entryId: number,
  previousTitle: string,
  nextTitle: string,
): void {
  const previousKey = normalizeTitleKey(previousTitle);
  const nextKey = normalizeTitleKey(nextTitle);
  if (previousKey === nextKey) return;

  sqlite
    .prepare(
      `UPDATE "entry_link"
       SET "target_entry_id" = NULL
       WHERE "target_entry_id" = ? AND "target_title_key" <> ?`,
    )
    .run(entryId, nextKey);
  resolveTitleKey(sqlite, previousKey);
  resolveTitleKey(sqlite, nextKey);
}

export function resolveIncomingLinksForTitle(
  sqlite: BetterSqlite3.Database,
  title: string,
): void {
  resolveTitleKey(sqlite, normalizeTitleKey(title));
}

export function rebuildAllEntryLinks(): RebuildEntryLinksResult {
  const { sqlite } = getNeumDatabase();
  return sqlite.transaction(() => rebuildAllEntryLinksInTransaction(sqlite))();
}

/** Rebuilds the derived index while the caller owns the connection transaction. */
export function rebuildAllEntryLinksInTransaction(
  sqlite: BetterSqlite3.Database,
): RebuildEntryLinksResult {
  const sources = sqlite
    .prepare(
      `SELECT "id", "kind", "title", "notes_md" AS notesMd
       FROM "entry"
       ORDER BY "id"`,
    )
    .all() as EntrySourceRow[];
  const targets = titleTargets(sources);
  const insert = sqlite.prepare(
    `INSERT INTO "entry_link"
      ("source_entry_id", "target_title_key", "target_entry_id")
     VALUES (?, ?, ?)`,
  );
  let linkCount = 0;

  sqlite.prepare('DELETE FROM "entry_link"').run();
  for (const source of sources) {
    const titleKeys = new Set(
      extractWikilinks(source.notesMd).map(({ titleKey }) => titleKey),
    );
    for (const targetTitleKey of titleKeys) {
      insert.run(
        source.id,
        targetTitleKey,
        targets.get(targetTitleKey) ?? null,
      );
      linkCount += 1;
    }
  }

  const unresolved = sqlite
    .prepare(
      `SELECT source.id AS sourceId,
              source.title AS sourceTitle,
              link.target_title_key AS targetTitleKey
       FROM "entry_link" AS link
       INNER JOIN "entry" AS source ON source.id = link.source_entry_id
       WHERE link.target_entry_id IS NULL
       ORDER BY source.id, link.target_title_key`,
    )
    .all() as UnresolvedEntryLink[];
  return { sources: sources.length, links: linkCount, unresolved };
}

function resolveTitleKey(
  sqlite: BetterSqlite3.Database,
  titleKey: string,
): void {
  if (!titleKey) return;
  const targetId = readEntryTitles(sqlite).find(
    ({ title }) => normalizeTitleKey(title) === titleKey,
  )?.id ?? null;
  sqlite
    .prepare(
      `UPDATE "entry_link"
       SET "target_entry_id" = ?
       WHERE "target_title_key" = ?`,
    )
    .run(targetId, titleKey);
}

function readEntryTitles(sqlite: BetterSqlite3.Database): EntryTitleRow[] {
  return sqlite
    .prepare('SELECT "id", "kind", "title" FROM "entry" ORDER BY "id"')
    .all() as EntryTitleRow[];
}

function titleTargets(rows: readonly EntryTitleRow[]): Map<string, number> {
  const targets = new Map<string, number>();
  for (const row of rows) {
    const titleKey = normalizeTitleKey(row.title);
    if (!targets.has(titleKey)) targets.set(titleKey, row.id);
  }
  return targets;
}
