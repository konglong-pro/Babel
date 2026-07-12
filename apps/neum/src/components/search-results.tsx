"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { entryKindLabel, formatDate, Tags } from "@/components/shared";
import { getErrorMessage, searchEntries } from "@/lib/api-client";
import type { EntrySummaryDto } from "@/lib/types";

export function SearchResults({ query }: { query: string }) {
  const [items, setItems] = useState<EntrySummaryDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(Boolean(query));
  const [error, setError] = useState("");

  useEffect(() => {
    if (!query) return;

    let active = true;
    searchEntries({ query, limit: 100 })
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
              <Link href={`/entries?folder=${entry.folderId}&entry=${entry.id}`}>
                <span className="eyebrow">{entryKindLabel(entry.kind)}</span>
                <strong>{entry.title}</strong>
                <Tags tags={entry.tags} />
                <time dateTime={entry.updatedAt}>Updated {formatDate(entry.updatedAt)}</time>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {items.length < total ? (
        <p className="result-count">Showing the latest {items.length} matches.</p>
      ) : null}
    </div>
  );
}
