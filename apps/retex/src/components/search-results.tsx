"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { getErrorMessage, searchArchive } from "@/lib/api-client";
import type {
  ExerciseSearchResultDto,
  KnowledgeSearchResultDto,
  SearchField,
  SearchMatchDto,
  SearchResultsDto,
  SearchTagDto,
  SearchTextPartDto,
} from "@/lib/types";
import { formatDate } from "@/components/shared";

const SEARCH_PAGE_LIMIT = 50;
const EMPTY_RESULTS: SearchResultsDto = {
  knowledge: [],
  exercises: [],
  knowledgeTotal: 0,
  exerciseTotal: 0,
  limit: SEARCH_PAGE_LIMIT,
  knowledgeOffset: 0,
  exerciseOffset: 0,
};
const SEARCH_FIELD_LABELS: Record<SearchField, string> = {
  title: "Title",
  content: "Content",
  problem: "Problem",
  answer: "Answer",
  solution: "Solution",
  tags: "Tags",
};

export function SearchResults({ query }: { query: string }) {
  const [results, setResults] = useState<SearchResultsDto>(EMPTY_RESULTS);
  const [loading, setLoading] = useState(Boolean(query));
  const [loadingMore, setLoadingMore] = useState<"knowledge" | "exercise" | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!query) return;
    let active = true;
    searchArchive(query, {
      limit: SEARCH_PAGE_LIMIT,
      knowledgeOffset: 0,
      exerciseOffset: 0,
    })
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

  const total = results.knowledgeTotal + results.exerciseTotal;

  function loadMore(kind: "knowledge" | "exercise") {
    if (loadingMore !== null) return;
    setLoadingMore(kind);
    setError("");
    searchArchive(query, {
      limit: SEARCH_PAGE_LIMIT,
      knowledgeOffset: kind === "knowledge" ? results.knowledge.length : 0,
      exerciseOffset: kind === "exercise" ? results.exercises.length : 0,
    })
      .then((nextResults) => {
        setResults((current) => kind === "knowledge"
          ? {
              ...current,
              knowledge: [...current.knowledge, ...nextResults.knowledge],
              knowledgeTotal: nextResults.knowledgeTotal,
            }
          : {
              ...current,
              exercises: [...current.exercises, ...nextResults.exercises],
              exerciseTotal: nextResults.exerciseTotal,
            });
      })
      .catch((caught) => setError(getErrorMessage(caught)))
      .finally(() => setLoadingMore(null));
  }

  return (
    <div className="search-page">
      <header className="search-heading">
        <span className="eyebrow">Global Search</span>
        <h1>{query ? `“${query}”` : "Search Your Math Archive"}</h1>
        <p>
          Search Knowledge titles, content, and tags, plus Exercise titles, problems, answers,
          solutions, and tags.
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
            <span>{results.knowledgeTotal}</span>
          </div>
          <ul className="search-result-list">
            {results.knowledge.map((item) => (
              <li key={item.id}>
                <Link href={`/knowledge?folder=${item.folderId}&item=${item.id}`}>
                  <SearchResultContent item={item} typeLabel="Knowledge" />
                </Link>
              </li>
            ))}
          </ul>
          {results.knowledge.length < results.knowledgeTotal ? (
            <button
              type="button"
              className="primary-button"
              disabled={loadingMore !== null}
              onClick={() => loadMore("knowledge")}
            >
              {loadingMore === "knowledge" ? "Loading\u2026" : "Load more knowledge"}
            </button>
          ) : null}
        </section>

        <section aria-labelledby="exercise-results-heading">
          <div className="result-group-heading">
            <h2 id="exercise-results-heading">Exercise</h2>
            <span>{results.exerciseTotal}</span>
          </div>
          <ul className="search-result-list">
            {results.exercises.map((item) => (
              <li key={item.id}>
                <Link href={`/exercise?folder=${item.folderId}&item=${item.id}`}>
                  <SearchResultContent item={item} typeLabel="Exercise" />
                </Link>
              </li>
            ))}
          </ul>
          {results.exercises.length < results.exerciseTotal ? (
            <button
              type="button"
              className="primary-button"
              disabled={loadingMore !== null}
              onClick={() => loadMore("exercise")}
            >
              {loadingMore === "exercise" ? "Loading\u2026" : "Load more exercises"}
            </button>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function SearchResultContent({
  item,
  typeLabel,
}: {
  item: KnowledgeSearchResultDto | ExerciseSearchResultDto;
  typeLabel: "Knowledge" | "Exercise";
}) {
  const match: SearchMatchDto = item.match;
  return (
    <>
      <span className="eyebrow">{typeLabel}</span>
      <strong><HighlightedText parts={match.title} /></strong>
      <span className="search-match-fields">
        Matched in {match.matchedFields.map((field) => SEARCH_FIELD_LABELS[field]).join(" · ")}
      </span>
      <p className="search-snippet">
        {match.snippet.truncatedStart ? "…" : null}
        <HighlightedText parts={match.snippet.parts} />
        {match.snippet.truncatedEnd ? "…" : null}
      </p>
      <SearchTags tags={match.tags} />
      <time dateTime={item.updatedAt}>Updated {formatDate(item.updatedAt)}</time>
    </>
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
