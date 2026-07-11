import { and, asc, eq, max } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";

import type { ValiDatabase } from "../db/client";
import { category, entry, entryAlias, trashEntry } from "../db/schema";
import { ConflictError, NotFoundError, ValidationError } from "./errors";
import { newId } from "./ids";
import { searchEntries } from "./search";
import { caseFold, legacyInteger } from "./text";
import type { Entry, ValiVault } from "./types";

const DEFAULT_ENTRY_TEMPLATE =
  "# Business Notes\n\n# Bull Case\n\n# Bear Case\n\n# Current Take\n";
export function createEntryOperations(database: ValiDatabase): ValiVault["entries"] {
  const client = drizzle(database);

  const aliasesFor = (entryId: string): string[] =>
    client
      .select({ alias: entryAlias.alias })
      .from(entryAlias)
      .where(eq(entryAlias.entryId, entryId))
      .orderBy(asc(entryAlias.position))
      .all()
      .map((item) => item.alias);

  const readEntries = (categoryId?: string): Entry[] => {
    if (categoryId) {
      const existingCategory = client
        .select({ id: category.id })
        .from(category)
        .where(eq(category.id, categoryId))
        .get();
      if (!existingCategory) {
        throw new NotFoundError(`Category not found: ${categoryId}`);
      }
    }
    const rows = categoryId
      ? client.select().from(entry).where(eq(entry.categoryId, categoryId)).all()
      : client.select().from(entry).all();
    return rows
      .map((item) => ({ ...item, aliases: aliasesFor(item.id) }))
      .sort(compareEntries);
  };

  const readEntry = (id: string): Entry => {
    const current = client.select().from(entry).where(eq(entry.id, id)).get();
    if (!current) {
      throw new NotFoundError(`Entry not found: ${id}`);
    }
    return { ...current, aliases: aliasesFor(id) };
  };

  const readTransaction = <Result>(read: () => Result): Result =>
    database.transaction(read).deferred();

  const operations: ValiVault["entries"] = {
    list: (categoryId) => readTransaction(() => readEntries(categoryId)),
    get: (id) => readTransaction(() => readEntry(id)),
    create: (input) => {
      const title = input.title.trim();
      if (!title) {
        throw new ValidationError("Entry title is required");
      }
      if (input.aliases !== undefined && !Array.isArray(input.aliases)) {
        throw new ValidationError("Entry aliases must be a list");
      }
      const aliases = cleanAliases(input.aliases ?? []);

      return client.transaction(
        (transaction) => {
          const existingCategory = transaction
            .select({ id: category.id })
            .from(category)
            .where(eq(category.id, input.categoryId))
            .get();
          if (!existingCategory) {
            throw new NotFoundError(`Category not found: ${input.categoryId}`);
          }

          const duplicate = transaction
            .select({ id: entry.id })
            .from(entry)
            .where(and(eq(entry.categoryId, input.categoryId), eq(entry.title, title)))
            .get();
          if (duplicate) {
            throw new ConflictError(`Entry already exists in this category: ${title}`);
          }

          const now = nowUtc();
          const highestOrder = transaction
            .select({ value: max(entry.order) })
            .from(entry)
            .where(eq(entry.categoryId, input.categoryId))
            .get();
          const created: Entry = {
            id: newId("ent", (candidate) =>
              Boolean(
                transaction
                  .select({ id: entry.id })
                  .from(entry)
                  .where(eq(entry.id, candidate))
                  .get(),
              ),
            ),
            title,
            aliases,
            categoryId: input.categoryId,
            order: (highestOrder?.value ?? 0) + 1,
            content: input.content ?? DEFAULT_ENTRY_TEMPLATE,
            createdAt: now,
            updatedAt: now,
          };

          transaction.insert(entry).values(created).run();
          if (aliases.length > 0) {
            transaction
              .insert(entryAlias)
              .values(
                aliases.map((alias, position) => ({
                  entryId: created.id,
                  alias,
                  position,
                })),
              )
              .run();
          }
          return created;
        },
        { behavior: "immediate" },
      );
    },
    update: (id, patch) => {
      const title = patch.title?.trim();
      if (patch.title !== undefined && !title) {
        throw new ValidationError("Entry title is required");
      }
      if (patch.aliases !== undefined && !Array.isArray(patch.aliases)) {
        throw new ValidationError("Entry aliases must be a list");
      }
      const replacementAliases =
        patch.aliases === undefined ? undefined : cleanAliases(patch.aliases);

      return client.transaction(
        (transaction) => {
          const current = transaction.select().from(entry).where(eq(entry.id, id)).get();
          if (!current) {
            throw new NotFoundError(`Entry not found: ${id}`);
          }
          const currentAliases = transaction
            .select({ alias: entryAlias.alias })
            .from(entryAlias)
            .where(eq(entryAlias.entryId, id))
            .orderBy(asc(entryAlias.position))
            .all()
            .map((item) => item.alias);
          const categoryId = patch.categoryId ?? current.categoryId;
          const existingCategory = transaction
            .select({ id: category.id })
            .from(category)
            .where(eq(category.id, categoryId))
            .get();
          if (!existingCategory) {
            throw new NotFoundError(`Category not found: ${categoryId}`);
          }
          const nextTitle = title ?? current.title;
          const duplicate = transaction
            .select({ id: entry.id })
            .from(entry)
            .where(and(eq(entry.categoryId, categoryId), eq(entry.title, nextTitle)))
            .get();
          if (duplicate && duplicate.id !== id) {
            throw new ConflictError(`Entry already exists in this category: ${nextTitle}`);
          }

          const updated: Entry = {
            ...current,
            title: nextTitle,
            aliases: replacementAliases ?? currentAliases,
            categoryId,
            order: patch.order === undefined ? current.order : legacyInteger(patch.order),
            content: patch.content ?? current.content,
            updatedAt: nowUtc(),
          };
          transaction
            .update(entry)
            .set({
              title: updated.title,
              categoryId: updated.categoryId,
              order: updated.order,
              content: updated.content,
              updatedAt: updated.updatedAt,
            })
            .where(eq(entry.id, id))
            .run();
          if (replacementAliases !== undefined) {
            transaction.delete(entryAlias).where(eq(entryAlias.entryId, id)).run();
            if (replacementAliases.length > 0) {
              transaction
                .insert(entryAlias)
                .values(
                  replacementAliases.map((alias, position) => ({
                    entryId: id,
                    alias,
                    position,
                  })),
                )
                .run();
            }
          }
          return updated;
        },
        { behavior: "immediate" },
      );
    },
    delete: (id) => {
      client.transaction(
        (transaction) => {
          const current = transaction.select().from(entry).where(eq(entry.id, id)).get();
          if (!current) {
            throw new NotFoundError(`Entry not found: ${id}`);
          }
          const aliases = transaction
            .select({ alias: entryAlias.alias })
            .from(entryAlias)
            .where(eq(entryAlias.entryId, id))
            .orderBy(asc(entryAlias.position))
            .all()
            .map((item) => item.alias);
          const snapshot: Entry = { ...current, aliases };

          transaction
            .insert(trashEntry)
            .values({
              deletedAt: nowUtc(),
              originalEntryId: id,
              snapshotJson: JSON.stringify(snapshot),
              legacySourceName: null,
            })
            .run();
          transaction.delete(entry).where(eq(entry.id, id)).run();
        },
        { behavior: "immediate" },
      );
    },
    importTitles: (categoryId, items) => {
      const existingCategory = client
        .select({ id: category.id })
        .from(category)
        .where(eq(category.id, categoryId))
        .get();
      if (!existingCategory) {
        throw new NotFoundError(`Category not found: ${categoryId}`);
      }

      const created: string[] = [];
      const skipped: string[] = [];
      for (const item of items) {
        const title = item.trim();
        if (!title) {
          continue;
        }
        try {
          operations.create({ title, aliases: [], categoryId });
          created.push(title);
        } catch (error) {
          if (error instanceof ConflictError) {
            skipped.push(title);
            continue;
          }
          throw error;
        }
      }
      return { created, skipped };
    },
    search: (query) =>
      readTransaction(() =>
        searchEntries(readEntries(), client.select().from(category).all(), query),
      ),
  };
  return operations;
}

function cleanAliases(aliases: string[]): string[] {
  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const alias of aliases) {
    const value = alias.trim();
    if (!value || seen.has(value)) {
      continue;
    }
    cleaned.push(value);
    seen.add(value);
  }
  return cleaned;
}

function compareEntries(left: Entry, right: Entry): number {
  return (
    left.order - right.order ||
    compareText(caseFold(left.title), caseFold(right.title)) ||
    compareText(left.createdAt, right.createdAt)
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function nowUtc(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}
