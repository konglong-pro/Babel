"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useListKeyboardNavigation } from "@babel-apps/platform/navigation/react";
import { useCommandPaletteActions } from "@babel-apps/platform/shortcuts/react";

import { formatDate } from "@/components/shared";
import { getErrorMessage, searchNotes } from "@/lib/api-client";
import { documentSearchResultHref } from "@/lib/search-focus";
import type {
  DocumentKind,
  DocumentSearchField,
  DocumentSearchResultsDto,
  SearchTagDto,
  SearchTextPartDto,
} from "@/lib/types";

const SEARCH_PAGE_LIMIT = 50;
const EMPTY_RESULTS: DocumentSearchResultsDto = {
  results: [],
  total: 0,
  limit: SEARCH_PAGE_LIMIT,
  offset: 0,
};
const SEARCH_FIELD_LABELS: Record<DocumentSearchField, string> = {
  title: "Title",
  content: "Body",
  tags: "Tags",
};
const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  note: "Note",
  reflection: "Reflection",
};

function documentResultKey(result: DocumentSearchResultsDto["results"][number]): string {
  return result.kind === "note" ? `note:${result.id}` : `reflection:${result.date}`;
}

export function SearchResults({ query }: { query: string }) {
  const router = useRouter();
  const [results, setResults] = useState<DocumentSearchResultsDto>(EMPTY_RESULTS);
  const [loading, setLoading] = useState(Boolean(query));
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!query) return;

    let active = true;
    searchNotes(query, { limit: SEARCH_PAGE_LIMIT, offset: 0 })
      .then((nextResults) => {
        if (active) setResults(nextResults);
      })
      .catch((caught) => {
        if (active) setError(getErrorMessage(caught));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [query]);

  const total = results.total;
  const canLoadMore = results.results.length < results.total;
  useCommandPaletteActions("vali.search", canLoadMore ? [
    {
      id: "search.loadMore",
      label: "Load more search results",
      keywords: ["next", "page", "results"],
      group: "Search",
      available: !loadingMore,
      run: loadMore,
    },
  ] : []);
  const navigation = useListKeyboardNavigation<string>({
    items: results.results.map((result) => ({
      id: documentResultKey(result),
      label: result.match.title.map((part) => part.text).join(""),
    })),
    onActivate: (id) => {
      const result = results.results.find((candidate) => documentResultKey(candidate) === id);
      if (result) router.push(documentSearchResultHref(result, query));
    },
    label: "Search results",
  });

  function loadMore() {
    if (loadingMore || !canLoadMore) return;
    setLoadingMore(true);
    setError("");
    searchNotes(query, {
      limit: SEARCH_PAGE_LIMIT,
      offset: results.results.length,
    })
      .then((nextResults) => {
        setResults((current) => ({
          ...nextResults,
          results: [...current.results, ...nextResults.results],
          offset: 0,
        }));
      })
      .catch((caught) => setError(getErrorMessage(caught)))
      .finally(() => setLoadingMore(false));
  }

  return (
    <div className="search-page">
      <header className="search-heading">
        <span className="eyebrow">Search the library</span>
        <h1>{query ? `Results for “${query}”` : "Find a note"}</h1>
        <p>Search across notes, reflections, Markdown content, and tags.</p>
      </header>

      {loading ? <div className="standalone-status">Searching…</div> : null}
      {error ? <p className="form-error search-error" role="alert">{error}</p> : null}
      {!loading && query && !error ? (
        <p className="result-count">Found {total} {total === 1 ? "result" : "results"}</p>
      ) : null}
      {!loading && !query && !error ? (
        <div className="empty-state search-empty">
          <span aria-hidden="true">⌕</span>
          <h2>Begin with the search field above</h2>
          <p>Try a word, phrase, or tag from your notes.</p>
        </div>
      ) : null}
      {!loading && query && total === 0 && !error ? (
        <div className="empty-state search-empty">
          <span aria-hidden="true">0</span>
          <h2>No matches</h2>
          <p>Try a shorter phrase or another tag.</p>
        </div>
      ) : null}

      {!loading && total > 0 ? (
        <>
        <ul className="search-result-list" {...navigation.listboxProps}>
          {results.results.map((result) => (
            <li key={documentResultKey(result)} role="presentation">
              <Link
                {...navigation.getOptionProps(documentResultKey(result))}
                href={documentSearchResultHref(result, query)}
              >
                <span className="eyebrow">{DOCUMENT_KIND_LABELS[result.kind]}</span>
                <strong><HighlightedText parts={result.match.title} /></strong>
                <span className="search-match-fields">
                  Matched in {result.match.matchedFields
                    .map((field) => SEARCH_FIELD_LABELS[field])
                    .join(" · ")}
                </span>
                <p className="search-snippet">
                  {result.match.snippet.truncatedStart ? "…" : null}
                  <HighlightedText parts={result.match.snippet.parts} />
                  {result.match.snippet.truncatedEnd ? "…" : null}
                </p>
                {result.kind === "note" ? <SearchTags tags={result.match.tags} /> : null}
                <time dateTime={result.updatedAt}>Updated {formatDate(result.updatedAt)}</time>
              </Link>
            </li>
          ))}
        </ul>
        {canLoadMore ? (
          <button
            type="button"
            className="primary-button"
            disabled={loadingMore}
            onClick={loadMore}
          >
            {loadingMore ? "Loading\u2026" : "Load more"}
          </button>
        ) : null}
        </>
      ) : null}
    </div>
  );
}

function HighlightedText({ parts }: { parts: SearchTextPartDto[] }) {
  return parts.map((part, index) =>
    part.highlighted
      ? <mark key={`${part.text}-${index}`}>{part.text}</mark>
      : <span key={`${part.text}-${index}`}>{part.text}</span>,
  );
}

function SearchTags({ tags }: { tags: SearchTagDto[] }) {
  if (tags.length === 0) return <span className="muted no-tags">No tags</span>;

  return (
    <ul className="tag-list" aria-label="Tags">
      {tags.map((tag, index) => (
        <li key={`${tag.value}-${index}`}><HighlightedText parts={tag.parts} /></li>
      ))}
    </ul>
  );
}
