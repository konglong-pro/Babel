"use client";

import Link from "next/link";
import { type FormEvent, type MouseEvent, useState } from "react";
import { openSearchWindow } from "@babel-apps/platform/search/window";

export const BEFORE_NAVIGATE_EVENT = "esperanto:before-navigate";

export interface BeforeNavigateDetail {
  destination: string;
}

function navigationAllowed(destination: string): boolean {
  return window.dispatchEvent(
    new CustomEvent<BeforeNavigateDetail>(BEFORE_NAVIGATE_EVENT, {
      cancelable: true,
      detail: { destination },
    }),
  );
}

export function AppHeader() {
  const [query, setQuery] = useState("");
  const [searchWindowError, setSearchWindowError] = useState("");

  function visitHome(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!navigationAllowed("/notes")) event.preventDefault();
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = query.trim();
    if (!value) return;
    const destination = `/search?q=${encodeURIComponent(value)}`;
    setSearchWindowError("");
    if (!openSearchWindow(
      window,
      destination,
      "babel-esperanto-search",
      { sessionStorageKeys: ["babel:esperanto:pages"] },
    )) {
      setSearchWindowError("Allow pop-ups to search without leaving this workspace.");
    }
  }

  return (
    <header className="app-header">
      <Link className="brand" href="/notes" aria-label="Esperanto notes home" onClick={visitHome}>
        <svg
          className="brand-mark"
          viewBox="0 0 64 64"
          role="presentation"
          aria-hidden="true"
          shapeRendering="crispEdges"
        >
          <g transform="rotate(-4 32 32)">
            <path className="brand-mark-paper" d="M9 7h38v4h4v38h-4v4H9V49H5V11h4z" />
            <path d="M9 3h34v4H9zM5 7h4v4H5zM43 7h4v4h-4zM1 11h4v38H1zM47 11h4v10h-4zM47 29h4v20h-4zM5 49h4v4H5zM9 53h38v4H9z" />
            <path d="M15 15h20v4H19v7h13v4H19v8h17v4H15z" />
            <path d="M13 57h6v4h-6zM35 57h7v4h-7zM53 19h4v4h-4zM57 15h4v4h-4zM57 23h4v4h-4zM51 37h4v4h-4zM55 41h6v4h-6z" />
          </g>
        </svg>
        <span className="brand-copy">
          <strong>Esperanto</strong>
          <small>language notebook</small>
        </span>
      </Link>

      <form className="global-search" role="search" onSubmit={submitSearch}>
        <label className="sr-only" htmlFor="global-search-input">
          Search all notes
        </label>
        <input
          id="global-search-input"
          data-babel-command="search"
          name="q"
          type="search"
          autoComplete="off"
          placeholder="Search titles, notes, and tags"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="submit">Search</button>
        {searchWindowError ? (
          <span className="babel-search-window-error" role="alert">{searchWindowError}</span>
        ) : null}
      </form>
    </header>
  );
}
