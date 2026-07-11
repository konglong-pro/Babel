import { asc, eq, max } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";

import type { ValiDatabase } from "../db/client";
import { category, entry, vaultConfig } from "../db/schema";
import { ConflictError, NotFoundError, ValidationError } from "./errors";
import { newId } from "./ids";
import { legacyInteger } from "./text";
import type { Category, ValiVault } from "./types";

export function createCategoryOperations(database: ValiDatabase): ValiVault["categories"] {
  const client = drizzle(database);

  return {
    list: () =>
      client
        .select()
        .from(category)
        .orderBy(asc(category.order), asc(category.createdAt), asc(category.id))
        .all() satisfies Category[],
    create: (input) => {
      const name = input.name.trim();
      if (!name) {
        throw new ValidationError("Category name is required");
      }

      return client.transaction(
        (transaction) => {
          const duplicate = transaction
            .select({ id: category.id })
            .from(category)
            .where(eq(category.name, name))
            .get();
          if (duplicate) {
            throw new ConflictError(`Category already exists: ${name}`);
          }

          const now = nowUtc();
          const highestOrder = transaction.select({ value: max(category.order) }).from(category).get();
          const created: Category = {
            id: newId("cat", (candidate) =>
              Boolean(
                transaction
                  .select({ id: category.id })
                  .from(category)
                  .where(eq(category.id, candidate))
                  .get(),
              ),
            ),
            name,
            order: (highestOrder?.value ?? 0) + 1,
            content: "",
            createdAt: now,
            updatedAt: now,
          };

          transaction.insert(category).values(created).run();
          return created;
        },
        { behavior: "immediate" },
      );
    },
    update: (id, patch) => {
      const name = patch.name?.trim();
      if (patch.name !== undefined && !name) {
        throw new ValidationError("Category name is required");
      }

      return client.transaction(
        (transaction) => {
          const current = transaction.select().from(category).where(eq(category.id, id)).get();
          if (!current) {
            throw new NotFoundError(`Category not found: ${id}`);
          }
          if (name !== undefined) {
            const duplicate = transaction
              .select({ id: category.id })
              .from(category)
              .where(eq(category.name, name))
              .get();
            if (duplicate && duplicate.id !== id) {
              throw new ConflictError(`Category already exists: ${name}`);
            }
          }

          const updated: Category = {
            ...current,
            name: name ?? current.name,
            order: patch.order === undefined ? current.order : legacyInteger(patch.order),
            content: patch.content === undefined ? current.content : patch.content,
            updatedAt: nowUtc(),
          };
          transaction
            .update(category)
            .set({
              name: updated.name,
              order: updated.order,
              content: updated.content,
              updatedAt: updated.updatedAt,
            })
            .where(eq(category.id, id))
            .run();
          return updated;
        },
        { behavior: "immediate" },
      );
    },
    delete: (id) => {
      client.transaction(
        (transaction) => {
          const current = transaction
            .select({ id: category.id })
            .from(category)
            .where(eq(category.id, id))
            .get();
          if (!current) {
            throw new NotFoundError(`Category not found: ${id}`);
          }
          const config = transaction
            .select({ defaultCategoryId: vaultConfig.defaultCategoryId })
            .from(vaultConfig)
            .get();
          if (config?.defaultCategoryId === id) {
            throw new ValidationError("Default category cannot be deleted");
          }
          const existingEntry = transaction
            .select({ id: entry.id })
            .from(entry)
            .where(eq(entry.categoryId, id))
            .get();
          if (existingEntry) {
            throw new ValidationError("Category is not empty");
          }
          transaction.delete(category).where(eq(category.id, id)).run();
        },
        { behavior: "immediate" },
      );
    },
  };
}

function nowUtc(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}
