"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

import { useListKeyboardNavigation, usePaneFocus } from "../navigation/react";
import { type PageSessionDescriptor } from "../pages/core";
import {
  PageDeckPage,
  pageBelongsToWorkspaceProcess,
  usePageSessionHistoryGuard,
  usePageSessionLifecycle,
  usePageSessions,
  useWorkspaceProcessActive,
  workspaceProcessRouteTargetShouldApply,
  createWorkspaceProcessRouteTargetTracker,
} from "../pages/react";
import { useCommandPaletteActions, useCommandPaletteItemSource } from "../shortcuts/react";
import { CanvasEditor } from "./react";
import type { CanvasApiClient, CanvasDetail, CanvasSummary } from "./core";

export interface CanvasWorkspaceProcess {
  readonly key: string;
  readonly pathname: string;
  readonly scope: string;
  readonly legacyPageKinds?: readonly string[];
}

export interface SharedCanvasWorkspaceProps {
  appId: string;
  appName: string;
  api: CanvasApiClient;
  process: CanvasWorkspaceProcess;
  initialCanvasId: number | null;
  routeTargetKey?: string;
  creationRequestKey?: string | null;
  beforeNavigateEvent: string;
  isWorkspaceDestination: (destination: string) => boolean;
}

function canvasIdFromKey(pageKey: string | null): number | null {
  if (pageKey === null || !pageKey.startsWith("canvas:")) return null;
  const id = Number(pageKey.slice("canvas:".length));
  return Number.isInteger(id) && id > 0 ? id : null;
}

function savedCanvasPage(process: CanvasWorkspaceProcess, canvas: Pick<CanvasDetail, "id" | "title">): PageSessionDescriptor {
  return {
    key: `canvas:${canvas.id}`,
    kind: "Canvas",
    scope: process.scope,
    title: canvas.title,
    href: `${process.pathname}?canvas=${canvas.id}`,
  };
}

