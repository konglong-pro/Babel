"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, type MouseEvent, useState } from "react";

export const BEFORE_NAVIGATE_EVENT = "neum:before-navigate";

export interface BeforeNavigateDetail {
  destination: string;
}

const cartesianMark = (
  <svg
    className="brand-mark"
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
  >
    <g
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      transform="rotate(-12 12 12)"
    >
      <path d="M7 19V4m-3 3 3-3 3 3" />
      <path d="M4 19h17m-3-3 3 3-3 3" />
      <circle cx="7" cy="19" r="1.7" fill="currentColor" stroke="none" />
    </g>
  </svg>
);

function navigationAllowed(destination: string): boolean {
  return window.dispatchEvent(
    new CustomEvent<BeforeNavigateDetail>(BEFORE_NAVIGATE_EVENT, {
      cancelable: true,
      detail: { destination },
    }),
  );
}

export function AppHeader() {
  const router = useRouter();
  const [query, setQuery] = useState("");

  function visitHome(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!navigationAllowed("/entries")) event.preventDefault();
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = query.trim();
    if (!value) return;
    const destination = `/search?q=${encodeURIComponent(value)}`;
    if (!navigationAllowed(destination)) return;
    router.push(destination);
  }

  return (
    <header className="app-header">
      <Link className="brand" href="/entries" aria-label="Neum knowledge library" onClick={visitHome}>
        {cartesianMark}
        <strong>Neum</strong>
      </Link>

      <form className="global-search" role="search" onSubmit={submitSearch}>
        <label className="sr-only" htmlFor="global-search-input">
          Search all entries
        </label>
        <input
          id="global-search-input"
          name="q"
          type="search"
          autoComplete="off"
          placeholder="Search knowledge, code, and tags…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="submit">Search</button>
      </form>
    </header>
  );
}
