import {
  appendSearchFocus,
  literalSourceLine,
  searchFocusFromParams,
  type SearchFocus,
} from "@babel-apps/platform/search/focus";

import type {
  DocumentSearchField,
  DocumentSearchResultDto,
} from "@/lib/types";

export type ValiSearchFocus = SearchFocus<DocumentSearchField>;

const VALI_SEARCH_FIELDS = new Set<DocumentSearchField>([
  "title",
  "content",
  "tags",
]);

type SearchParamValue = string | string[] | undefined;

export function valiSearchFocusFromParams(
  params: Record<string, SearchParamValue>,
): ValiSearchFocus | null {
  return searchFocusFromParams(params, VALI_SEARCH_FIELDS);
}

export function valiSearchFocusSourceLine(
  markdown: string,
  focus: ValiSearchFocus | null,
): number | undefined {
  if (focus?.field !== "content") return undefined;
  return literalSourceLine(markdown, focus.query);
}

export function documentSearchResultHref(
  result: DocumentSearchResultDto,
  query: string,
): string {
  const params = new URLSearchParams();
  if (result.kind === "note") {
    params.set("folder", String(result.folderId));
    params.set("note", String(result.id));
  } else {
    params.set("date", result.date);
  }

  const normalizedQuery = query.trim();
  appendSearchFocus(params, normalizedQuery
    ? { query: normalizedQuery, field: result.match.snippet.field }
    : null);
  return `${result.kind === "note" ? "/notes" : "/reflection"}?${params}`;
}
