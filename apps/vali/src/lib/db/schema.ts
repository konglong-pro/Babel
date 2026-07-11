import { sql } from "drizzle-orm";
import {
  check,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const category = sqliteTable(
  "category",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    order: integer("order").notNull(),
    content: text("content").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("category_name_unique").on(table.name),
    check("category_id_prefix", sql`substr(${table.id}, 1, 4) = 'cat_'`),
    check("category_order_integer", sql`typeof(${table.order}) = 'integer'`),
  ],
);

export const vaultConfig = sqliteTable(
  "vault_config",
  {
    id: integer("id").primaryKey(),
    name: text("name").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    createdAt: text("created_at").notNull(),
    defaultCategoryId: text("default_category_id")
      .notNull()
      .references(() => category.id, { onDelete: "restrict", onUpdate: "cascade" }),
  },
  (table) => [
    check("vault_config_singleton", sql`${table.id} = 1`),
    check("vault_config_schema_version", sql`${table.schemaVersion} = 1`),
  ],
);

export const entry = sqliteTable(
  "entry",
  {
    id: text("id").primaryKey(),
    categoryId: text("category_id")
      .notNull()
      .references(() => category.id, { onDelete: "restrict", onUpdate: "cascade" }),
    title: text("title").notNull(),
    order: integer("order").notNull(),
    content: text("content").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("entry_category_title_unique").on(table.categoryId, table.title),
    check("entry_id_prefix", sql`substr(${table.id}, 1, 4) = 'ent_'`),
    check("entry_order_integer", sql`typeof(${table.order}) = 'integer'`),
  ],
);

export const entryAlias = sqliteTable(
  "entry_alias",
  {
    entryId: text("entry_id")
      .notNull()
      .references(() => entry.id, { onDelete: "cascade", onUpdate: "cascade" }),
    alias: text("alias").notNull(),
    position: integer("position").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.entryId, table.position] }),
    uniqueIndex("entry_alias_entry_alias_unique").on(table.entryId, table.alias),
    check("entry_alias_position_nonnegative", sql`${table.position} >= 0`),
  ],
);

export const reflection = sqliteTable("reflection", {
  date: text("date").primaryKey(),
  content: text("content").notNull(),
});

export const trashEntry = sqliteTable(
  "trash_entry",
  {
    occurrenceId: integer("occurrence_id").primaryKey({ autoIncrement: true }),
    deletedAt: text("deleted_at"),
    originalEntryId: text("original_entry_id").notNull(),
    snapshotJson: text("snapshot_json").notNull(),
    legacySourceName: text("legacy_source_name"),
  },
  (table) => [
    uniqueIndex("trash_entry_legacy_source_unique").on(table.legacySourceName),
    check("trash_entry_snapshot_json", sql`json_valid(${table.snapshotJson})`),
  ],
);
