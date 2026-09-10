import path from "node:path";

import type BetterSqlite3 from "better-sqlite3";

import { resolveDatabasePath } from "@babel-apps/platform/db/client";
import { assertLiveDatabaseMigrationsCurrent } from "@babel-apps/platform/db/readiness";

export const NEUM_SCHEMA_MIGRATION_TIMESTAMP = 1_786_724_112_675;

const databasePathOptions = {
  envVar: "NEUM_DATABASE_PATH",
  defaultPath: path.resolve(process.cwd(), "..", "..", "data", "neum", "sqlite.db"),
};

export const appDatabaseReadinessOptions = {
  appName: "Neum",
  packageName: "@babel-apps/neum",
  expectedMigration: NEUM_SCHEMA_MIGRATION_TIMESTAMP,
  requiredColumns: {
    canvas: ["title", "scene", "updated_at"],
    folder: ["position"],
    entry: ["parent_id", "position"],
    entry_link: ["source_entry_id", "target_title_key", "target_entry_id"],
  },
  requiredSchemaObjects: [
    {
      type: "table",
      name: "entry_search",
      sqlIncludes: ["USING fts5", "content='entry'", "tokenize='trigram'"],
    },
    { type: "trigger", name: "entry_search_ai" },
    { type: "trigger", name: "entry_search_ad" },
    { type: "trigger", name: "entry_search_au" },
    {
      type: "table",
      name: "tag_search",
      sqlIncludes: ["USING fts5", "content='tag'", "tokenize='trigram'"],
    },
    { type: "trigger", name: "tag_search_ai" },
    { type: "trigger", name: "tag_search_ad" },
    { type: "trigger", name: "tag_search_au" },
  ],
} as const;

export function resolveAppDatabasePath(): string {
  return resolveDatabasePath(databasePathOptions);
}

export function assertAppDatabaseReady(databasePath = resolveAppDatabasePath()): void {
  assertLiveDatabaseMigrationsCurrent({ ...appDatabaseReadinessOptions, databasePath });
}

const requiredTables = {
  canvas: ["id", "title", "scene", "created_at", "updated_at"],
  folder: [
    "id",
    "parent_id",
    "name",
    "name_key",
    "position",
    "created_at",
    "updated_at",
  ],
  entry: [
    "id",
    "parent_id",
    "folder_id",
    "kind",
    "title",
    "notes_md",
    "code",
    "language",
    "filename",
    "version",
    "position",
    "created_at",
    "updated_at",
  ],
  entry_link: [
    "id",
    "source_entry_id",
    "target_title_key",
    "target_entry_id",
    "created_at",
  ],
  tag: ["id", "name", "name_key"],
  entry_tag: ["entry_id", "tag_id"],
  entry_image: ["id", "entry_id", "image_path", "created_at"],
  trash_entry: [
    "id",
    "original_entry_id",
    "folder_id",
    "snapshot_json",
    "deleted_at",
  ],
  entry_search: ["title", "notes_md", "code", "language", "filename"],
  tag_search: ["name"],
} as const;

const requiredIndexes = {
  canvas_updated_idx: {
    table: "canvas",
    columns: ["updated_at"],
    unique: false,
  },
  entry_parent_idx: { table: "entry", columns: ["parent_id"], unique: false },
  entry_folder_idx: { table: "entry", columns: ["folder_id"], unique: false },
  entry_kind_idx: { table: "entry", columns: ["kind"], unique: false },
  entry_title_idx: { table: "entry", columns: ["title"], unique: false },
  entry_updated_idx: {
    table: "entry",
    columns: ["updated_at", "id"],
    unique: false,
  },
  entry_scope_position_idx: {
    table: "entry",
    columns: ["kind", "folder_id", "parent_id", "position", "id"],
    unique: false,
  },
  entry_image_entry_idx: {
    table: "entry_image",
    columns: ["entry_id"],
    unique: false,
  },
  entry_image_path_unique: {
    table: "entry_image",
    columns: ["image_path"],
    unique: true,
  },
  entry_link_source_title_unique: {
    table: "entry_link",
    columns: ["source_entry_id", "target_title_key"],
    unique: true,
  },
  entry_link_target_idx: {
    table: "entry_link",
    columns: ["target_entry_id"],
    unique: false,
  },
  entry_link_title_key_idx: {
    table: "entry_link",
    columns: ["target_title_key"],
    unique: false,
  },
  entry_tag_tag_idx: {
    table: "entry_tag",
    columns: ["tag_id"],
    unique: false,
  },
  folder_parent_idx: { table: "folder", columns: ["parent_id"], unique: false },
  folder_parent_position_idx: {
    table: "folder",
    columns: ["parent_id", "position", "id"],
    unique: false,
  },
  folder_root_name_unique: {
    table: "folder",
    columns: ["name_key"],
    unique: true,
    partial: true,
    predicate: "is-null",
  },
  folder_sibling_name_unique: {
    table: "folder",
    columns: ["parent_id", "name_key"],
    unique: true,
    partial: true,
    predicate: "is-not-null",
  },
  tag_name_unique: { table: "tag", columns: ["name_key"], unique: true },
  trash_entry_deleted_idx: {
    table: "trash_entry",
    columns: ["deleted_at", "id"],
    unique: false,
  },
  trash_entry_folder_idx: {
    table: "trash_entry",
    columns: ["folder_id"],
    unique: false,
  },
  trash_entry_original_id_unique: {
    table: "trash_entry",
    columns: ["original_entry_id"],
    unique: true,
  },
} as const;

