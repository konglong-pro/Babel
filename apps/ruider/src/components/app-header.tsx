"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type FormEvent, type MouseEvent, useState } from "react";
import { openSearchWindow } from "@babel-apps/platform/search/window";

export const BEFORE_NAVIGATE_EVENT = "ruider:before-navigate";

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
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const [searchWindowError, setSearchWindowError] = useState("");

  function visit(event: MouseEvent<HTMLAnchorElement>, destination: string) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!navigationAllowed(destination)) event.preventDefault();
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
      "babel-ruider-search",
      { sessionStorageKeys: ["babel:ruider:pages"] },
    )) {
      setSearchWindowError("Allow pop-ups to search without leaving this workspace.");
    }
  }

  return (
    <header className="app-header">
      <Link className="brand" href="/canvases" aria-label="Ruider canvases home" onClick={(event) => visit(event, "/canvases")}>
        <Image className="brand-logo" src="/icon.svg" alt="" width={38} height={38} priority />
        <span className="brand-copy">
          <strong>Ruider</strong>
          <span>Make a mess. Find the thread.</span>
        </span>
        <svg className="header-scribble" viewBox="0 0 92 34" aria-hidden="true">
          <path d="M2 24c13-23 24 14 38-5s24 16 34-6c3-7 5-9 8-11" />
          <path d="m77 7 5-5 2 8" />
        </svg>
      </Link>

      <nav className="app-nav" aria-label="Primary navigation">
        <Link
          href="/canvases"
          aria-current={pathname.startsWith("/canvases") ? "page" : undefined}
          onClick={(event) => visit(event, "/canvases")}
        >
          Canvases
        </Link>
        <Link
          href="/notes"
          aria-current={pathname.startsWith("/notes") ? "page" : undefined}
          onClick={(event) => visit(event, "/notes")}
        >
          Notes
        </Link>
      </nav>

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
