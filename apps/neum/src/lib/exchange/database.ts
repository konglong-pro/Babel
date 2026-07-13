import type BetterSqlite3 from "better-sqlite3";

import { assertCurrentNeumSchema } from "../db/readiness";
import { identityKey } from "../identity";
import { rebuildAllEntryLinksInTransaction } from "../repositories/links";
import { SnapshotError } from "./errors";
import type {
  NeumDatabaseSnapshot,
  NeumSnapshotManifest,
  SnapshotEntry,
  SnapshotEntryImageReference,
  SnapshotEntryKind,
  SnapshotFolder,
  SnapshotTag,
  SnapshotTrashEntry,
  SnapshotTrashPayload,
} from "./types";

interface FolderRow {
  id: number;
  parentId: number | null;
  name: string;
  createdAt: string;
  updatedAt: string;
}

interface EntryRow {
  id: number;
  parentId: number | null;
  folderId: number;
  kind: SnapshotEntryKind;
  title: string;
  notesMd: string;
  code: string | null;
  language: string | null;
  filename: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface EntryTagRow {
  entryId: number;
  tagId: number;
}

interface EntryImageRow {
  id: number;
  entryId: number;
  imagePath: string;
  createdAt: string;
}

interface TagRow {
  id: number;
  name: string;
}

interface TrashRow {
  id: number;
  originalEntryId: number;
  folderId: number;
  snapshotJson: string;
  deletedAt: string;
}

const domainTables = [
  "entry",
  "entry_link",
  "tag",
  "entry_tag",
  "entry_image",
  "trash_entry",
] as const;

export function readNeumDatabaseSnapshot(
  sqlite: BetterSqlite3.Database,
): NeumDatabaseSnapshot {
  try {
    assertCurrentNeumSchema(sqlite);
    return sqlite.transaction(() => readRows(sqlite)).deferred();
  } catch (error) {
    if (error instanceof SnapshotError) throw error;
    throw new SnapshotError(
      "INVALID_DATABASE",
      "Could not read a Neum snapshot from the database. Ensure its schema is current and Neum is stopped.",
      { cause: error },
    );
  }
}

export function assertPristineNeumTarget(sqlite: BetterSqlite3.Database): void {
  try {
    assertCurrentNeumSchema(sqlite);
    const folders = sqlite
      .prepare(
        'SELECT "id", "parent_id" AS "parentId", "name", "created_at" AS "createdAt", "updated_at" AS "updatedAt" FROM "folder" ORDER BY "id"',
      )
      .all() as Array<{
        id: number;
        parentId: number | null;
        name: string;
        createdAt: string;
        updatedAt: string;
      }>;
    const hasPristineInbox =
      folders.length === 1 &&
      folders[0].id === 1 &&
      folders[0].parentId === null &&
      folders[0].name === "Inbox" &&
      folders[0].createdAt === folders[0].updatedAt;
    const hasDomainRows = domainTables.some(
      (table) =>
        (sqlite.prepare(`SELECT count(*) FROM "${table}"`).pluck().get() as number) !== 0,
    );
    const domainSequences = new Map(
      (
        sqlite
          .prepare(
            `SELECT "name", "seq" FROM "sqlite_sequence"
             WHERE "name" IN ('folder', 'entry', 'entry_link', 'tag', 'entry_image', 'trash_entry')`,
          )
          .all() as Array<{ name: string; seq: number }>
      ).map(({ name, seq }) => [name, seq]),
    );
    const hasPristineSequences =
      domainSequences.get("folder") === 1 &&
      ["entry", "entry_link", "tag", "entry_image", "trash_entry"].every(
        (name) => (domainSequences.get(name) ?? 0) === 0,
      );
    if (!hasPristineInbox || hasDomainRows || !hasPristineSequences) {
      throw new SnapshotError(
        "TARGET_NOT_PRISTINE",
        "Snapshot import requires a newly migrated Neum database containing only the unmodified Inbox folder.",
      );
    }
  } catch (error) {
    if (error instanceof SnapshotError) throw error;
    throw new SnapshotError(
      "INVALID_DATABASE",
      "The target database does not have the current Neum schema.",
      { cause: error },
    );
  }
}

/**
 * Restores rows while the caller owns an IMMEDIATE transaction. The manifest
 * must already have passed validateSnapshotManifest().
 */
export function restoreNeumDatabaseSnapshotRows(
  sqlite: BetterSqlite3.Database,
  manifest: NeumSnapshotManifest,
): void {
  assertPristineNeumTarget(sqlite);
  sqlite.prepare('DELETE FROM "folder" WHERE "id" = 1').run();

  const insertFolder = sqlite.prepare(
    'INSERT INTO "folder" ("id", "parent_id", "name", "name_key", "created_at", "updated_at") VALUES (?, ?, ?, ?, ?, ?)',
  );
  for (const item of foldersInParentFirstOrder(manifest.folders)) {
    insertFolder.run(
      item.id,
      item.parentId,
      item.name,
      identityKey(item.name),
      item.createdAt,
      item.updatedAt,
    );
  }

  const insertTag = sqlite.prepare(
    'INSERT INTO "tag" ("id", "name", "name_key") VALUES (?, ?, ?)',
  );
  for (const item of manifest.tags) {
    insertTag.run(item.id, item.name, identityKey(item.name));
  }

  const insertEntry = sqlite.prepare(
    'INSERT INTO "entry" ("id", "parent_id", "folder_id", "kind", "title", "notes_md", "code", "language", "filename", "version", "created_at", "updated_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const insertEntryTag = sqlite.prepare(
    'INSERT INTO "entry_tag" ("entry_id", "tag_id") VALUES (?, ?)',
  );
  const insertEntryImage = sqlite.prepare(
    'INSERT INTO "entry_image" ("id", "entry_id", "image_path", "created_at") VALUES (?, ?, ?, ?)',
  );
  for (const item of entriesInParentFirstOrder(manifest.entries)) {
    insertEntry.run(
      item.id,
      item.parentId,
      item.folderId,
      item.kind,
      item.title,
      item.notesMd,
      item.code,
      item.language,
      item.filename,
      item.version,
      item.createdAt,
      item.updatedAt,
    );
    for (const tagId of item.tagIds) insertEntryTag.run(item.id, tagId);
    for (const image of item.images) {
      insertEntryImage.run(image.id, item.id, image.imagePath, image.createdAt);
    }
  }

  const insertTrash = sqlite.prepare(
    'INSERT INTO "trash_entry" ("id", "original_entry_id", "folder_id", "snapshot_json", "deleted_at") VALUES (?, ?, ?, ?, ?)',
  );
  for (const item of manifest.trash) {
    insertTrash.run(
      item.id,
      item.originalEntryId,
      item.folderId,
      JSON.stringify(item.snapshot),
      item.deletedAt,
    );
  }
  reserveEntryIds(sqlite, manifest);
  rebuildAllEntryLinksInTransaction(sqlite);
}

function reserveEntryIds(
  sqlite: BetterSqlite3.Database,
  manifest: NeumSnapshotManifest,
): void {
  const highestReservedId = Math.max(
    0,
    ...manifest.entries.map(({ id }) => id),
    ...manifest.trash.map(({ originalEntryId }) => originalEntryId),
  );
  if (highestReservedId === 0) return;
  const updated = sqlite
    .prepare('UPDATE "sqlite_sequence" SET "seq" = ? WHERE "name" = ?')
    .run(highestReservedId, "entry");
  if (updated.changes === 0) {
    sqlite
      .prepare('INSERT INTO "sqlite_sequence" ("name", "seq") VALUES (?, ?)')
      .run("entry", highestReservedId);
  }
}

function readRows(sqlite: BetterSqlite3.Database): NeumDatabaseSnapshot {
  const folders = sqlite
    .prepare(
      'SELECT "id", "parent_id" AS "parentId", "name", "created_at" AS "createdAt", "updated_at" AS "updatedAt" FROM "folder" ORDER BY "id"',
    )
    .all() as FolderRow[];
  const tags = sqlite
    .prepare('SELECT "id", "name" FROM "tag" ORDER BY "id"')
    .all() as TagRow[];
  const entryRows = sqlite
    .prepare(
      'SELECT "id", "parent_id" AS "parentId", "folder_id" AS "folderId", "kind", "title", "notes_md" AS "notesMd", "code", "language", "filename", "version", "created_at" AS "createdAt", "updated_at" AS "updatedAt" FROM "entry" ORDER BY "id"',
    )
    .all() as EntryRow[];
  const entryTagRows = sqlite
    .prepare(
      'SELECT "entry_id" AS "entryId", "tag_id" AS "tagId" FROM "entry_tag" ORDER BY "entry_id", "tag_id"',
    )
    .all() as EntryTagRow[];
  const entryImageRows = sqlite
    .prepare(
      'SELECT "id", "entry_id" AS "entryId", "image_path" AS "imagePath", "created_at" AS "createdAt" FROM "entry_image" ORDER BY "entry_id", "id"',
    )
    .all() as EntryImageRow[];

  const tagIdsByEntry = groupBy(entryTagRows, ({ entryId }) => entryId);
  const imagesByEntry = groupBy(entryImageRows, ({ entryId }) => entryId);
  const entries: SnapshotEntry[] = entryRows.map((item) => ({
    ...item,
    tagIds: (tagIdsByEntry.get(item.id) ?? []).map(({ tagId }) => tagId),
    images: (imagesByEntry.get(item.id) ?? []).map(
      ({ id, imagePath, createdAt }): SnapshotEntryImageReference => ({
        id,
        imagePath,
        createdAt,
      }),
    ),
  }));

  const trash = (
    sqlite
      .prepare(
        'SELECT "id", "original_entry_id" AS "originalEntryId", "folder_id" AS "folderId", "snapshot_json" AS "snapshotJson", "deleted_at" AS "deletedAt" FROM "trash_entry" ORDER BY "id"',
      )
      .all() as TrashRow[]
  ).map((item): SnapshotTrashEntry => ({
    id: item.id,
    originalEntryId: item.originalEntryId,
    folderId: item.folderId,
    snapshot: parseTrashSnapshot(item),
    deletedAt: item.deletedAt,
  }));

  return {
    folders: folders as SnapshotFolder[],
    entries,
    tags: tags as SnapshotTag[],
    trash,
  };
}

function parseTrashSnapshot(row: TrashRow): SnapshotTrashPayload {
  try {
    const parsed = JSON.parse(row.snapshotJson) as {
      entry?: Partial<SnapshotTrashPayload["entry"]>;
    } & Record<string, unknown>;
    if (parsed.entry && parsed.entry.parentId === undefined) {
      parsed.entry.parentId = null;
    }
    return parsed as unknown as SnapshotTrashPayload;
  } catch (error) {
    throw new SnapshotError(
      "INVALID_DATABASE",
      `trash_entry ${row.id} contains invalid snapshot JSON.`,
      { cause: error },
    );
  }
}

function entriesInParentFirstOrder(
  entries: readonly SnapshotEntry[],
): SnapshotEntry[] {
  const pending = new Map(entries.map((item) => [item.id, item]));
  const inserted = new Set<number>();
  const ordered: SnapshotEntry[] = [];
  while (pending.size > 0) {
    let progressed = false;
    for (const [id, item] of pending) {
      if (item.parentId === null || inserted.has(item.parentId)) {
        ordered.push(item);
        inserted.add(id);
        pending.delete(id);
        progressed = true;
      }
    }
    if (!progressed) {
      throw new SnapshotError(
        "INVALID_MANIFEST",
        "Entry hierarchy cannot be restored in parent-first order.",
      );
    }
  }
  return ordered;
}

function foldersInParentFirstOrder(
  folders: readonly SnapshotFolder[],
): SnapshotFolder[] {
  const pending = new Map(folders.map((item) => [item.id, item]));
  const inserted = new Set<number>();
  const ordered: SnapshotFolder[] = [];
  while (pending.size > 0) {
    let progressed = false;
    for (const [id, item] of pending) {
      if (item.parentId === null || inserted.has(item.parentId)) {
        ordered.push(item);
        inserted.add(id);
        pending.delete(id);
        progressed = true;
      }
    }
    if (!progressed) {
      throw new SnapshotError(
        "INVALID_MANIFEST",
        "Folder hierarchy cannot be restored in parent-first order.",
      );
    }
  }
  return ordered;
}

function groupBy<T>(
  values: readonly T[],
  key: (value: T) => number,
): Map<number, T[]> {
  const groups = new Map<number, T[]>();
  for (const value of values) {
    const groupKey = key(value);
    const group = groups.get(groupKey) ?? [];
    group.push(value);
    groups.set(groupKey, group);
  }
  return groups;
}
