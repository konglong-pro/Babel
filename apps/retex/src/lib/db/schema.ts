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

import { folderTypes } from "@/lib/types";

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
    ...timestamps,
  },
  (table) => [
    index("folder_type_parent_idx").on(table.type, table.parentId),
    check("folder_type_check", sql`${table.type} in ('knowledge', 'exercise')`),
    check("folder_name_not_blank", sql`length(trim(${table.name})) > 0`),
  ],
);

export const knowledgeNotes = sqliteTable(
  "knowledge_note",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    folderId: integer("folder_id")
      .notNull()
      .references(() => folders.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    contentMd: text("content_md").notNull().default(""),
    tags: text("tags").notNull().default("[]"),
    ...timestamps,
  },
  (table) => [
    index("knowledge_folder_idx").on(table.folderId),
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
    imagePath: text("image_path").notNull(),
    answerMd: text("answer_md").notNull().default(""),
    solutionMd: text("solution_md").notNull().default(""),
    tags: text("tags").notNull().default("[]"),
    ...timestamps,
  },
  (table) => [
    index("exercise_folder_idx").on(table.folderId),
    index("exercise_title_idx").on(table.title),
    check("exercise_title_not_blank", sql`length(trim(${table.title})) > 0`),
    check("exercise_image_path_not_blank", sql`length(trim(${table.imagePath})) > 0`),
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
