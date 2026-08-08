"use client";

import Image from "next/image";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  createWorkspaceProcessRouteTargetTracker,
  pageBelongsToWorkspaceProcess,
  usePageSessionHistoryGuard,
  usePageSessions,
  useWorkspaceProcessActive,
  workspaceProcessRouteTargetShouldApply,
} from "@babel-apps/platform/pages/react";
import {
  useListKeyboardNavigation,
  usePaneFocus,
} from "@babel-apps/platform/navigation/react";
import {
  useCommandPaletteActions,
  useCommandPaletteItemSource,
} from "@babel-apps/platform/shortcuts/react";

import {
  CanvasPageSession,
  savedCanvasPage,
} from "@/components/canvas-page-session";
import {
  BEFORE_NAVIGATE_EVENT,
  type BeforeNavigateDetail,
} from "@/components/app-header";
import {
  createCanvas,
  getErrorMessage,
  listCanvases,
} from "@/lib/api-client";
import type { CanvasDetailDto, CanvasSummaryDto } from "@/lib/types";
import {
  isRuiderWorkspaceDestination,
  ruiderWorkspaceRegistration,
} from "@/lib/workspace-process";

interface CanvasWorkspaceProps {
  initialCanvasId: number | null;
  routeTargetKey?: string;
}

const CANVASES_PROCESS = ruiderWorkspaceRegistration("canvases");

