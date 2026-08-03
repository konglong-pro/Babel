"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createWorkspaceProcessRouteTargetTracker,
  usePageSessionHistoryGuard,
  usePageSessions,
  useWorkspaceProcessActive,
  workspaceProcessRouteTargetShouldApply,
} from "@babel-apps/platform/pages/react";

import {
  BEFORE_NAVIGATE_EVENT,
} from "@/components/app-header";
import {
  ReflectionPageSession,
  reflectionPage,
  validReflectionDate,
} from "@/components/reflection-page-session";
import {
  getErrorMessage,
  listReflections,
} from "@/lib/api-client";
import type {
  ReflectionDetailDto,
  ReflectionSummaryDto,
} from "@/lib/types";
import type { ValiSearchFocus } from "@/lib/search-focus";
import { isValiWorkspaceDestination } from "@/lib/workspace-process";

function localToday(): string {
  const now = new Date();
  return [
    String(now.getFullYear()).padStart(4, "0"),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatWeekday(date: string): string {
  return new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(
    new Date(`${date}T00:00:00`),
  );
}

function dateFromPageKey(pageKey: string | null): string | null {
  if (pageKey === null || !pageKey.startsWith("reflection:")) return null;
  const date = pageKey.slice("reflection:".length);
  return validReflectionDate(date) ? date : null;
}

interface ReflectionWorkspaceProps {
  initialDate: string | null;
  initialSearchFocus?: ValiSearchFocus | null;
  routeTargetKey?: string;
}

export function ReflectionWorkspace({
  initialDate,
  initialSearchFocus = null,
  routeTargetKey = "initial",
}: ReflectionWorkspaceProps) {
  const router = useRouter();
  const processActive = useWorkspaceProcessActive();
  const { pages, activeKey, activatePage, closePage, openPage } = usePageSessions();
  const [today, setToday] = useState(initialDate ?? "");
  const [dateDraft, setDateDraft] = useState(initialDate ?? "");
  const [summaries, setSummaries] = useState<ReflectionSummaryDto[]>([]);
  const [indexLoading, setIndexLoading] = useState(true);
  const [error, setError] = useState("");
  const openedRouteTargetRef = useRef<string | null>(null);
  const routeTargetTrackerRef = useRef(createWorkspaceProcessRouteTargetTracker());

  useEffect(() => {
    let active = true;
    listReflections()
      .then((next) => {
        if (!active) return;
        const localDate = localToday();
        setToday(localDate);
        if (!initialDate) setDateDraft(localDate);
        setSummaries(next);
      })
      .catch((caught) => {
        if (active) setError(getErrorMessage(caught));
      })
      .finally(() => {
        if (active) setIndexLoading(false);
      });
    return () => {
      active = false;
    };
  }, [initialDate]);

  useEffect(() => {
    const shouldApplyRouteTarget = workspaceProcessRouteTargetShouldApply(
      routeTargetTrackerRef.current,
      processActive,
      routeTargetKey,
    );
    if (
      indexLoading ||
      !shouldApplyRouteTarget ||
      openedRouteTargetRef.current === routeTargetKey
    ) return;
    openedRouteTargetRef.current = routeTargetKey;
    const requestedDate = initialDate && validReflectionDate(initialDate)
      ? initialDate
      : today;
    if (requestedDate) openPage(reflectionPage(requestedDate));
  }, [
    indexLoading,
    initialDate,
    openPage,
    processActive,
    routeTargetKey,
    today,
  ]);

  const activePage = pages.find(
    (page) => page.key === activeKey && page.kind === "Reflection",
  ) ?? null;
  const selectedDate = dateFromPageKey(activeKey);
  const savedDates = useMemo(
    () => new Set(summaries.map(({ date }) => date)),
    [summaries],
  );
  const visibleDates = useMemo(() => {
    const dates = new Set(summaries.map(({ date }) => date));
    if (today) dates.add(today);
    for (const page of pages) {
      const date = dateFromPageKey(page.key);
      if (date !== null) dates.add(date);
    }
    return [...dates].sort((left, right) => right.localeCompare(left));
  }, [pages, summaries, today]);
  const hasUnsavedPages = pages.some((page) => page.dirty || page.pending);

  useEffect(() => {
    if (!processActive || activePage === null) return;
    const url = new URL(activePage.href, window.location.origin);
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl !== currentUrl) {
      window.history.replaceState(window.history.state, "", nextUrl);
    }
  }, [activePage, processActive]);

  useEffect(() => {
    if (!processActive) return;
    const beforeNavigate = (event: Event) => {
      const navigationEvent = event as CustomEvent<{ destination?: string }>;
      if (isValiWorkspaceDestination(navigationEvent.detail?.destination ?? "")) {
        return;
      }
      const dirtyPages = pages.filter((page) => page.dirty || page.pending);
      if (
        dirtyPages.length > 0 &&
        !window.confirm("Discard your unsaved reflection changes?")
      ) {
        event.preventDefault();
        return;
      }
      for (const page of dirtyPages) closePage(page.key);
    };
    window.addEventListener(BEFORE_NAVIGATE_EVENT, beforeNavigate);
    return () => window.removeEventListener(BEFORE_NAVIGATE_EVENT, beforeNavigate);
  }, [closePage, pages, processActive]);

  function openDate(date: string) {
    if (!validReflectionDate(date)) return;
    openPage(reflectionPage(date));
    setDateDraft(date);
  }

  function openNote(id: number, folderId?: number) {
    const params = new URLSearchParams();
    if (folderId !== undefined) params.set("folder", String(folderId));
    params.set("note", String(id));
    const existingPage = pages.find((page) => page.key === `note:${id}`);
    const href = folderId === undefined && existingPage !== undefined
      ? existingPage.href
      : `/notes?${params}`;
    openPage(existingPage
      ? { ...existingPage, href, scope: "notes" }
      : {
          key: `note:${id}`,
          kind: "Note",
          title: `Note ${id}`,
          href,
          scope: "notes",
        });
    router.push(href);
  }

  function handleSaved(saved: ReflectionDetailDto) {
    setSummaries((current) => [
      saved,
      ...current.filter(({ date }) => date !== saved.date),
    ].sort((left, right) => right.date.localeCompare(left.date)));
  }

  return (
    <div className={`reflection-workspace${hasUnsavedPages ? " has-unsaved" : ""}`}>
      {processActive ? <ActiveReflectionHistoryGuard /> : null}
      <aside className="reflection-index workspace-panel" aria-label="Reflection dates">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Daily unit</span>
            <h1>Reflection</h1>
          </div>
          <div className="reflection-heading-actions">
            <span className="count-badge">{summaries.length}</span>
          </div>
        </div>
        <form
          className="reflection-date-picker"
          onSubmit={(event) => {
            event.preventDefault();
            openDate(dateDraft);
          }}
        >
          <label className="sr-only" htmlFor="reflection-date">Reflection date</label>
          <input
            id="reflection-date"
            type="date"
            min="0001-01-01"
            value={dateDraft}
            onChange={(event) => setDateDraft(event.target.value)}
          />
          <button type="submit" disabled={!validReflectionDate(dateDraft)}>Open</button>
        </form>
        {indexLoading ? <p className="panel-status">Loading dates…</p> : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <ol className="reflection-date-list">
          {visibleDates.map((date) => (
            <li key={date}>
              <button
                className={date === selectedDate ? "selected" : undefined}
                type="button"
                aria-current={date === selectedDate ? "date" : undefined}
                onClick={() => openDate(date)}
              >
                <strong>{date}</strong>
                <span>{date === today ? "Today" : formatWeekday(date)}</span>
                {!savedDates.has(date) ? <small>Not saved</small> : null}
              </button>
            </li>
          ))}
        </ol>
      </aside>

      {indexLoading ? (
        <main className="reflection-detail detail-panel">
          <div className="standalone-status">Loading reflections…</div>
        </main>
      ) : (
        <>
          {pages
            .filter((page) => page.kind === "Reflection")
            .map((page) => {
              const date = dateFromPageKey(page.key);
              if (date === null) return null;
              return (
                <ReflectionPageSession
                  key={page.key}
                  pageKey={page.key}
                  date={date}
                  exists={savedDates.has(date)}
                  searchFocus={date === initialDate ? initialSearchFocus : null}
                  onOpenDate={openDate}
                  onOpenNote={openNote}
                  onSaved={handleSaved}
                />
              );
            })}
          {activePage === null ? (
            <main className="reflection-detail detail-panel">
              <div className="standalone-status">
                Choose a date to open a reflection page.
                <button type="button" onClick={() => activatePage(null)}>Dates</button>
              </div>
            </main>
          ) : null}
        </>
      )}
    </div>
  );
}

function ActiveReflectionHistoryGuard() {
  usePageSessionHistoryGuard({
    message: "Discard your unsaved reflection changes?",
    preserveOnHistoryNavigation: true,
  });
  return null;
}
