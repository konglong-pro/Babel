"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type FormEvent, type MouseEvent, useState } from "react";

export const BEFORE_NAVIGATE_EVENT = "vali:before-navigate";

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
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState("");

  function visitHome(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!navigationAllowed("/notes")) event.preventDefault();
  }

  function visitSection(destination: string, event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!navigationAllowed(destination)) event.preventDefault();
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
      <Link className="brand" href="/notes" aria-label="Vali notes home" onClick={visitHome}>
        <span className="brand-rule" aria-hidden="true" />
        <strong>Vali</strong>
      </Link>

      <nav className="unit-navigation" aria-label="Vali units">
        <Link
          className={pathname.startsWith("/notes") ? "active" : undefined}
          aria-current={pathname.startsWith("/notes") ? "page" : undefined}
          href="/notes"
          onClick={(event) => visitSection("/notes", event)}
        >
          Notes
        </Link>
        <Link
          className={pathname.startsWith("/reflection") ? "active" : undefined}
          aria-current={pathname.startsWith("/reflection") ? "page" : undefined}
          href="/reflection"
          onClick={(event) => visitSection("/reflection", event)}
        >
          Reflection
        </Link>
      </nav>

      <form className="global-search" role="search" onSubmit={submitSearch}>
        <label className="sr-only" htmlFor="global-search-input">
          Search all Vali documents
        </label>
        <input
          id="global-search-input"
          data-babel-command="search"
          name="q"
          type="search"
          autoComplete="off"
          placeholder="Search notes and reflections"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="submit">Search</button>
      </form>
    </header>
  );
}
