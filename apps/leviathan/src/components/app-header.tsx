"use client";

import Link from "next/link";
import { type FormEvent, type MouseEvent, useState } from "react";
import { openSearchWindow } from "@babel-apps/platform/search/window";

import { RomanTempleLogo } from "@/components/roman-temple-logo";

export const BEFORE_NAVIGATE_EVENT = "leviathan:before-navigate";

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
      "babel-leviathan-search",
      { sessionStorageKeys: ["babel:leviathan:pages"] },
    )) {
      setSearchWindowError("Allow pop-ups to search without leaving this workspace.");
    }
  }

  return (
    <header className="app-header">
      <Link className="brand" href="/notes" aria-label="Leviathan notes home" onClick={visitHome}>
        <RomanTempleLogo className="brand-mark" />
        <span className="brand-copy">
          <strong>Leviathan</strong>
          <small>Politics &amp; economics</small>
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
