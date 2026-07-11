import type { Category, Entry, SearchResult } from "./types";
import { caseFold } from "./text";

export function searchEntries(
  entries: Entry[],
  categories: Category[],
  query: string,
): SearchResult[] {
  const normalizedQuery = caseFold(query.trim());
  if (!normalizedQuery) {
    return [];
  }

  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  const results: SearchResult[] = [];
  for (const entry of entries) {
    const rank = rankEntry(entry, normalizedQuery);
    if (rank === undefined) {
      continue;
    }
    results.push({
      id: entry.id,
      title: entry.title,
      aliases: [...entry.aliases],
      categoryId: entry.categoryId,
      categoryName: categoryNames.get(entry.categoryId) ?? "",
      updatedAt: entry.updatedAt,
      rank,
    });
  }

  return results.sort(
    (left, right) =>
      left.rank - right.rank ||
      compareText(caseFold(left.title), caseFold(right.title)),
  );
}

function rankEntry(entry: Entry, query: string): number | undefined {
  const title = caseFold(entry.title);
  const aliases = entry.aliases.map(caseFold);

  if (title === query) return 0;
  if (aliases.some((alias) => alias === query)) return 1;
  if (title.startsWith(query)) return 2;
  if (aliases.some((alias) => alias.startsWith(query))) return 3;
  if (title.includes(query)) return 4;
  if (aliases.some((alias) => alias.includes(query))) return 5;
  return undefined;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
