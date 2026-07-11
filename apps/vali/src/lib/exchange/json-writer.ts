import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { VaultSnapshot } from "./types";

type SnapshotCategory = VaultSnapshot["categories"][number];

export function serializeValiJson(config: VaultSnapshot["config"]): string {
  return deterministicJson({
    name: config.name,
    version: config.version,
    createdAt: config.createdAt,
    defaultCategoryId: config.defaultCategoryId,
  });
}

export function serializeCategoriesJson(
  categories: readonly SnapshotCategory[],
): string {
  const canonicalCategories = [...categories]
    .sort(compareCategories)
    .map((category) => ({
      id: category.id,
      name: category.name,
      order: category.order,
      content: category.content,
      createdAt: category.createdAt,
      updatedAt: category.updatedAt,
    }));

  return deterministicJson(canonicalCategories);
}

export async function writeLegacyJsonFiles(
  snapshot: VaultSnapshot,
  destination: string,
): Promise<void> {
  const root = path.resolve(destination);
  await mkdir(root, { recursive: true });
  await Promise.all([
    writeFile(path.join(root, "vali.json"), serializeValiJson(snapshot.config), "utf8"),
    writeFile(
      path.join(root, "categories.json"),
      serializeCategoriesJson(snapshot.categories),
      "utf8",
    ),
  ]);
}

function deterministicJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function compareCategories(left: SnapshotCategory, right: SnapshotCategory): number {
  return (
    left.order - right.order ||
    compareText(left.createdAt, right.createdAt) ||
    compareText(left.id, right.id)
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
