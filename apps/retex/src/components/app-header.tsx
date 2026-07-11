"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

export function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [query, setQuery] = useState("");

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = query.trim();
    if (value) router.push(`/search?q=${encodeURIComponent(value)}`);
  }

  return (
    <header className="app-header">
      <Link className="brand" href="/knowledge" aria-label="ReTex home">
        <span className="brand-mark" aria-hidden="true">
          R
        </span>
        <span>
          <strong>ReTex</strong>
          <small>Math Archive</small>
        </span>
      </Link>

      <nav className="space-tabs" aria-label="Main spaces">
        <Link
          href="/knowledge"
          aria-current={pathname.startsWith("/knowledge") ? "page" : undefined}
        >
          Knowledge
        </Link>
        <Link
          href="/exercise"
          aria-current={pathname.startsWith("/exercise") ? "page" : undefined}
        >
          Exercise
        </Link>
      </nav>

      <form className="global-search" role="search" onSubmit={submitSearch}>
        <label className="sr-only" htmlFor="global-search-input">
          Global search
        </label>
        <input
          id="global-search-input"
          name="q"
          type="search"
          autoComplete="off"
          placeholder="Search titles, notes, solutions, or tags…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="submit">Search</button>
      </form>
    </header>
  );
}
