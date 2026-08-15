import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

const timestampDefault = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

const timestamps = {
  createdAt: text("created_at").notNull().default(timestampDefault),
  updatedAt: text("updated_at").notNull().default(timestampDefault),
};

export const folders = sqliteTable(
  "folder",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    parentId: integer("parent_id").references(
      (): AnySQLiteColumn => folders.id,
      { onDelete: "restrict" },
    ),
    name: text("name").notNull(),
    nameKey: text("name_key").notNull(),
    position: integer("position").notNull().default(0),
    ...timestamps,
  },
  (table) => [
    index("folder_parent_idx").on(table.parentId),
    index("folder_parent_position_idx").on(table.parentId, table.position, table.id),
    uniqueIndex("folder_root_name_unique")
      .on(table.nameKey)
      .where(sql`${table.parentId} is null`),
    uniqueIndex("folder_sibling_name_unique")
      .on(table.parentId, table.nameKey)
      .where(sql`${table.parentId} is not null`),
    check("folder_name_not_blank", sql`length(trim(${table.name})) > 0`),
  ],
);

export const canvases = sqliteTable(
  "canvas",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    title: text("title").notNull(),
    scene: text("scene").notNull().default('{"version":1,"elements":[],"viewport":{"x":0,"y":0,"zoom":1}}'),
    ...timestamps,
  },
  (table) => [
    index("canvas_updated_idx").on(table.updatedAt),
    check("canvas_title_not_blank", sql`length(trim(${table.title})) > 0`),
  ],
);

export const entries = sqliteTable(
  "entry",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    parentId: integer("parent_id").references(
      (): AnySQLiteColumn => entries.id,
      { onDelete: "restrict" },
    ),
    folderId: integer("folder_id")
      .notNull()
      .references(() => folders.id, { onDelete: "restrict" }),
    kind: text("kind", { enum: ["knowledge", "snippet"] }).notNull(),
    title: text("title").notNull(),
    notesMd: text("notes_md").notNull().default(""),
    code: text("code"),
    language: text("language"),
    filename: text("filename"),
    version: integer("version").notNull().default(1),
    position: integer("position").notNull().default(0),
    ...timestamps,
  },
  (table) => [
    index("entry_parent_idx").on(table.parentId),
    index("entry_folder_idx").on(table.folderId),
    index("entry_kind_idx").on(table.kind),
    index("entry_scope_position_idx").on(
      table.kind,
      table.folderId,
      table.parentId,
      table.position,
      table.id,
    ),
    index("entry_updated_idx").on(table.updatedAt, table.id),
    index("entry_title_idx").on(table.title),
    check("entry_title_not_blank", sql`length(trim(${table.title})) > 0`),
    check("entry_version_positive", sql`${table.version} > 0`),
    check(
      "entry_kind_fields_valid",
      sql`(
        (${table.kind} = 'knowledge' AND ${table.code} IS NULL AND ${table.language} IS NULL AND ${table.filename} IS NULL)
        OR
        (${table.kind} = 'snippet' AND ${table.code} IS NOT NULL AND ${table.language} IS NOT NULL AND length(trim(${table.language})) > 0 AND (${table.filename} IS NULL OR length(trim(${table.filename})) > 0))
      )`,
    ),
  ],
);

export const entryLinks = sqliteTable(
  "entry_link",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceEntryId: integer("source_entry_id")
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    targetTitleKey: text("target_title_key").notNull(),
    targetEntryId: integer("target_entry_id").references(() => entries.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull().default(timestampDefault),
  },
  (table) => [
    uniqueIndex("entry_link_source_title_unique").on(
      table.sourceEntryId,
      table.targetTitleKey,
    ),
    index("entry_link_target_idx").on(table.targetEntryId),
    index("entry_link_title_key_idx").on(table.targetTitleKey),
  ],
);

export const tags = sqliteTable(
  "tag",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    nameKey: text("name_key").notNull(),
  },
  (table) => [
    uniqueIndex("tag_name_unique").on(table.nameKey),
    check("tag_name_not_blank", sql`length(trim(${table.name})) > 0`),
  ],
);

export const entryTags = sqliteTable(
  "entry_tag",
  {
    entryId: integer("entry_id")
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.entryId, table.tagId] }),
    index("entry_tag_tag_idx").on(table.tagId),
  ],
);

export const entryImages = sqliteTable(
  "entry_image",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    entryId: integer("entry_id")
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    imagePath: text("image_path").notNull(),
    createdAt: text("created_at").notNull().default(timestampDefault),
  },
  (table) => [
    index("entry_image_entry_idx").on(table.entryId),
    uniqueIndex("entry_image_path_unique").on(table.imagePath),
    check("entry_image_path_not_blank", sql`length(trim(${table.imagePath})) > 0`),
  ],
);

export const trashEntries = sqliteTable(
  "trash_entry",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    originalEntryId: integer("original_entry_id").notNull(),
    folderId: integer("folder_id")
      .notNull()
      .references(() => folders.id, { onDelete: "restrict" }),
    snapshotJson: text("snapshot_json").notNull(),
    deletedAt: text("deleted_at").notNull().default(timestampDefault),
  },
  (table) => [
    uniqueIndex("trash_entry_original_id_unique").on(table.originalEntryId),
    index("trash_entry_folder_idx").on(table.folderId),
    index("trash_entry_deleted_idx").on(table.deletedAt, table.id),
    check("trash_entry_snapshot_json_valid", sql`json_valid(${table.snapshotJson})`),
  ],
);
