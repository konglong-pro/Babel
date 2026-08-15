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

import { folderTypes, linkEntityKinds } from "@/lib/types";

const timestamps = {
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
};

export const folders = sqliteTable(
  "folder",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    parentId: integer("parent_id").references(
      (): AnySQLiteColumn => folders.id,
      { onDelete: "restrict" },
    ),
    type: text("type", { enum: folderTypes }).notNull(),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    ...timestamps,
  },
  (table) => [
    index("folder_type_parent_idx").on(table.type, table.parentId),
    index("folder_type_parent_position_idx").on(
      table.type,
      table.parentId,
      table.position,
      table.id,
    ),
    check("folder_type_check", sql`${table.type} in ('knowledge', 'exercise')`),
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

export const knowledgeNotes = sqliteTable(
  "knowledge_note",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    parentId: integer("parent_id").references(
      (): AnySQLiteColumn => knowledgeNotes.id,
      { onDelete: "restrict" },
    ),
    folderId: integer("folder_id")
      .notNull()
      .references(() => folders.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    contentMd: text("content_md").notNull().default(""),
    tags: text("tags").notNull().default("[]"),
    position: integer("position").notNull().default(0),
    ...timestamps,
  },
  (table) => [
    index("knowledge_folder_idx").on(table.folderId),
    index("knowledge_parent_idx").on(table.parentId),
    index("knowledge_scope_position_idx").on(
      table.folderId,
      table.parentId,
      table.position,
      table.id,
    ),
    index("knowledge_title_idx").on(table.title),
    check("knowledge_title_not_blank", sql`length(trim(${table.title})) > 0`),
  ],
);

export const exercises = sqliteTable(
  "exercise",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    folderId: integer("folder_id")
      .notNull()
      .references(() => folders.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    problemMd: text("problem_md").notNull(),
    answerMd: text("answer_md").notNull().default(""),
    solutionMd: text("solution_md").notNull().default(""),
    tags: text("tags").notNull().default("[]"),
    position: integer("position").notNull().default(0),
    ...timestamps,
  },
  (table) => [
    index("exercise_folder_idx").on(table.folderId),
    index("exercise_folder_position_idx").on(
      table.folderId,
      table.position,
      table.id,
    ),
    index("exercise_title_idx").on(table.title),
    check("exercise_title_not_blank", sql`length(trim(${table.title})) > 0`),
    check("exercise_problem_not_blank", sql`length(trim(${table.problemMd})) > 0`),
  ],
);

export const scratchSolutions = sqliteTable(
  "scratch_solution",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    exerciseId: integer("exercise_id")
      .notNull()
      .references(() => exercises.id, { onDelete: "cascade" }),
    contentMd: text("content_md").notNull().default(""),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("scratch_exercise_unique").on(table.exerciseId)],
);

export const knowledgeExercises = sqliteTable(
  "knowledge_exercise",
  {
    knowledgeId: integer("knowledge_id")
      .notNull()
      .references(() => knowledgeNotes.id, { onDelete: "cascade" }),
    exerciseId: integer("exercise_id")
      .notNull()
      .references(() => exercises.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.knowledgeId, table.exerciseId] }),
    index("knowledge_exercise_exercise_idx").on(table.exerciseId),
  ],
);

export const noteLinks = sqliteTable(
  "note_link",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceKind: text("source_kind", { enum: linkEntityKinds }).notNull(),
    sourceId: integer("source_id").notNull(),
    targetTitleKey: text("target_title_key").notNull(),
    targetKind: text("target_kind", { enum: linkEntityKinds }),
    targetId: integer("target_id"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  },
  (table) => [
    uniqueIndex("note_link_source_title_unique").on(
      table.sourceKind,
      table.sourceId,
      table.targetTitleKey,
    ),
    index("note_link_target_idx").on(table.targetKind, table.targetId),
    index("note_link_title_key_idx").on(table.targetTitleKey),
    check(
      "note_link_source_kind_check",
      sql`${table.sourceKind} in ('knowledge', 'exercise')`,
    ),
    check(
      "note_link_target_kind_check",
      sql`${table.targetKind} is null or ${table.targetKind} in ('knowledge', 'exercise')`,
    ),
    check(
      "note_link_target_pair_check",
      sql`(${table.targetKind} is null and ${table.targetId} is null) or (${table.targetKind} is not null and ${table.targetId} is not null)`,
    ),
    check("note_link_source_id_check", sql`${table.sourceId} > 0`),
    check(
      "note_link_target_id_check",
      sql`${table.targetId} is null or ${table.targetId} > 0`,
    ),
    check(
      "note_link_title_key_not_blank",
      sql`length(${table.targetTitleKey}) > 0`,
    ),
  ],
);

export const noteImages = sqliteTable(
  "note_image",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceKind: text("source_kind", { enum: linkEntityKinds }).notNull(),
    sourceId: integer("source_id").notNull(),
    imagePath: text("image_path").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  },
  (table) => [
    index("note_image_source_idx").on(table.sourceKind, table.sourceId),
    uniqueIndex("note_image_path_unique").on(table.imagePath),
    check(
      "note_image_source_kind_check",
      sql`${table.sourceKind} in ('knowledge', 'exercise')`,
    ),
    check("note_image_source_id_check", sql`${table.sourceId} > 0`),
    check("note_image_path_not_blank", sql`length(trim(${table.imagePath})) > 0`),
  ],
);
