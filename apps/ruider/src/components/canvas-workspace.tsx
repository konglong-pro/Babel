"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import {
  createCanvas,
  deleteCanvas,
  getCanvas,
  getErrorMessage,
  listCanvases,
  updateCanvas,
} from "@/lib/api-client";
import type { CanvasDetailDto, CanvasSummaryDto } from "@/lib/types";

import { CanvasEditor } from "./canvas-editor";

interface CanvasWorkspaceProps {
  initialCanvasId: number | null;
}

export function CanvasWorkspace({ initialCanvasId }: CanvasWorkspaceProps) {
  const router = useRouter();
  const [requestedInitialCanvasId] = useState(initialCanvasId);
  const [canvases, setCanvases] = useState<CanvasSummaryDto[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(initialCanvasId);
  const [selectedCanvas, setSelectedCanvas] = useState<CanvasDetailDto | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void listCanvases()
      .then((items) => {
        if (!active) return;
        setCanvases(items);
        const initialExists = requestedInitialCanvasId !== null && items.some(({ id }) => id === requestedInitialCanvasId);
        const nextId = initialExists ? requestedInitialCanvasId : (items[0]?.id ?? null);
        setDetailLoading(nextId !== null);
        if (nextId === null) setSelectedCanvas(null);
        setSelectedId(nextId);
        if (nextId !== null && nextId !== requestedInitialCanvasId) {
          router.replace(`/canvases?canvas=${nextId}`);
        }
      })
      .catch((cause: unknown) => active && setError(getErrorMessage(cause)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [requestedInitialCanvasId, router]);

  useEffect(() => {
    if (selectedId === null) return;
    const controller = new AbortController();
    void getCanvas(selectedId, controller.signal)
      .then((canvas) => setSelectedCanvas(canvas))
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(getErrorMessage(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });
    return () => controller.abort();
  }, [selectedId]);

  function openCanvas(id: number) {
    setDetailLoading(true);
    setError(null);
    setSelectedId(id);
    router.push(`/canvases?canvas=${id}`);
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = newTitle.trim() || "Untitled canvas";
    try {
      setError(null);
      const created = await createCanvas(title);
      setCanvases((items) => [created, ...items]);
      setNewTitle("");
      setSelectedCanvas(created);
      openCanvas(created.id);
    } catch (cause) {
      setError(getErrorMessage(cause));
    }
  }

  async function renameSelected() {
    if (!selectedCanvas) return;
    const title = window.prompt("Canvas name", selectedCanvas.title)?.trim();
    if (!title || title === selectedCanvas.title) return;
    try {
      const updated = await updateCanvas(selectedCanvas.id, { title });
      setSelectedCanvas(updated);
      reflectSummary(updated);
    } catch (cause) {
      setError(getErrorMessage(cause));
    }
  }

  async function removeSelected() {
    if (!selectedCanvas) return;
    if (!window.confirm(`Delete “${selectedCanvas.title}”? This cannot be undone.`)) return;
    try {
      await deleteCanvas(selectedCanvas.id);
      const remaining = canvases.filter(({ id }) => id !== selectedCanvas.id);
      setCanvases(remaining);
      setSelectedCanvas(null);
      const nextId = remaining[0]?.id ?? null;
      setDetailLoading(nextId !== null);
      setSelectedId(nextId);
      router.replace(nextId === null ? "/canvases" : `/canvases?canvas=${nextId}`);
    } catch (cause) {
      setError(getErrorMessage(cause));
    }
  }

  const reflectSummary = useCallback((canvas: CanvasDetailDto) => {
    setCanvases((items) => {
      const next = items.map((item) => (item.id === canvas.id ? canvas : item));
      return next.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    });
  }, []);

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
      </aside>

      <div className="canvas-main">
        {error ? (
          <div className="canvas-alert" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)}>Dismiss</button>
          </div>
        ) : null}
        {detailLoading ? <div className="standalone-status">Opening canvas…</div> : null}
        {!detailLoading && selectedCanvas ? (
          <>
            <div className="canvas-document-bar">
              <div>
                <span className="eyebrow">Open canvas</span>
                <h2>{selectedCanvas.title}</h2>
              </div>
              <div className="canvas-document-actions">
                <button type="button" onClick={renameSelected}>Rename</button>
                <button className="danger-ghost" type="button" onClick={removeSelected}>Delete</button>
              </div>
            </div>
            <CanvasEditor key={selectedCanvas.id} canvas={selectedCanvas} onSaved={reflectSummary} />
          </>
        ) : null}
        {!detailLoading && !selectedCanvas && !loading ? (
          <div className="canvas-welcome">
            <Image className="canvas-welcome__mark" src="/icon.svg" alt="" width={156} height={156} />
            <span aria-hidden="true">✦</span>
            <span className="canvas-welcome__kicker">No polished thoughts required</span>
            <h2>Set your ideas loose.</h2>
            <p>Create a named canvas, then throw in cards, marks, shapes, and connections.</p>
            <svg className="canvas-welcome__scribble" viewBox="0 0 180 34" aria-hidden="true">
              <path d="M3 22c21-25 32 16 52-5s37 17 58-5 33 17 63-7" />
            </svg>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}
