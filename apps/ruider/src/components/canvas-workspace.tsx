"use client";

import Image from "next/image";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  usePageSessionHistoryGuard,
  usePageSessions,
} from "@babel-apps/platform/pages/react";

import {
  CanvasPageSession,
  savedCanvasPage,
} from "@/components/canvas-page-session";
import {
  createCanvas,
  getErrorMessage,
  listCanvases,
} from "@/lib/api-client";
import type { CanvasDetailDto, CanvasSummaryDto } from "@/lib/types";

interface CanvasWorkspaceProps {
  initialCanvasId: number | null;
}

function canvasIdFromKey(pageKey: string | null): number | null {
  if (pageKey === null || !pageKey.startsWith("canvas:")) return null;
  const id = Number(pageKey.slice("canvas:".length));
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function CanvasWorkspace({ initialCanvasId }: CanvasWorkspaceProps) {
  const { pages, activeKey, activatePage, openPage } = usePageSessions();
  const [canvases, setCanvases] = useState<CanvasSummaryDto[]>([]);
  const [newTitle, setNewTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const initialOpenedRef = useRef(false);

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
    if (loading || initialOpenedRef.current) return;
    initialOpenedRef.current = true;
    const requested = initialCanvasId === null
      ? null
      : canvases.find(({ id }) => id === initialCanvasId) ?? null;
    if (requested !== null) {
      openPage(savedCanvasPage(requested));
      return;
    }
    const activeCanvas = pages.find(
      (page) => page.key === activeKey && page.kind === "Canvas",
    );
    if (activeCanvas !== undefined) return;
    const existingCanvas = pages.findLast((page) => page.kind === "Canvas");
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
  ]);

  const activePage = pages.find(
    (page) => page.key === activeKey && page.kind === "Canvas",
  ) ?? null;
  const selectedId = canvasIdFromKey(activeKey);

  useEffect(() => {
    if (activePage === null) return;
    const url = new URL(activePage.href, window.location.origin);
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl !== currentUrl) {
      window.history.replaceState(window.history.state, "", nextUrl);
    }
  }, [activePage]);

  usePageSessionHistoryGuard();

  function openCanvas(id: number) {
    const canvas = canvases.find((candidate) => candidate.id === id);
    openPage(canvas
      ? savedCanvasPage(canvas)
      : {
          key: `canvas:${id}`,
          kind: "Canvas",
          title: `Canvas ${id}`,
          href: `/canvases?canvas=${id}`,
        });
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = newTitle.trim() || "Untitled canvas";
    try {
      setError(null);
      const created = await createCanvas(title);
      setCanvases((items) => [created, ...items]);
      setNewTitle("");
      openPage(savedCanvasPage(created));
    } catch (cause) {
      setError(getErrorMessage(cause));
    }
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

  return (
    <section className="canvas-workspace" aria-label="Ruider canvases">
      <aside className="canvas-library">
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
        <ul className="canvas-list">
          {canvases.map((canvas) => (
            <li key={canvas.id}>
              <button
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
          .filter((page) => page.kind === "Canvas")
          .map((page) => {
            const canvasId = canvasIdFromKey(page.key);
            if (canvasId === null) return null;
            return (
              <CanvasPageSession
                key={page.key}
                pageKey={page.key}
                canvasId={canvasId}
                onSaved={reflectSummary}
                onDeleted={removeSummary}
                onError={setError}
              />
            );
          })}
        {activePage === null && !loading ? (
          <div className="canvas-main">
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

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}
