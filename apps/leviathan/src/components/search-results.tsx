"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { formatDate } from "@/components/shared";
import { getErrorMessage, searchNotes } from "@/lib/api-client";
import type {
  NoteSearchField,
  SearchResultsDto,
  SearchTagDto,
  SearchTextPartDto,
} from "@/lib/types";

const EMPTY_RESULTS: SearchResultsDto = { notes: [] };
const SEARCH_FIELD_LABELS: Record<NoteSearchField, string> = {
  title: "Title",
  content: "Body",
  tags: "Tags",
};

export function SearchResults({ query }: { query: string }) {
  const [results, setResults] = useState<SearchResultsDto>(EMPTY_RESULTS);
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

  const total = results.notes.length;

  return (
    <div className="search-page">
      <header className="search-heading">
        <span className="eyebrow">Search the library</span>
        <h1>{query ? `Results for “${query}”` : "Find a note"}</h1>
        <p>Search across titles, Markdown content, and tags.</p>
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
          {results.notes.map((note) => (
            <li key={note.id}>
              <Link href={`/notes?folder=${note.folderId}&note=${note.id}`}>
                <span className="eyebrow">Note</span>
                <strong><HighlightedText parts={note.match.title} /></strong>
                <span className="search-match-fields">
                  Matched in {note.match.matchedFields.map((field) => SEARCH_FIELD_LABELS[field]).join(" · ")}
                </span>
                <p className="search-snippet">
                  {note.match.snippet.truncatedStart ? "…" : null}
                  <HighlightedText parts={note.match.snippet.parts} />
                  {note.match.snippet.truncatedEnd ? "…" : null}
                </p>
                <SearchTags tags={note.match.tags} />
                <time dateTime={note.updatedAt}>Updated {formatDate(note.updatedAt)}</time>
              </Link>
            </li>
          ))}
        </ul>
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
