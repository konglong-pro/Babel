"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type FormEvent, type MouseEvent, useState } from "react";
import { openSearchWindow } from "@babel-apps/platform/search/window";

import { MarsLogo } from "@/components/mars-logo";

export const BEFORE_NAVIGATE_EVENT = "matter:before-navigate";

export interface BeforeNavigateDetail {
  destination: string;
  proceed?: () => void;
}

export function navigationAllowed(destination: string, proceed?: () => void): boolean {
  return window.dispatchEvent(
    new CustomEvent<BeforeNavigateDetail>(BEFORE_NAVIGATE_EVENT, {
      cancelable: true,
      detail: { destination, proceed },
    }),
  );
}

export function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [searchWindowError, setSearchWindowError] = useState("");

  function visit(event: MouseEvent<HTMLAnchorElement>, destination: string) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!navigationAllowed(destination, () => router.push(destination))) {
      event.preventDefault();
    }
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
      "babel-matter-search",
      { sessionStorageKeys: ["babel:matter:pages"] },
    )) {
      setSearchWindowError("Allow pop-ups to search without leaving this workspace.");
    }
  }

  return (
    <header className="app-header">
      <Link
        className="brand"
        href="/knowledge"
        aria-label="Matter home"
        onClick={(event) => visit(event, "/knowledge")}
      >
        <span className="brand-mark" aria-hidden="true">
          <MarsLogo />
        </span>
        <span className="brand-copy">
          <strong>Matter</strong>
          <small>Physics / Field Notes</small>
        </span>
      </Link>

      <nav className="space-tabs" aria-label="Main spaces">
        <Link
          href="/knowledge"
          aria-current={pathname.startsWith("/knowledge") ? "page" : undefined}
          onClick={(event) => visit(event, "/knowledge")}
        >
          Knowledge
        </Link>
        <Link
          href="/exercise"
          aria-current={pathname.startsWith("/exercise") ? "page" : undefined}
          onClick={(event) => visit(event, "/exercise")}
        >
          Exercise
        </Link>
        <Link
          href="/canvases"
          aria-current={pathname.startsWith("/canvases") ? "page" : undefined}
          onClick={(event) => visit(event, "/canvases")}
        >
          Canvases
        </Link>
      </nav>

      <form className="global-search" role="search" onSubmit={submitSearch}>
        <label className="sr-only" htmlFor="global-search-input">
          Global search
        </label>
        <input
          id="global-search-input"
          data-babel-command="search"
          name="q"
          type="search"
          autoComplete="off"
          placeholder="Search titles, notes, solutions, or tags…"
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
