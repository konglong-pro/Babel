import {
  appendSearchFocus,
  literalSourceLine,
  searchFocusFromParams,
  type SearchFocus,
} from "@babel-apps/platform/search/focus";

import type { FolderType, SearchField } from "@/lib/types";

export type ArchiveSearchFocus = SearchFocus<SearchField>;
export type ArchiveMarkdownSearchField = Extract<
  SearchField,
  "content" | "problem" | "answer" | "solution"
>;

const KNOWLEDGE_SEARCH_FIELDS = new Set<SearchField>([
  "title",
  "content",
  "tags",
]);
const EXERCISE_SEARCH_FIELDS = new Set<SearchField>([
  "title",
  "problem",
  "answer",
  "solution",
  "tags",
]);

type SearchParamValue = string | string[] | undefined;

export function archiveSearchFocusFromParams(
  params: Record<string, SearchParamValue>,
  type: FolderType,
): ArchiveSearchFocus | null {
  return searchFocusFromParams(
    params,
    type === "knowledge" ? KNOWLEDGE_SEARCH_FIELDS : EXERCISE_SEARCH_FIELDS,
  );
}

export function archiveSearchFocusSourceLine(
  markdown: string,
  focus: ArchiveSearchFocus | null,
  field: ArchiveMarkdownSearchField,
): number | undefined {
  if (focus?.field !== field) return undefined;
  return literalSourceLine(markdown, focus.query);
}

export function archiveSearchResultHref(
  type: FolderType,
  input: {
    folderId: number;
    itemId: number;
    searchFocus: ArchiveSearchFocus;
  },
): string {
  const params = new URLSearchParams({
    folder: String(input.folderId),
    item: String(input.itemId),
  });
  appendSearchFocus(params, input.searchFocus);
  return `/${type}?${params.toString()}`;
}