const requiredForeignKeys = [
  ["entry", "parent_id", "entry", "id", "RESTRICT"],
  ["entry", "folder_id", "folder", "id", "RESTRICT"],
  ["entry_image", "entry_id", "entry", "id", "CASCADE"],
  ["entry_link", "source_entry_id", "entry", "id", "CASCADE"],
  ["entry_link", "target_entry_id", "entry", "id", "SET NULL"],
  ["entry_tag", "entry_id", "entry", "id", "CASCADE"],
  ["entry_tag", "tag_id", "tag", "id", "CASCADE"],
  ["folder", "parent_id", "folder", "id", "RESTRICT"],
  ["trash_entry", "folder_id", "folder", "id", "RESTRICT"],
] as const;

const requiredChecks = {
  canvas: ["canvas_title_not_blank"],
  entry: [
    "entry_title_not_blank",
    "entry_version_positive",
    "entry_kind_fields_valid",
  ],
  entry_image: ["entry_image_path_not_blank"],
  folder: ["folder_name_not_blank"],
  tag: ["tag_name_not_blank"],
  trash_entry: ["trash_entry_snapshot_json_valid"],
} as const;

const requiredTableSqlFragments = {
  entry_search: ["using fts5", "content='entry'", "tokenize='trigram'"],
  tag_search: ["using fts5", "content='tag'", "tokenize='trigram'"],
} as const;

const requiredTriggers = [
  "entry_search_ai",
  "entry_search_ad",
  "entry_search_au",
  "tag_search_ai",
  "tag_search_ad",
  "tag_search_au",
] as const;

export function assertCurrentNeumSchema(sqlite: BetterSqlite3.Database): void {
  assertMigrationApplied(sqlite);

  for (const [table, expectedColumns] of Object.entries(requiredTables)) {
    const schemaSql = tableSql(sqlite, table);
    const columns = new Set(
      (
        sqlite.prepare(`PRAGMA table_info("${table}")`).all() as Array<{
          name: string;
        }>
      ).map(({ name }) => name),
    );
    for (const column of expectedColumns) {
      if (!columns.has(column)) {
        throw new Error(`Missing Neum column: ${table}.${column}.`);
      }
    }
    for (const constraint of requiredChecks[table as keyof typeof requiredChecks] ?? []) {
      if (!schemaSql.includes(constraint)) {
        throw new Error(`Missing Neum constraint: ${constraint}.`);
      }
    }
    const normalizedSchemaSql = schemaSql.toLowerCase();
    for (
      const fragment of
        requiredTableSqlFragments[
          table as keyof typeof requiredTableSqlFragments
        ] ?? []
    ) {
      if (!normalizedSchemaSql.includes(fragment)) {
        throw new Error(`Neum table has wrong schema: ${table}.`);
      }
    }
  }

  for (const [name, expected] of Object.entries(requiredIndexes)) {
    const indexes = sqlite.prepare(`PRAGMA index_list("${expected.table}")`).all() as Array<{
      name: string;
      unique: number;
      partial: number;
    }>;
    const actual = indexes.find((index) => index.name === name);
    if (!actual) throw new Error(`Missing Neum index: ${name}.`);
    if (Boolean(actual.unique) !== expected.unique) {
      throw new Error(`Neum index has wrong uniqueness: ${name}.`);
    }
    if (Boolean(actual.partial) !== ("partial" in expected && expected.partial)) {
      throw new Error(`Neum index has wrong partial definition: ${name}.`);
    }
    const columns = (
      sqlite.prepare(`PRAGMA index_info("${name}")`).all() as Array<{
        seqno: number;
        name: string;
      }>
    )
      .sort((left, right) => left.seqno - right.seqno)
      .map(({ name: column }) => column);
    if (columns.join("\0") !== expected.columns.join("\0")) {
      throw new Error(`Neum index has wrong columns: ${name}.`);
    }
    if ("predicate" in expected) {
      const row = sqlite
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?")
        .get(name) as { sql?: unknown } | undefined;
      const sql = typeof row?.sql === "string" ? row.sql : "";
      const predicate =
        expected.predicate === "is-null"
          ? /where\s+(?:(?:"?folder"?)\.)?"?parent_id"?\s+is\s+null/i
          : /where\s+(?:(?:"?folder"?)\.)?"?parent_id"?\s+is\s+not\s+null/i;
      if (!predicate.test(sql)) {
        throw new Error(`Neum index has wrong predicate: ${name}.`);
      }
    }
  }

  for (const [table, from, targetTable, to, onDelete] of requiredForeignKeys) {
    const keys = sqlite.prepare(`PRAGMA foreign_key_list("${table}")`).all() as Array<{
      from: string;
      table: string;
      to: string;
      on_delete: string;
    }>;
    const matches = keys.some(
      (key) =>
        key.from === from &&
        key.table === targetTable &&
        key.to === to &&
        key.on_delete.toUpperCase() === onDelete,
    );
    if (!matches) {
      throw new Error(`Missing Neum foreign key: ${table}.${from}.`);
    }
  }

  for (const trigger of requiredTriggers) {
    const exists = sqlite
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = ?")
      .get(trigger);
    if (exists === undefined) {
      throw new Error(`Missing Neum trigger: ${trigger}.`);
    }
  }
}

function assertMigrationApplied(sqlite: BetterSqlite3.Database): void {
  tableSql(sqlite, "__drizzle_migrations");
  const latest = sqlite
    .prepare('SELECT max("created_at") FROM "__drizzle_migrations"')
    .pluck()
    .get();
  if (typeof latest !== "number" || latest < NEUM_SCHEMA_MIGRATION_TIMESTAMP) {
    throw new Error("The current Neum migration has not been applied.");
  }
}

function tableSql(sqlite: BetterSqlite3.Database, table: string): string {
  const row = sqlite
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { sql?: unknown } | undefined;
  if (!row || typeof row.sql !== "string") {
    throw new Error(`Missing Neum table: ${table}.`);
  }
  return row.sql;
}