export function SharedCanvasWorkspace({
  appId,
  appName,
  api,
  process,
  initialCanvasId,
  routeTargetKey = "initial",
  creationRequestKey = null,
  beforeNavigateEvent,
  isWorkspaceDestination,
}: SharedCanvasWorkspaceProps) {
  const processActive = useWorkspaceProcessActive();
  const { pages, activeKey, activatePage, closePage, openPage } = usePageSessions();
  const [canvases, setCanvases] = useState<CanvasSummary[]>([]);
  const [newTitle, setNewTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingRenameCanvasId, setPendingRenameCanvasId] = useState<number | null>(null);
  const routeTargetTrackerRef = useRef(createWorkspaceProcessRouteTargetTracker());
  const openedRouteTargetRef = useRef<string | null>(null);
  const handledCreationRequestRef = useRef<string | null>(null);
  const { focusPane } = usePaneFocus();

  useEffect(() => {
    const controller = new AbortController();
    api.list(controller.signal)
      .then(setCanvases)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(api.errorMessage(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [api]);

  useEffect(() => {
    const shouldApplyRouteTarget = workspaceProcessRouteTargetShouldApply(
      routeTargetTrackerRef.current,
      processActive,
      routeTargetKey,
    );
    if (!shouldApplyRouteTarget || loading || openedRouteTargetRef.current === routeTargetKey) return;
    openedRouteTargetRef.current = routeTargetKey;
    const requested = initialCanvasId === null ? null : canvases.find(({ id }) => id === initialCanvasId) ?? null;
    if (requested !== null) {
      openPage(savedCanvasPage(process, requested));
      return;
    }
    const activeCanvas = pages.find((page) => page.key === activeKey && pageBelongsToWorkspaceProcess(page, process));
    if (activeCanvas !== undefined) return;
    const existingCanvas = pages.findLast((page) => pageBelongsToWorkspaceProcess(page, process));
    if (existingCanvas !== undefined) {
      activatePage(existingCanvas.key);
      return;
    }
    const first = canvases[0];
    if (first !== undefined) openPage(savedCanvasPage(process, first));
  }, [activatePage, activeKey, canvases, initialCanvasId, loading, openPage, pages, process, processActive, routeTargetKey]);

  const activePage = pages.find((page) => page.key === activeKey && pageBelongsToWorkspaceProcess(page, process)) ?? null;
  const selectedId = canvasIdFromKey(activeKey);

  useEffect(() => {
    if (!processActive || activePage === null) return;
    const url = new URL(activePage.href, window.location.origin);
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl !== currentUrl) window.history.replaceState(window.history.state, "", nextUrl);
  }, [activePage, processActive]);

  useEffect(() => {
    if (!processActive) return;
    const beforeNavigate = (event: Event) => {
      const destination = (event as CustomEvent<{ destination?: string }>).detail?.destination ?? "";
      if (isWorkspaceDestination(destination)) return;
      const dirtyPages = pages.filter((page) => page.dirty || page.pending);
      if (dirtyPages.length > 0 && !window.confirm("Discard your unsaved changes?")) {
        event.preventDefault();
        return;
      }
      dirtyPages.forEach((page) => closePage(page.key));
    };
    window.addEventListener(beforeNavigateEvent, beforeNavigate);
    return () => window.removeEventListener(beforeNavigateEvent, beforeNavigate);
  }, [beforeNavigateEvent, closePage, isWorkspaceDestination, pages, processActive]);

  const openCanvas = useCallback((id: number) => {
    const canvas = canvases.find((candidate) => candidate.id === id);
    openPage(canvas ? savedCanvasPage(process, canvas) : {
      key: `canvas:${id}`,
      kind: "Canvas",
      scope: process.scope,
      title: `Canvas ${id}`,
      href: `${process.pathname}?canvas=${id}`,
    });
    window.requestAnimationFrame(() => focusPane("detail"));
  }, [canvases, focusPane, openPage, process]);

  const createNewCanvas = useCallback(async (requestedTitle?: string) => {
    const title = requestedTitle?.trim() || newTitle.trim() || "Untitled canvas";
    try {
      setError(null);
      const created = await api.create(title);
      setCanvases((items) => [created, ...items]);
      setNewTitle("");
      openPage(savedCanvasPage(process, created));
      window.requestAnimationFrame(() => focusPane("detail"));
    } catch (cause) {
      setError(api.errorMessage(cause));
    }
  }, [api, focusPane, newTitle, openPage, process]);

  useEffect(() => {
    if (!processActive || loading || creationRequestKey === null ||
      handledCreationRequestRef.current === creationRequestKey) return;
    handledCreationRequestRef.current = creationRequestKey;
    const title = window.prompt("Canvas name", "Untitled canvas");
    if (title === null) {
      window.history.replaceState(window.history.state, "", process.pathname);
      return;
    }
    const timer = window.setTimeout(() => void createNewCanvas(title), 0);
    return () => window.clearTimeout(timer);
  }, [createNewCanvas, creationRequestKey, loading, process.pathname, processActive]);

  function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void createNewCanvas();
  }

  const reflectSummary = useCallback((canvas: CanvasDetail) => {
    setCanvases((items) => {
      const next = items.some((item) => item.id === canvas.id)
        ? items.map((item) => item.id === canvas.id ? canvas : item)
        : [canvas, ...items];
      return next.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    });
  }, []);

  function removeSummary(id: number) {
    const remaining = canvases.filter((canvas) => canvas.id !== id);
    setCanvases(remaining);
    const nextCanvas = remaining[0];
    if (nextCanvas !== undefined) openPage(savedCanvasPage(process, nextCanvas));
  }

  const canvasNavigation = useListKeyboardNavigation<number>({
    items: canvases.map((canvas) => ({ id: canvas.id, label: canvas.title })),
    selectedId,
    onActivate: openCanvas,
    onEdit: (id) => { setPendingRenameCanvasId(id); openCanvas(id); },
    label: "Canvases",
  });

  useCommandPaletteItemSource({
    id: `${appId}.canvases`,
    label: "Canvases",
    items: canvases.map((canvas) => ({
      id: String(canvas.id),
      dedupeKey: `${appId}:canvas:${canvas.id}`,
      label: canvas.title,
      description: formatUpdatedAt(canvas.updatedAt),
      open: () => openCanvas(canvas.id),
      edit: () => { setPendingRenameCanvasId(canvas.id); openCanvas(canvas.id); },
    })),
  });

  useCommandPaletteActions(`${appId}.canvases`, processActive ? [{
    id: `${appId}.canvases.new`,
    label: "New canvas",
    keywords: ["create", "brainstorm", "canvas"],
    group: "Canvas",
    run: () => void createNewCanvas(),
  }] : []);

  return (
    <section className="canvas-workspace" aria-label={`${appName} canvases`}>
      {processActive ? <ActiveCanvasHistoryGuard /> : null}
      <aside className="canvas-library" data-babel-pane="items" tabIndex={-1}>
        <div className="canvas-library__heading"><div><span className="eyebrow">Brainstorm</span><h1>Canvases</h1></div>
          <span className="canvas-count">{canvases.length}</span></div>
        <form className="canvas-create" onSubmit={submitCreate}>
          <label className="sr-only" htmlFor={`${appId}-new-canvas-title`}>New canvas name</label>
          <input id={`${appId}-new-canvas-title`} value={newTitle} maxLength={160} placeholder="New canvas name"
            onChange={(event) => setNewTitle(event.target.value)} />
          <button className="primary-button" type="submit">New</button>
        </form>
        {loading ? <p className="panel-status">Loading canvases…</p> : null}
        {!loading && canvases.length === 0 ? <div className="canvas-library__empty"><strong>No canvases yet</strong>
          <span>Name one above and start collecting ideas.</span></div> : null}
        <ul className="canvas-list" {...canvasNavigation.listboxProps}>
          {canvases.map((canvas) => <li key={canvas.id} role="presentation"><button
            {...canvasNavigation.getOptionProps(canvas.id)} className={canvas.id === selectedId ? "selected" : undefined}
            type="button" onClick={() => openCanvas(canvas.id)}><strong>{canvas.title}</strong>
            <time dateTime={canvas.updatedAt}>{formatUpdatedAt(canvas.updatedAt)}</time></button></li>)}
        </ul>
        {error ? <div className="canvas-alert" role="alert"><span>{error}</span>
          <button type="button" onClick={() => setError(null)}>Dismiss</button></div> : null}
      </aside>
      {pages.filter((page) => pageBelongsToWorkspaceProcess(page, process)).map((page) => {
        const canvasId = canvasIdFromKey(page.key);
        if (canvasId === null) return null;
        return <CanvasPageSession key={page.key} api={api} process={process} pageKey={page.key} canvasId={canvasId}
          renameRequested={pendingRenameCanvasId === canvasId}
          onRenameRequestConsumed={() => setPendingRenameCanvasId((current) => current === canvasId ? null : current)}
          onSaved={reflectSummary} onDeleted={removeSummary} onError={setError}
          onShowList={() => { activatePage(null); window.requestAnimationFrame(() => focusPane("items")); }} />;
      })}
      {activePage === null && !loading ? <div className="canvas-main" data-babel-pane="detail" tabIndex={-1}>
        <div className="canvas-welcome"><span aria-hidden="true">✦</span><span className="canvas-welcome__kicker">Visual workspace</span>
          <h2>Set your ideas loose.</h2><p>Create a named canvas, then add cards, marks, shapes, and connections.</p></div>
      </div> : null}
    </section>
  );
}

function CanvasPageSession({ api, process, pageKey, canvasId, renameRequested, onRenameRequestConsumed,
  onSaved, onDeleted, onError, onShowList }: {
  api: CanvasApiClient;
  process: CanvasWorkspaceProcess;
  pageKey: string;
  canvasId: number;
  renameRequested: boolean;
  onRenameRequestConsumed: () => void;
  onSaved: (canvas: CanvasDetail) => void;
  onDeleted: (id: number) => void;
  onError: (message: string) => void;
  onShowList: () => void;
}) {
  const { activeKey, closePage, setPageStatus, updatePage } = usePageSessions();
  const [canvas, setCanvas] = useState<CanvasDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reloadVersion, setReloadVersion] = useState(0);
  const [saveState, setSaveState] = useState<"saved" | "pending" | "saving" | "error">("saved");
  const saveActionRef = useRef<(() => void) | null>(null);
  const discardActionRef = useRef<(() => Promise<void>) | null>(null);
  const dirty = saveState === "pending" || saveState === "error";
  const pending = saveState === "saving";

  useEffect(() => setPageStatus(pageKey, { dirty, pending }), [dirty, pageKey, pending, setPageStatus]);
  usePageSessionLifecycle(pageKey, {
    save: () => { if (!dirty && !pending) return true; saveActionRef.current?.(); return false; },
    discard: () => discardActionRef.current?.(),
  });

  useEffect(() => {
    const controller = new AbortController();
    api.get(canvasId, controller.signal).then((nextCanvas) => {
      setCanvas(nextCanvas);
      setLoadError("");
      updatePage(pageKey, { scope: process.scope, title: nextCanvas.title, href: savedCanvasPage(process, nextCanvas).href });
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setLoadError(api.errorMessage(cause));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [api, canvasId, pageKey, process, reloadVersion, updatePage]);

  const reflectSaved = useCallback((nextCanvas: CanvasDetail) => { setCanvas(nextCanvas); onSaved(nextCanvas); }, [onSaved]);
  const renameCanvas = useCallback(async () => {
    if (!canvas) return;
    const title = window.prompt("Canvas name", canvas.title)?.trim();
    if (!title || title === canvas.title) return;
    try {
      const updated = await api.update(canvas.id, { title });
      reflectSaved(updated);
      updatePage(pageKey, { scope: process.scope, title: updated.title });
    } catch (cause) { onError(api.errorMessage(cause)); }
  }, [api, canvas, onError, pageKey, process.scope, reflectSaved, updatePage]);

  async function removeCanvas() {
    if (!canvas || !window.confirm(`Delete “${canvas.title}”? Embedded notes will show an unavailable placeholder.`)) return;
    try { await api.delete(canvas.id); closePage(pageKey); onDeleted(canvas.id); }
    catch (cause) { onError(api.errorMessage(cause)); }
  }

  function retryLoading() { setLoading(true); setLoadError(""); setReloadVersion((version) => version + 1); }

  useEffect(() => {
    if (!renameRequested || canvas === null || loading) return;
    const frame = window.requestAnimationFrame(() => { onRenameRequestConsumed(); void renameCanvas(); });
    return () => window.cancelAnimationFrame(frame);
  }, [canvas, loading, onRenameRequestConsumed, renameCanvas, renameRequested]);

  useCommandPaletteActions(`canvas-detail.${pageKey}`, activeKey === pageKey ? [
    ...(canvas !== null && !loading ? [{ id: `canvas.rename.${canvas.id}`, label: "Rename canvas", group: "Canvas", run: () => void renameCanvas() }] : []),
    ...(canvas !== null && !loading ? [{ id: `canvas.delete.${canvas.id}`, label: "Delete canvas", group: "Canvas", run: () => void removeCanvas() }] : []),
  ] : []);

  return <PageDeckPage pageKey={pageKey}><div className="canvas-main" data-babel-pane="detail" tabIndex={-1}>
    <button className="content-back" data-babel-escape="list" type="button" onClick={onShowList}><span aria-hidden="true">←</span> Canvases</button>
    {loadError ? <div className="canvas-alert" role="alert"><span>{loadError}</span><button type="button" onClick={retryLoading}>Retry</button></div> : null}
    {loading ? <div className="standalone-status">Opening canvas…</div> : null}
    {!loading && canvas ? <><div className="canvas-document-bar"><div><span className="eyebrow">Open canvas</span><h2>{canvas.title}</h2></div>
      <div className="canvas-document-actions"><button type="button" onClick={() => void renameCanvas()}>Rename</button>
        <button className="danger-ghost" type="button" onClick={() => void removeCanvas()}>Delete</button></div></div>
      <CanvasEditor key={canvas.id} canvas={canvas} updateCanvas={(id, input) => api.update(id, input)}
        errorMessage={api.errorMessage} onSaved={reflectSaved} onSaveStateChange={setSaveState}
        onRegisterDiscard={(action) => { discardActionRef.current = action; }}
        onRegisterSave={(action) => { saveActionRef.current = action; }} /></> : null}
  </div></PageDeckPage>;
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
