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
    position: integer("position").notNull().default(0),
    ...timestamps,
  },
  (table) => [
    index("note_folder_idx").on(table.folderId),
    index("note_parent_idx").on(table.parentId),
    index("note_scope_position_idx").on(
      table.folderId,
      table.parentId,
      table.position,
      table.id,
    ),
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
      "note_template_name_max_length",
      sql`length(${table.name}) <= 120`,
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
    createdAt: text("created_at").notNull().default(timestampDefault),
  },
  (table) => [
    uniqueIndex("note_link_source_title_unique").on(
      table.sourceNoteId,
      table.targetTitleKey,
    ),
    index("note_link_target_idx").on(table.targetNoteId),
    index("note_link_title_key_idx").on(table.targetTitleKey),
  ],
);

export const noteImages = sqliteTable(
  "note_image",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    noteId: integer("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    imagePath: text("image_path").notNull(),
    createdAt: text("created_at").notNull().default(timestampDefault),
  },
  (table) => [
    index("note_image_note_idx").on(table.noteId),
    uniqueIndex("note_image_path_unique").on(table.imagePath),
    check("note_image_path_not_blank", sql`length(trim(${table.imagePath})) > 0`),
  ],
);
export const readerUnderlines = sqliteTable(
  "reader_underline",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceNoteId: integer("source_note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    fieldKey: text("field_key").notNull(),
    color: text("color", { enum: ["yellow", "green", "blue", "pink", "orange"] }).notNull(),
    startOffset: integer("start_offset").notNull(),
    endOffset: integer("end_offset").notNull(),
    exactText: text("exact_text").notNull(),
    prefixText: text("prefix_text").notNull().default(""),
    suffixText: text("suffix_text").notNull().default(""),
    ...timestamps,
  },
  (table) => [
    index("reader_underline_source_idx").on(table.sourceNoteId, table.id),
    check("reader_underline_field_check", sql`${table.fieldKey} = 'content'`),
    check("reader_underline_color_check", sql`${table.color} in ('yellow', 'green', 'blue', 'pink', 'orange')`),
    check("reader_underline_offsets_check", sql`${table.startOffset} >= 0 and ${table.endOffset} > ${table.startOffset}`),
    check("reader_underline_exact_check", sql`length(${table.exactText}) > 0`),
  ],
);

export const readerUnderlineNotes = sqliteTable(
  "reader_underline_note",
  {
    underlineId: integer("underline_id")
      .notNull()
      .references(() => readerUnderlines.id, { onDelete: "cascade" }),
    noteId: integer("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("reader_underline_note_unique").on(table.underlineId, table.noteId),
    index("reader_underline_note_target_idx").on(table.noteId),
  ],
);
