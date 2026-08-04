import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
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
    position: integer("position").notNull().default(0),
    ...timestamps,
  },
  (table) => [
    index("folder_parent_idx").on(table.parentId),
    index("folder_parent_position_idx").on(table.parentId, table.position, table.id),
    check("folder_name_not_blank", sql`length(trim(${table.name})) > 0`),
  ],
);

export const notes = sqliteTable(
  "note",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    folderId: integer("folder_id")
      .notNull()
      .references(() => folders.id, { onDelete: "restrict" }),
    parentId: integer("parent_id").references(
      (): AnySQLiteColumn => notes.id,
      { onDelete: "restrict" },
    ),
    title: text("title").notNull(),
    contentMd: text("content_md").notNull().default(""),
    tags: text("tags").notNull().default("[]"),
    ...timestamps,
  },
  (table) => [
    index("note_folder_idx").on(table.folderId),
    index("note_parent_idx").on(table.parentId),
    index("note_title_idx").on(table.title),
    check("note_title_not_blank", sql`length(trim(${table.title})) > 0`),
  ],
);

export const noteTemplates = sqliteTable(
  "note_template",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    contentMd: text("content_md").notNull().default(""),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("note_template_name_unique").on(sql`lower(${table.name})`),
    check(
      "note_template_name_not_blank",
      sql`length(trim(${table.name})) > 0`,
    ),
    check(
      "note_template_name_length",
      sql`length(${table.name}) <= 120`,
    ),
  ],
);

export const reflections = sqliteTable(
  "reflection",
  {
    date: text("date").primaryKey(),
    contentMd: text("content_md").notNull().default(""),
    ...timestamps,
  },
  (table) => [
    index("reflection_updated_idx").on(table.updatedAt),
    check(
      "reflection_date_valid",
      sql`${table.date} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND strftime('%Y-%m-%d', ${table.date}) = ${table.date}`,
    ),
  ],
);

export const noteLinks = sqliteTable(
  "note_link",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceNoteId: integer("source_note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    targetTitleKey: text("target_title_key").notNull(),
    targetNoteId: integer("target_note_id").references(() => notes.id, {
      onDelete: "set null",
    }),
    targetReflectionDate: text("target_reflection_date").references(
      () => reflections.date,
      { onDelete: "set null" },
    ),
    createdAt: text("created_at").notNull().default(timestampDefault),
  },
  (table) => [
    uniqueIndex("note_link_source_title_unique").on(
      table.sourceNoteId,
      table.targetTitleKey,
    ),
    index("note_link_target_idx").on(table.targetNoteId),
    index("note_link_target_reflection_idx").on(table.targetReflectionDate),
    index("note_link_title_key_idx").on(table.targetTitleKey),
    check(
      "note_link_single_target",
      sql`${table.targetNoteId} IS NULL OR ${table.targetReflectionDate} IS NULL`,
    ),
  ],
);

export const reflectionLinks = sqliteTable(
  "reflection_link",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceReflectionDate: text("source_reflection_date")
      .notNull()
      .references(() => reflections.date, { onDelete: "cascade" }),
    targetTitleKey: text("target_title_key").notNull(),
    targetNoteId: integer("target_note_id").references(() => notes.id, {
      onDelete: "set null",
    }),
    targetReflectionDate: text("target_reflection_date").references(
      () => reflections.date,
      { onDelete: "set null" },
    ),
    createdAt: text("created_at").notNull().default(timestampDefault),
  },
  (table) => [
    uniqueIndex("reflection_link_source_title_unique").on(
      table.sourceReflectionDate,
      table.targetTitleKey,
    ),
    index("reflection_link_target_note_idx").on(table.targetNoteId),
    index("reflection_link_target_reflection_idx").on(table.targetReflectionDate),
    index("reflection_link_title_key_idx").on(table.targetTitleKey),
    check(
      "reflection_link_single_target",
      sql`${table.targetNoteId} IS NULL OR ${table.targetReflectionDate} IS NULL`,
    ),
  ],
);

export const noteImages = sqliteTable(
  "document_image",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    noteId: integer("note_id").references(() => notes.id, { onDelete: "cascade" }),
    reflectionDate: text("reflection_date").references(() => reflections.date, {
      onDelete: "cascade",
    }),
    imagePath: text("image_path").notNull(),
    createdAt: text("created_at").notNull().default(timestampDefault),
  },
  (table) => [
    index("document_image_note_idx").on(table.noteId),
    index("document_image_reflection_idx").on(table.reflectionDate),
    uniqueIndex("document_image_path_unique").on(table.imagePath),
    check("document_image_path_not_blank", sql`length(trim(${table.imagePath})) > 0`),
    check(
      "document_image_single_owner",
      sql`(${table.noteId} IS NULL) <> (${table.reflectionDate} IS NULL)`,
    ),
  ],
);
