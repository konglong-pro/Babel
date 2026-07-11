import type { ValiDatabase } from "../db/client";
import { createCategoryOperations } from "./categories";
import { createEntryOperations } from "./entries";
import { createReflectionOperations } from "./reflections";
import type { ValiVault } from "./types";

const DEFAULT_CATEGORIES = [
  { id: "cat_watchlist", name: "Watchlist", order: 1 },
  { id: "cat_owned", name: "Owned", order: 2 },
  { id: "cat_avoid", name: "Avoid", order: 3 },
] as const;

export function createValiVault(database: ValiDatabase): ValiVault {
  seedDefaults(database);

  return {
    categories: createCategoryOperations(database),
    entries: createEntryOperations(database),
    reflections: createReflectionOperations(database),
  };
}

function seedDefaults(database: ValiDatabase): void {
  const initialize = database.transaction(() => {
    const configs = database
      .prepare(
        `SELECT id, schema_version AS schemaVersion, default_category_id AS defaultCategoryId
         FROM vault_config`,
      )
      .all() as Array<{ id: number; schemaVersion: number; defaultCategoryId: string }>;
    if (configs.length > 1) {
      throw new Error("Vault database has multiple configuration rows");
    }
    if (configs.length === 1) {
      const config = configs[0];
      const defaultCategory = database
        .prepare("SELECT 1 FROM category WHERE id = ?")
        .get(config.defaultCategoryId);
      if (config.id !== 1 || config.schemaVersion !== 1 || !defaultCategory) {
        throw new Error("Vault database configuration is invalid");
      }
      return;
    }

    const hasDomainData = [
      "category",
      "entry",
      "entry_alias",
      "reflection",
      "trash_entry",
    ].some(
      (table) =>
        Boolean(database.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get()),
    );
    if (hasDomainData) {
      throw new Error("Vault database has domain data but no configuration");
    }

    const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const insertCategory = database.prepare(
      `INSERT INTO category (id, name, "order", content, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const item of DEFAULT_CATEGORIES) {
      insertCategory.run(item.id, item.name, item.order, "", now, now);
    }
    database
      .prepare(
        `INSERT INTO vault_config
           (id, name, schema_version, created_at, default_category_id)
         VALUES (1, ?, 1, ?, ?)`,
      )
      .run("Vali", now, "cat_watchlist");
  });
  initialize.immediate();
}