function canvasIdFromKey(pageKey: string | null): number | null {
  if (pageKey === null || !pageKey.startsWith("canvas:")) return null;
  const id = Number(pageKey.slice("canvas:".length));
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function CanvasWorkspace({
  initialCanvasId,
  routeTargetKey = "initial",
}: CanvasWorkspaceProps) {
  const processActive = useWorkspaceProcessActive();
  const { pages, activeKey, activatePage, closePage, openPage } = usePageSessions();
  const [canvases, setCanvases] = useState<CanvasSummaryDto[]>([]);
  const [newTitle, setNewTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingRenameCanvasId, setPendingRenameCanvasId] = useState<number | null>(null);
  const routeTargetTrackerRef = useRef(createWorkspaceProcessRouteTargetTracker());
  const openedRouteTargetRef = useRef<string | null>(null);
  const { focusPane } = usePaneFocus();

  useEffect(() => {
    let active = true;
    listCanvases()
      .then((items) => {
        if (active) setCanvases(items);
      })
      .catch((cause: unknown) => {
        if (active) setError(getErrorMessage(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const shouldApplyRouteTarget = workspaceProcessRouteTargetShouldApply(
      routeTargetTrackerRef.current,
      processActive,
      routeTargetKey,
    );
    if (
      !shouldApplyRouteTarget ||
      loading ||
      openedRouteTargetRef.current === routeTargetKey
    ) return;
    openedRouteTargetRef.current = routeTargetKey;
    const requested = initialCanvasId === null
      ? null
      : canvases.find(({ id }) => id === initialCanvasId) ?? null;
    if (requested !== null) {
      openPage(savedCanvasPage(requested));
      return;
    }
    const activeCanvas = pages.find(
      (page) => page.key === activeKey &&
        pageBelongsToWorkspaceProcess(page, CANVASES_PROCESS),
    );
    if (activeCanvas !== undefined) return;
    const existingCanvas = pages.findLast((page) =>
      pageBelongsToWorkspaceProcess(page, CANVASES_PROCESS)
    );
    if (existingCanvas !== undefined) {
      activatePage(existingCanvas.key);
      return;
    }
    const first = canvases[0];
    if (first !== undefined) openPage(savedCanvasPage(first));
  }, [
    activatePage,
    activeKey,
    canvases,
    initialCanvasId,
    loading,
    openPage,
    pages,
    processActive,
    routeTargetKey,
  ]);

  const activePage = pages.find(
    (page) => page.key === activeKey &&
      pageBelongsToWorkspaceProcess(page, CANVASES_PROCESS),
  ) ?? null;
  const selectedId = canvasIdFromKey(activeKey);

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
      const navigationEvent = event as CustomEvent<BeforeNavigateDetail>;
      if (isRuiderWorkspaceDestination(navigationEvent.detail?.destination ?? "")) {
        return;
      }
      const dirtyPages = pages.filter((page) => page.dirty || page.pending);
      if (
        dirtyPages.length > 0 &&
        !window.confirm("Discard your unsaved changes?")
      ) {
        event.preventDefault();
        return;
      }
      for (const page of dirtyPages) closePage(page.key);
    };
    window.addEventListener(BEFORE_NAVIGATE_EVENT, beforeNavigate);
    return () => window.removeEventListener(BEFORE_NAVIGATE_EVENT, beforeNavigate);
  }, [closePage, pages, processActive]);

  function openCanvas(id: number) {
    const canvas = canvases.find((candidate) => candidate.id === id);
    openPage(canvas
      ? savedCanvasPage(canvas)
      : {
          key: `canvas:${id}`,
          kind: "Canvas",
          scope: "canvases",
          title: `Canvas ${id}`,
          href: `/canvases?canvas=${id}`,
        });
    window.requestAnimationFrame(() => focusPane("detail"));
  }

  function openCanvasForRename(id: number) {
    setPendingRenameCanvasId(id);
    openCanvas(id);
  }

  function showCanvasList() {
    activatePage(null);
    window.requestAnimationFrame(() => focusPane("items"));
  }

  async function createNewCanvas() {
    const title = newTitle.trim() || "Untitled canvas";
    try {
      setError(null);
      const created = await createCanvas(title);
      setCanvases((items) => [created, ...items]);
      setNewTitle("");
      openPage(savedCanvasPage(created));
      window.requestAnimationFrame(() => focusPane("detail"));
    } catch (cause) {
      setError(getErrorMessage(cause));
    }
  }

  function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void createNewCanvas();
  }

  const reflectSummary = useCallback((canvas: CanvasDetailDto) => {
    setCanvases((items) => {
      const existing = items.some((item) => item.id === canvas.id);
      const next = existing
        ? items.map((item) => (item.id === canvas.id ? canvas : item))
        : [canvas, ...items];
      return next.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    });
  }, []);

  function removeSummary(id: number) {
    const remaining = canvases.filter((canvas) => canvas.id !== id);
    setCanvases(remaining);
    const nextCanvas = remaining[0];
    if (nextCanvas !== undefined) openPage(savedCanvasPage(nextCanvas));
  }

  const canvasNavigation = useListKeyboardNavigation<number>({
    items: canvases.map((canvas) => ({ id: canvas.id, label: canvas.title })),
    selectedId,
    onActivate: openCanvas,
    onEdit: openCanvasForRename,
    label: "Canvases",
  });

  useCommandPaletteItemSource({
    id: "ruider.canvases",
    label: "Canvases",
    items: canvases.map((canvas) => ({
      id: String(canvas.id),
      dedupeKey: `ruider:canvas:${canvas.id}`,
      label: canvas.title,
      description: formatUpdatedAt(canvas.updatedAt),
      open: () => openCanvas(canvas.id),
      edit: () => openCanvasForRename(canvas.id),
    })),
  });

  useCommandPaletteActions("ruider.canvases", processActive ? [
    {
      id: "ruider.canvases.new",
      label: "New canvas",
      keywords: ["create", "brainstorm", "canvas"],
      group: "Canvas",
      run: () => void createNewCanvas(),
    },
  ] : []);

  return (
    <section className="canvas-workspace" aria-label="Ruider canvases">
      {processActive ? <ActiveCanvasHistoryGuard /> : null}
      <aside className="canvas-library" data-babel-pane="items" tabIndex={-1}>
        <div className="canvas-library__heading">
          <div>
            <span className="eyebrow">Brainstorm</span>
            <h1>Canvases</h1>
          </div>
          <span className="canvas-count">{canvases.length}</span>
        </div>

        <form className="canvas-create" onSubmit={submitCreate}>
          <label className="sr-only" htmlFor="new-canvas-title">New canvas name</label>
          <input
            id="new-canvas-title"
            value={newTitle}
            maxLength={160}
            placeholder="New canvas name"
            onChange={(event) => setNewTitle(event.target.value)}
          />
          <button className="primary-button" type="submit">New</button>
        </form>

        {loading ? <p className="panel-status">Loading canvases…</p> : null}
        {!loading && canvases.length === 0 ? (
          <div className="canvas-library__empty">
            <strong>No canvases yet</strong>
            <span>Name one above and start throwing ideas around.</span>
          </div>
        ) : null}
        <ul className="canvas-list" {...canvasNavigation.listboxProps}>
          {canvases.map((canvas) => (
            <li key={canvas.id} role="presentation">
              <button
                {...canvasNavigation.getOptionProps(canvas.id)}
                className={canvas.id === selectedId ? "selected" : undefined}
                type="button"
                onClick={() => openCanvas(canvas.id)}
              >
                <strong>{canvas.title}</strong>
                <time dateTime={canvas.updatedAt}>{formatUpdatedAt(canvas.updatedAt)}</time>
              </button>
            </li>
          ))}
        </ul>
        {error ? (
          <div className="canvas-alert" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)}>Dismiss</button>
          </div>
        ) : null}
      </aside>

      <>
        {pages
          .filter((page) => pageBelongsToWorkspaceProcess(page, CANVASES_PROCESS))
          .map((page) => {
            const canvasId = canvasIdFromKey(page.key);
            if (canvasId === null) return null;
            return (
              <CanvasPageSession
                key={page.key}
                pageKey={page.key}
                canvasId={canvasId}
                renameRequested={pendingRenameCanvasId === canvasId}
                onRenameRequestConsumed={() => {
                  setPendingRenameCanvasId((current) => current === canvasId ? null : current);
                }}
                onSaved={reflectSummary}
                onDeleted={removeSummary}
                onError={setError}
                onShowList={showCanvasList}
              />
            );
          })}
        {activePage === null && !loading ? (
          <div className="canvas-main" data-babel-pane="detail" tabIndex={-1}>
            <div className="canvas-welcome">
              <Image
                className="canvas-welcome__mark"
                src="/icon.svg"
                alt=""
                width={156}
                height={156}
              />
              <span aria-hidden="true">✦</span>
              <span className="canvas-welcome__kicker">No polished thoughts required</span>
              <h2>Set your ideas loose.</h2>
              <p>Create a named canvas, then throw in cards, marks, shapes, and connections.</p>
              <svg className="canvas-welcome__scribble" viewBox="0 0 180 34" aria-hidden="true">
                <path d="M3 22c21-25 32 16 52-5s37 17 58-5 33 17 63-7" />
              </svg>
            </div>
          </div>
        ) : null}
      </>
    </section>
  );
}

function ActiveCanvasHistoryGuard() {
  usePageSessionHistoryGuard({ preserveOnHistoryNavigation: true });
  return null;
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}
