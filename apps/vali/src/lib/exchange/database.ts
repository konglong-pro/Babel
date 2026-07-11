import { asc, count, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";

import type { ValiDatabase } from "../db/client";
import {
  category,
  entry,
  entryAlias,
  reflection,
  trashEntry,
  vaultConfig,
} from "../db/schema";
import { ValidationError } from "../vali/errors";
import type { Entry } from "../vali/types";
import type { VaultSnapshot } from "./types";

export function isDatabaseEmpty(database: ValiDatabase): boolean {
  const client = drizzle(database);
  return [vaultConfig, category, entry, entryAlias, reflection, trashEntry].every(
    (table) => (client.select({ value: count() }).from(table).get()?.value ?? 0) === 0,
  );
}

export function restoreSnapshot(database: ValiDatabase, snapshot: VaultSnapshot): void {
  if (!isDatabaseEmpty(database)) {
    throw new ValidationError("Target database is not empty");
  }

  const client = drizzle(database);
  client.transaction(
    (transaction) => {
      if (!isDatabaseEmpty(database)) {
        throw new ValidationError("Target database is not empty");
      }

      if (snapshot.categories.length > 0) {
        transaction.insert(category).values(snapshot.categories).run();
      }
      transaction
        .insert(vaultConfig)
        .values({
          id: 1,
          name: snapshot.config.name,
          schemaVersion: snapshot.config.version,
          createdAt: snapshot.config.createdAt,
          defaultCategoryId: snapshot.config.defaultCategoryId,
        })
        .run();
      if (snapshot.entries.length > 0) {
        transaction
          .insert(entry)
          .values(
            snapshot.entries.map((item) => ({
              id: item.id,
              title: item.title,
              categoryId: item.categoryId,
              order: item.order,
              content: item.content,
              createdAt: item.createdAt,
              updatedAt: item.updatedAt,
            })),
          )
          .run();
        const aliases = snapshot.entries.flatMap((item) =>
          item.aliases.map((alias, position) => ({
            entryId: item.id,
            alias,
            position,
          })),
        );
        if (aliases.length > 0) {
          transaction.insert(entryAlias).values(aliases).run();
        }
      }
      if (snapshot.reflections.length > 0) {
        transaction.insert(reflection).values(snapshot.reflections).run();
      }
      if (snapshot.trash.length > 0) {
        transaction
          .insert(trashEntry)
          .values(
            snapshot.trash.map((item) => ({
              deletedAt: item.deletedAt,
              originalEntryId: item.originalEntryId,
              snapshotJson: JSON.stringify(item.entry),
              legacySourceName: item.sourceName,
            })),
          )
          .run();
      }
    },
    { behavior: "immediate" },
  );
}

export function readDatabaseSnapshot(database: ValiDatabase): VaultSnapshot {
  return database
    .transaction(() => readDatabaseSnapshotRows(database))
    .deferred();
}

function readDatabaseSnapshotRows(database: ValiDatabase): VaultSnapshot {
  const client = drizzle(database);
  const config = client.select().from(vaultConfig).get();
  if (!config) {
    throw new Error("Vault configuration not found");
  }

  const categories = client
    .select()
    .from(category)
    .orderBy(asc(category.order), asc(category.createdAt), asc(category.id))
    .all();
  const entries = client
    .select()
    .from(entry)
    .orderBy(
      asc(entry.categoryId),
      asc(entry.order),
      asc(entry.title),
      asc(entry.createdAt),
      asc(entry.id),
    )
    .all()
    .map(
      (item): Entry => ({
        ...item,
        aliases: client
          .select({ alias: entryAlias.alias })
          .from(entryAlias)
          .where(eq(entryAlias.entryId, item.id))
          .orderBy(asc(entryAlias.position))
          .all()
          .map((alias) => alias.alias),
      }),
    );
  const reflections = client
    .select()
    .from(reflection)
    .orderBy(desc(reflection.date))
    .all();
  const trash = client
    .select()
    .from(trashEntry)
    .orderBy(asc(trashEntry.occurrenceId))
    .all()
    .map((item) => ({
      sourceName: item.legacySourceName,
      originalEntryId: item.originalEntryId,
      deletedAt: item.deletedAt,
      entry: JSON.parse(item.snapshotJson) as Entry,
    }));

  return {
    config: {
      name: config.name,
      version: config.schemaVersion,
      createdAt: config.createdAt,
      defaultCategoryId: config.defaultCategoryId,
    },
    categories,
    entries,
    reflections,
    trash,
  };
}
