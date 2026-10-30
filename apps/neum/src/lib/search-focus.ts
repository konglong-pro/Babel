import {
  literalSourceLine,
  searchFocusFromParams,
  type SearchFocus,
} from "@babel-apps/platform/search/focus";

import type { EntrySearchField } from "@/lib/types";

export type EntrySearchFocus = SearchFocus<EntrySearchField>;

const ENTRY_SEARCH_FIELDS = new Set<EntrySearchField>([
  "title",
  "tags",
  "filename",
  "language",
  "notesMd",
  "code",
]);

type SearchParamValue = string | string[] | undefined;

export function entrySearchFocusFromParams(
  params: Record<string, SearchParamValue>,
): EntrySearchFocus | null {
  return searchFocusFromParams(params, ENTRY_SEARCH_FIELDS);
}

export function entrySearchFocusSourceLine(
  markdown: string,
  focus: EntrySearchFocus | null,
): number | undefined {
  if (focus?.field !== "notesMd") return undefined;
  return literalSourceLine(markdown, focus.query);
}
