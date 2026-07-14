"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { formatDate, Tags } from "@/components/shared";
import { getErrorMessage, searchNotes } from "@/lib/api-client";
import type { DocumentSearchResultsDto } from "@/lib/types";

const EMPTY_RESULTS: DocumentSearchResultsDto = { results: [] };

export function SearchResults({ query }: { query: string }) {
  const [results, setResults] = useState<DocumentSearchResultsDto>(EMPTY_RESULTS);
  const [loading, setLoading] = useState(Boolean(query));
  const [error, setError] = useState("");

  useEffect(() => {
    if (!query) return;

    let active = true;
    searchNotes(query)
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

  const total = results.results.length;

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
        <ul className="search-result-list" aria-label="Search results">
          {results.results.map((result) => (
            <li key={result.kind === "note" ? `note:${result.id}` : `reflection:${result.date}`}>
              <Link href={result.kind === "note"
                ? `/notes?folder=${result.folderId}&note=${result.id}`
                : `/reflection?date=${encodeURIComponent(result.date)}`}
              >
                <span className="eyebrow">{result.kind}</span>
                <strong>{result.title}</strong>
                {result.kind === "note" ? <Tags tags={result.tags} /> : <span />}
                <time dateTime={result.updatedAt}>Updated {formatDate(result.updatedAt)}</time>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
