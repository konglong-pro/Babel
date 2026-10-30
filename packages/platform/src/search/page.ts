export const DEFAULT_SEARCH_PAGE_LIMIT = 50;
export const MAX_SEARCH_PAGE_LIMIT = 100;

export interface SearchPageOptions {
  limit?: number;
  offset?: number;
}

export interface NormalizedSearchPage {
  limit: number;
  offset: number;
}

export interface RankedSearchPage<T> extends NormalizedSearchPage {
  items: T[];
  total: number;
}

export function normalizeSearchPage(
  options: SearchPageOptions = {},
): NormalizedSearchPage {
  const limit = normalizeInteger(
    options.limit,
    DEFAULT_SEARCH_PAGE_LIMIT,
    1,
    MAX_SEARCH_PAGE_LIMIT,
  );
  const offset = normalizeInteger(options.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  return { limit, offset };
}

export function collectRankedSearchPage<TRow, TRanked>(
  rows: Iterable<TRow>,
  rank: (row: TRow) => TRanked,
  compare: (left: TRanked, right: TRanked) => number,
  options: SearchPageOptions = {},
): RankedSearchPage<TRanked> {
  const { limit, offset } = normalizeSearchPage(options);
  const retained: TRanked[] = [];
  const retainCount = offset + limit;
  let total = 0;

  for (const row of rows) {
    total += 1;
    const ranked = rank(row);
    const insertionIndex = sortedInsertionIndex(retained, ranked, compare);
    if (insertionIndex >= retainCount) continue;

    retained.splice(insertionIndex, 0, ranked);
    if (retained.length > retainCount) retained.pop();
  }

  return {
    items: retained.slice(offset),
    total,
    limit,
    offset,
  };
}

export function trigramFtsQuery(query: string): string | undefined {
  if ([...query].length < 3 || /[\0"\\]/u.test(query)) return undefined;
  return `"${query}"`;
}

function sortedInsertionIndex<T>(
  items: readonly T[],
  item: T,
  compare: (left: T, right: T) => number,
): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (compare(item, items[middle]!) < 0) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  return low;
}

function normalizeInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < minimum) return fallback;
  return Math.min(value, maximum);
}
