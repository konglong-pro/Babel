"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { entryKindLabel, formatDate } from "@/components/shared";
import { getErrorMessage, searchEntries } from "@/lib/api-client";
import { entryWorkspaceHref } from "@/lib/entry-routes";
import type {
  EntrySearchField,
  EntrySearchResultDto,
  SearchTagDto,
  SearchTextPartDto,
} from "@/lib/types";

const SEARCH_FIELD_LABELS: Record<EntrySearchField, string> = {
  title: "Title",
  notesMd: "Notes",
  code: "Code",
  tags: "Tags",
  filename: "Filename",
  language: "Language",
};
const SEARCH_PAGE_LIMIT = 50;

export function SearchResults({ query }: { query: string }) {
  const [items, setItems] = useState<EntrySearchResultDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(Boolean(query));
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!query) return;

    let active = true;
    searchEntries({ query, limit: SEARCH_PAGE_LIMIT, offset: 0 })
      .then((page) => {
        if (!active) return;
        setItems(page.items);
        setTotal(page.total);
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

  function loadMore() {
    if (loadingMore || items.length >= total) return;
    setLoadingMore(true);
    setError("");
    searchEntries({
      query,
      limit: SEARCH_PAGE_LIMIT,
      offset: items.length,
    })
      .then((page) => {
        setItems((current) => [...current, ...page.items]);
        setTotal(page.total);
      })
      .catch((caught) => setError(getErrorMessage(caught)))
      .finally(() => setLoadingMore(false));
  }

  return (
    <div className="search-page">
      <header className="search-heading">
        <span className="eyebrow">Search the knowledge base</span>
        <h1>{query ? `Results for “${query}”` : "Find an entry"}</h1>
        <p>Search titles, Markdown notes, code, language, filenames, and tags.</p>
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
          <p>Try a concept, code fragment, filename, or tag.</p>
        </div>
      ) : null}
      {!loading && query && total === 0 && !error ? (
        <div className="empty-state search-empty">
          <span aria-hidden="true">0</span>
          <h2>No matches</h2>
          <p>Try a shorter phrase or another tag.</p>
        </div>
      ) : null}

      {!loading && items.length > 0 ? (
        <ul className="search-result-list" aria-label="Search results">
          {items.map((entry) => (
            <li key={entry.id}>
              <Link href={entryWorkspaceHref(entry.kind, {
                folderId: entry.folderId,
                entryId: entry.id,
              })}>
                <span className="eyebrow">{entryKindLabel(entry.kind)}</span>
                <strong><HighlightedText parts={entry.match.title} /></strong>
                <span className="search-match-fields">
                  Matched in {entry.match.matchedFields
                    .map((field) => SEARCH_FIELD_LABELS[field])
                    .join(" · ")}
                </span>
                <SearchSnippet entry={entry} />
                <SearchTags tags={entry.match.tags} />
                <time dateTime={entry.updatedAt}>Updated {formatDate(entry.updatedAt)}</time>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {items.length < total ? (
        <button
          type="button"
          className="primary-button"
          disabled={loadingMore}
          onClick={loadMore}
        >
          {loadingMore ? "Loading\u2026" : `Load more (${items.length} of ${total})`}
        </button>
      ) : null}
    </div>
  );
}

function SearchSnippet({ entry }: { entry: EntrySearchResultDto }) {
  const { snippet } = entry.match;
  const content = (
    <>
      {snippet.truncatedStart ? "…" : null}
      <HighlightedText parts={snippet.parts} />
      {snippet.truncatedEnd ? "…" : null}
    </>
  );
  return snippet.field === "code"
    ? <pre className="search-snippet search-code-snippet"><code>{content}</code></pre>
    : <p className="search-snippet">{content}</p>;
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
