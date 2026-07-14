"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type FormEvent, type MouseEvent, useState } from "react";

import { entryUnitPath } from "@/lib/entry-routes";
import type { EntryKind } from "@/lib/types";

export const BEFORE_NAVIGATE_EVENT = "neum:before-navigate";

export interface BeforeNavigateDetail {
  destination: string;
}

const UNIT_TABS: readonly { kind: EntryKind; label: string }[] = [
  { kind: "knowledge", label: "Knowledge" },
  { kind: "snippet", label: "Code" },
];

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
  const pathname = usePathname();
  const router = useRouter();
  const [query, setQuery] = useState("");

  function visit(event: MouseEvent<HTMLAnchorElement>, destination: string) {
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
      <Link
        className="brand"
        href="/knowledge"
        aria-label="Neum knowledge library"
        onClick={(event) => visit(event, "/knowledge")}
      >
        {cartesianMark}
        <strong>Neum</strong>
      </Link>

      <nav className="unit-tabs" aria-label="Neum units">
        {UNIT_TABS.map(({ kind, label }) => {
          const href = entryUnitPath(kind);
          const active = pathname === href;
          return (
            <Link
              key={kind}
              href={href}
              className={active ? "active" : undefined}
              aria-current={active ? "page" : undefined}
              onClick={(event) => visit(event, href)}
            >
              {label}
            </Link>
          );
        })}
      </nav>

      <form className="global-search" role="search" onSubmit={submitSearch}>
        <label className="sr-only" htmlFor="global-search-input">
          Search all entries
        </label>
        <input
          id="global-search-input"
          data-babel-command="search"
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
