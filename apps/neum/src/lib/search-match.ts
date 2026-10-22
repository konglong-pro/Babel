import {
  createCodeSnippet,
  createTextSnippet,
  highlightLiteral,
  literalIndexOf,
} from "@babel-apps/platform/search/text";

import type {
  EntrySearchField,
  EntrySearchResultDto,
  SearchSnippetDto,
} from "@/lib/types";

interface SearchableEntry {
  title: string;
  notesMd: string;
  code: string | null;
  language: string | null;
  filename: string | null;
}

export function createEntrySearchMatch(
  entry: SearchableEntry,
  tags: readonly string[],
  query: string,
): EntrySearchResultDto["match"] {
  const matchingTags = tags.filter((tag) => literalIndexOf(tag, query) >= 0);
  const matchedFields: EntrySearchField[] = [];
  if (literalIndexOf(entry.title, query) >= 0) matchedFields.push("title");
  if (literalIndexOf(entry.notesMd, query) >= 0) matchedFields.push("notesMd");
  if (entry.code !== null && literalIndexOf(entry.code, query) >= 0) {
    matchedFields.push("code");
  }
  if (matchingTags.length > 0) matchedFields.push("tags");
  if (entry.filename !== null && literalIndexOf(entry.filename, query) >= 0) {
    matchedFields.push("filename");
  }
  if (entry.language !== null && literalIndexOf(entry.language, query) >= 0) {
    matchedFields.push("language");
  }

  return {
    matchedFields,
    title: highlightLiteral(entry.title, query),
    tags: tags.map((tag) => ({ value: tag, parts: highlightLiteral(tag, query) })),
    snippet: chooseSnippet(entry, matchingTags, matchedFields, query),
  };
}

function chooseSnippet(
  entry: SearchableEntry,
  matchingTags: readonly string[],
  matchedFields: readonly EntrySearchField[],
  query: string,
): SearchSnippetDto {
  if (entry.code !== null && matchedFields.includes("code")) {
    return { field: "code", ...createCodeSnippet(entry.code, query) };
  }
  if (matchedFields.includes("notesMd")) {
    return { field: "notesMd", ...createTextSnippet(entry.notesMd, query) };
  }
  if (entry.filename !== null && matchedFields.includes("filename")) {
    return completeSnippet("filename", entry.filename, query);
  }
  if (entry.language !== null && matchedFields.includes("language")) {
    return completeSnippet("language", entry.language, query);
  }
  if (matchedFields.includes("tags")) {
    return { field: "tags", ...createTextSnippet(matchingTags.join(", "), query) };
  }
  return {
    field: "title",
    parts: [{ text: "Title match", highlighted: false }],
    truncatedStart: false,
    truncatedEnd: false,
  };
}

function completeSnippet(
  field: "filename" | "language",
  value: string,
  query: string,
): SearchSnippetDto {
  return {
    field,
    parts: highlightLiteral(value, query),
    truncatedStart: false,
    truncatedEnd: false,
  };
}
