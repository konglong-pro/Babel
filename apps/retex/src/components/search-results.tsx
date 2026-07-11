"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { getErrorMessage, searchArchive } from "@/lib/api-client";
import type { SearchResultsDto } from "@/lib/types";
import { formatDate, Tags } from "@/components/shared";

const EMPTY_RESULTS: SearchResultsDto = { knowledge: [], exercises: [] };

export function SearchResults({ query }: { query: string }) {
  const [results, setResults] = useState<SearchResultsDto>(EMPTY_RESULTS);
  const [loading, setLoading] = useState(Boolean(query));
  const [error, setError] = useState("");

  useEffect(() => {
    if (!query) {
      return;
    }
    let active = true;
    searchArchive(query)
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

  const total = results.knowledge.length + results.exercises.length;

  return (
    <div className="search-page">
      <header className="search-heading">
        <span className="eyebrow">Global Search</span>
        <h1>{query ? `“${query}”` : "Search Your Math Archive"}</h1>
        <p>
          Search Knowledge titles, content, and tags, plus Exercise titles, solutions, and tags.
        </p>
      </header>

      {loading ? <div className="standalone-status">Searching…</div> : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {!loading && query && !error ? (
        <p className="result-count">
          Found {total} {total === 1 ? "result" : "results"}
        </p>
      ) : null}
      {!loading && query && total === 0 && !error ? (
        <div className="empty-state">
          <span aria-hidden="true">⌕</span>
          <h2>No Matches</h2>
          <p>Try a concept, method, or existing tag.</p>
        </div>
      ) : null}

      <div className="search-groups">
        <section aria-labelledby="knowledge-results-heading">
          <div className="result-group-heading">
            <h2 id="knowledge-results-heading">Knowledge</h2>
            <span>{results.knowledge.length}</span>
          </div>
          <ul className="search-result-list">
            {results.knowledge.map((item) => (
              <li key={item.id}>
                <Link href={`/knowledge?folder=${item.folderId}&item=${item.id}`}>
                  <strong>{item.title}</strong>
                  <Tags tags={item.tags} />
                  <time dateTime={item.updatedAt}>Updated {formatDate(item.updatedAt)}</time>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="exercise-results-heading">
          <div className="result-group-heading">
            <h2 id="exercise-results-heading">Exercise</h2>
            <span>{results.exercises.length}</span>
          </div>
          <ul className="search-result-list">
            {results.exercises.map((item) => (
              <li key={item.id}>
                <Link href={`/exercise?folder=${item.folderId}&item=${item.id}`}>
                  <strong>{item.title}</strong>
                  <Tags tags={item.tags} />
                  <time dateTime={item.updatedAt}>Updated {formatDate(item.updatedAt)}</time>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
