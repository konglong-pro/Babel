"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import type { PDFDocumentProxy, PDFDocumentLoadingTask } from "pdfjs-dist";
import type { EventBus, PDFViewer, PDFLinkService } from "pdfjs-dist/web/pdf_viewer.mjs";
import type { PdfAnnotation, PdfDocument, PdfProgress, PdfRect } from "@babel-apps/platform/pdf/core";
import { rotatePdfRect, unrotatePdfRect, PDF_EXCERPT_MAX_TEXT, type PdfExcerpt } from "./core";
import { usePdfNotebookConnection } from "./excerpts";

interface OutlineItem { title: string; dest?: string | unknown[] | null; items?: OutlineItem[] }
interface Engine { pdf: PDFDocumentProxy; viewer: PDFViewer; events: EventBus; links: PDFLinkService }
interface Selection { text: string; imageDataUrl?: string; pages: Array<{ page: number; rects: PdfRect[] }> }
type AnnotationOperation = { kind: "add"; annotation: PdfAnnotation } | { kind: "remove"; id: string };
interface Drag { page: number; startX: number; startY: number; x: number; y: number; bounds: DOMRect; canvas: HTMLCanvasElement }

class PdfRequestError extends Error {
  constructor(message: string, readonly current?: PdfDocument) { super(message); }
}
async function requestDocument(url: string, body?: unknown, keepalive = false): Promise<PdfDocument> {
  const response = await fetch(url, body === undefined ? { cache: "no-store" } : {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive,
  });
  const data = await response.json() as { document?: PdfDocument; error?: { message?: string; details?: { document?: PdfDocument } } };
  if (!response.ok || !data.document) throw new PdfRequestError(data.error?.message ?? "Could not load the PDF library.", data.error?.details?.document);
  return data.document;
}
function errorText(error: unknown): string { return error instanceof Error ? error.message : "The operation failed. Please try again."; }
function applyOperations(base: readonly PdfAnnotation[], operations: readonly AnnotationOperation[]): PdfAnnotation[] {
  const result = new Map(base.map((annotation) => [annotation.id, annotation]));
  for (const operation of operations) {
    if (operation.kind === "add") result.set(operation.annotation.id, operation.annotation);
    else result.delete(operation.id);
  }
  return [...result.values()];
}
function clamp(value: number, low = 0, high = 1) { return Math.max(low, Math.min(high, value)); }

function PdfThumbnail({ pdf, page, current, onSelect }: { pdf: PDFDocumentProxy; page: number; current: boolean; onSelect: () => void }) {
  const root = useRef<HTMLButtonElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!root.current) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "180px" });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const element = canvas.current;
    if (!visible || !element) return;
    let active = true;
    let cancel: (() => void) | undefined;
    void pdf.getPage(page).then(async (pdfPage) => {
      if (!active) return;
      const initial = pdfPage.getViewport({ scale: 1 });
      const viewport = pdfPage.getViewport({ scale: 120 / initial.width });
      element.width = Math.ceil(viewport.width);
      element.height = Math.ceil(viewport.height);
      const context = element.getContext("2d");
      if (!context) return;
      const task = pdfPage.render({ canvas: element, canvasContext: context, viewport });
      cancel = () => task.cancel();
      await task.promise;
    }).catch(() => { /* Main page rendering reports document errors. */ });
    return () => { active = false; cancel?.(); element.width = 1; element.height = 1; };
  }, [pdf, page, visible]);
  return <button ref={root} type="button" className={current ? "babel-pdf-thumbnail selected" : "babel-pdf-thumbnail"} aria-label={`Page ${page}`} aria-current={current ? "page" : undefined} onClick={onSelect}><canvas ref={canvas} width={1} height={1} /><span>{page}</span></button>;
}

function Outline({ items, onSelect }: { items: OutlineItem[]; onSelect: (item: OutlineItem) => void }) {
  return <ul className="babel-pdf-outline">{items.map((item, index) => <li key={`${index}-${item.title}`}><button type="button" onClick={() => onSelect(item)}>{item.title || "Untitled section"}</button>{item.items?.length ? <Outline items={item.items} onSelect={onSelect} /> : null}</li>)}</ul>;
}

export function PdfReader({ appId, appName, documentId, ownerId }: { appId: string; appName: string; documentId: string; ownerId: string }) {
  const container = useRef<HTMLDivElement>(null);
  const viewerElement = useRef<HTMLDivElement>(null);
  const engine = useRef<Engine | null>(null);
  const documentRef = useRef<PdfDocument | null>(null);
  const pendingOperations = useRef<AnnotationOperation[]>([]);
  const savingAnnotations = useRef(false);
  const progressWanted = useRef<PdfProgress | null>(null);
  const progressSaving = useRef(false);
  const progressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ready = useRef(false);
  const mounted = useRef(false);
  const drag = useRef<Drag | null>(null);
  const passwordCallback = useRef<((password: string) => void) | null>(null);
  const [book, setBook] = useState<PdfDocument | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reloadVersion, setReloadVersion] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [pageCount, setPageCount] = useState(0);
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [sidebar, setSidebar] = useState<"pages" | "contents" | "annotations" | null>(null);
  const [layers, setLayers] = useState<Map<number, HTMLElement>>(new Map());
  const [annotations, setAnnotations] = useState<PdfAnnotation[]>([]);
  const [annotationStatus, setAnnotationStatus] = useState("Saved");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [clipMode, setClipMode] = useState(false);
  const [dragRect, setDragRect] = useState<{ page: number; rect: PdfRect } | null>(null);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState("");
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [password, setPassword] = useState("");
  const { state: notebook, sendExcerpt } = usePdfNotebookConnection(ownerId);
  const endpoint = `/api/pdf/documents/${encodeURIComponent(documentId)}`;

  const saveAnnotations = useCallback(async () => {
    if (savingAnnotations.current || !documentRef.current || !pendingOperations.current.length) return;
    savingAnnotations.current = true;
    if (mounted.current) setAnnotationStatus("Saving…");
    let conflicts = 0;
    try {
      while (pendingOperations.current.length && documentRef.current) {
        const operations = pendingOperations.current.slice();
        const current = documentRef.current;
        try {
          const result = await requestDocument(`${endpoint}/annotations`, { revision: current.annotationsRevision, annotations: applyOperations(current.annotations, operations) });
          pendingOperations.current.splice(0, operations.length);
          documentRef.current = { ...documentRef.current, annotations: result.annotations, annotationsRevision: result.annotationsRevision };
          if (mounted.current) setAnnotations(applyOperations(result.annotations, pendingOperations.current));
          conflicts = 0;
        } catch (failure) {
          if (failure instanceof PdfRequestError && failure.current && conflicts++ < 2) {
            documentRef.current = { ...documentRef.current, annotations: failure.current.annotations, annotationsRevision: failure.current.annotationsRevision };
            continue;
          }
          throw failure;
        }
      }
      if (mounted.current) setAnnotationStatus("Saved");
    } catch (failure) {
      if (mounted.current) { setAnnotationStatus("Not saved"); setError(errorText(failure)); }
    } finally { savingAnnotations.current = false; }
  }, [endpoint]);

  const saveProgress = useCallback(async (keepalive = false) => {
    if (progressSaving.current || !documentRef.current) return;
    progressSaving.current = true;
    let attempts = 0;
    try {
      while (progressWanted.current && documentRef.current) {
        const progress = progressWanted.current;
        progressWanted.current = null;
        try {
          const result = await requestDocument(`${endpoint}/progress`, { revision: documentRef.current.progressRevision, progress }, keepalive);
          documentRef.current = { ...documentRef.current, progress: result.progress, progressRevision: result.progressRevision };
        } catch (failure) {
          if (failure instanceof PdfRequestError && failure.current && attempts++ < 2) {
            documentRef.current = { ...documentRef.current, progressRevision: failure.current.progressRevision };
            progressWanted.current ??= progress;
            continue;
          }
          if (mounted.current) setError(`Reading progress: ${errorText(failure)}`);
          break;
        }
      }
    } finally { progressSaving.current = false; }
  }, [endpoint]);

  useEffect(() => {
    mounted.current = true;
    ready.current = false;
    let active = true;
    let task: PDFDocumentLoadingTask | undefined;
    let localEngine: Engine | undefined;
    const cleanups: Array<() => void> = [];
    async function load() {
      try {
        if (!/^[a-f0-9-]{36}$/iu.test(documentId)) throw new Error("Open a book from the notebook's PDF library.");
        const metadata = await requestDocument(endpoint);
        const pdfjs = await import("pdfjs-dist");
        const web = await import("pdfjs-dist/web/pdf_viewer.mjs");
        if (!active || !container.current || !viewerElement.current) return;
        pdfjs.GlobalWorkerOptions.workerSrc = "/_pdf/pdf.worker.min.mjs";
        task = pdfjs.getDocument({ url: `${endpoint}/file`, cMapUrl: "/_pdf/cmaps/", cMapPacked: true, standardFontDataUrl: "/_pdf/standard_fonts/", wasmUrl: "/_pdf/wasm/", enableXfa: false });
        task.onPassword = (updatePassword: (password: string) => void) => { if (active) { passwordCallback.current = updatePassword; setPasswordRequired(true); } };
        const loaded = await task.promise;
        if (!active) return;
        const events = new web.EventBus();
        const links = new web.PDFLinkService({ eventBus: events, externalLinkTarget: 2, externalLinkRel: "noopener noreferrer" });
        const find = new web.PDFFindController({ eventBus: events, linkService: links });
        const viewer = new web.PDFViewer({ container: container.current!, viewer: viewerElement.current!, eventBus: events, linkService: links, findController: find, textLayerMode: 1, annotationMode: 1, imageResourcesPath: "/_pdf/images/", enableSelectionRendering: false, maxCanvasPixels: 16_777_216 });
        links.setViewer(viewer);
        links.setDocument(loaded);
        localEngine = { pdf: loaded, viewer, events, links };
        engine.current = localEngine;
        documentRef.current = metadata;
        pendingOperations.current = [];
        setBook(metadata); setAnnotations(metadata.annotations); setPdf(loaded); setPageCount(loaded.numPages);
        const synchronize = () => {
          if (!active) return;
          setPage(viewer.currentPageNumber); setPageInput(String(viewer.currentPageNumber)); setScale(viewer.currentScale); setRotation(viewer.pagesRotation);
          if (ready.current) {
            progressWanted.current = { page: viewer.currentPageNumber, scale: clamp(viewer.currentScale, 0.1, 8), rotation: viewer.pagesRotation as PdfProgress["rotation"] };
            if (progressTimer.current) clearTimeout(progressTimer.current);
            progressTimer.current = setTimeout(() => { void saveProgress(); }, 400);
          }
        };
        const makeLayers = () => {
          if (!active || !viewerElement.current) return;
          const next = new Map<number, HTMLElement>();
          for (const pageElement of viewerElement.current.querySelectorAll<HTMLElement>(".page[data-page-number]")) {
            const canvasWrapper = pageElement.querySelector<HTMLElement>(".canvasWrapper");
            if (!canvasWrapper) continue;
            let layer = canvasWrapper.querySelector<HTMLElement>(":scope > .babel-pdf-marks");
            if (!layer) { layer = document.createElement("div"); layer.className = "babel-pdf-marks"; canvasWrapper.appendChild(layer); }
            next.set(Number(pageElement.dataset.pageNumber), layer);
          }
          setLayers(next);
        };
        const initialized = () => {
          viewer.pagesRotation = metadata.progress.rotation;
          viewer.currentScale = metadata.progress.scale;
          viewer.currentPageNumber = Math.min(metadata.progress.page, loaded.numPages);
          synchronize();
          ready.current = true;
          setLoading(false);
        };
        events.on("pagesinit", initialized);
        events.on("pagechanging", synchronize); events.on("scalechanging", synchronize); events.on("rotationchanging", synchronize);
        events.on("pagerendered", makeLayers);
        const updateMatches = (event: { matchesCount?: { current: number; total: number } }) => {
          if (active) setMatches(event.matchesCount ? `${event.matchesCount.current} / ${event.matchesCount.total}` : "");
        };
        events.on("updatefindmatchescount", updateMatches);
        events.on("updatefindcontrolstate", updateMatches);
        viewer.setDocument(loaded);
        void loaded.getOutline().then((items) => { if (active) setOutline((items ?? []) as OutlineItem[]); });
        const observer = new ResizeObserver(() => { if (ready.current && active) viewer.update(); });
        observer.observe(container.current!);
        cleanups.push(() => observer.disconnect());
      } catch (failure) { if (active) { setLoadError(errorText(failure)); setLoading(false); } }
    }
    void load();
    const beforeUnload = (event: BeforeUnloadEvent) => {
      void saveProgress(true);
      if (pendingOperations.current.length) event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      active = false; mounted.current = false; ready.current = false;
      if (progressTimer.current) clearTimeout(progressTimer.current);
      window.removeEventListener("beforeunload", beforeUnload);
      for (const cleanup of cleanups) cleanup();
      localEngine?.viewer.setDocument(null);
      if (engine.current === localEngine) engine.current = null;
      void task?.destroy();
    };
  }, [documentId, endpoint, reloadVersion, saveProgress]);

  function captureText() {
    if (clipMode || !container.current || !engine.current) return;
    const native = window.getSelection();
    if (!native?.rangeCount || !native.anchorNode || !native.focusNode || !container.current.contains(native.anchorNode) || !container.current.contains(native.focusNode)) return;
    const text = native.toString().trim();
    if (!text) { setSelection(null); return; }
    const rectangles = [...native.getRangeAt(0).getClientRects()];
    const pages: Selection["pages"] = [];
    for (const element of container.current.querySelectorAll<HTMLElement>(".page[data-page-number]")) {
      const bounds = element.querySelector(".canvasWrapper")?.getBoundingClientRect();
      if (!bounds?.width || !bounds.height) continue;
      const rects: PdfRect[] = [];
      for (const rect of rectangles) {
        const left = Math.max(rect.left, bounds.left), top = Math.max(rect.top, bounds.top);
        const right = Math.min(rect.right, bounds.right), bottom = Math.min(rect.bottom, bounds.bottom);
        if (right - left < 1 || bottom - top < 1) continue;
        rects.push(unrotatePdfRect({ x: clamp((left - bounds.left) / bounds.width), y: clamp((top - bounds.top) / bounds.height), width: clamp((right - left) / bounds.width), height: clamp((bottom - top) / bounds.height) }, engine.current.viewer.pagesRotation));
      }
      if (rects.length) pages.push({ page: Number(element.dataset.pageNumber), rects: rects.slice(0, 256) });
    }
    if (pages.length) setSelection({ text, pages });
  }

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!clipMode || event.button !== 0) return;
    const element = (event.target as HTMLElement).closest<HTMLElement>(".page[data-page-number]");
    const canvas = element?.querySelector<HTMLCanvasElement>(".canvasWrapper canvas");
    if (!element || !canvas || !canvas.width) return;
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    event.preventDefault();
    const x = clamp((event.clientX - bounds.left) / bounds.width), y = clamp((event.clientY - bounds.top) / bounds.height);
    drag.current = { page: Number(element.dataset.pageNumber), startX: x, startY: y, x, y, bounds, canvas };
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelection(null);
  }
  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current) return;
    current.x = clamp((event.clientX - current.bounds.left) / current.bounds.width);
    current.y = clamp((event.clientY - current.bounds.top) / current.bounds.height);
    setDragRect({ page: current.page, rect: { x: Math.min(current.startX, current.x), y: Math.min(current.startY, current.y), width: Math.abs(current.x - current.startX), height: Math.abs(current.y - current.startY) } });
  }
  function pointerUp(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current) { if (!clipMode) setTimeout(captureText, 0); return; }
    drag.current = null; setDragRect(null);
    event.currentTarget.releasePointerCapture(event.pointerId);
    const rect = { x: Math.min(current.startX, current.x), y: Math.min(current.startY, current.y), width: Math.abs(current.x - current.startX), height: Math.abs(current.y - current.startY) };
    if (rect.width * current.bounds.width < 5 || rect.height * current.bounds.height < 5) return;
    try {
      const output = document.createElement("canvas");
      const factor = Math.min(1, 2400 / Math.max(rect.width * current.canvas.width, rect.height * current.canvas.height));
      output.width = Math.max(1, Math.round(rect.width * current.canvas.width * factor));
      output.height = Math.max(1, Math.round(rect.height * current.canvas.height * factor));
      const context = output.getContext("2d");
      if (!context) throw new Error("Screenshot capture is unavailable.");
      context.drawImage(current.canvas, rect.x * current.canvas.width, rect.y * current.canvas.height, rect.width * current.canvas.width, rect.height * current.canvas.height, 0, 0, output.width, output.height);
      setSelection({ text: "", imageDataUrl: output.toDataURL("image/png"), pages: [{ page: current.page, rects: [unrotatePdfRect(rect, rotation)] }] });
      setClipMode(false);
    } catch (failure) { setError(errorText(failure)); }
  }

  function addAnnotation(type: PdfAnnotation["type"]) {
    if (!selection || !documentRef.current) return;
    if (selection.text.length > PDF_EXCERPT_MAX_TEXT) { setError("Select less text before annotating (20,000 characters maximum)."); return; }
    const operations: AnnotationOperation[] = selection.pages.map((selected) => ({ kind: "add", annotation: { id: crypto.randomUUID(), type, page: selected.page, rects: selected.rects, text: selection.text, comment: comment.trim(), color: type === "underline" ? "#2082bf" : "#efc44b", createdAt: new Date().toISOString() } }));
    pendingOperations.current.push(...operations);
    setAnnotations(applyOperations(documentRef.current.annotations, pendingOperations.current));
    setComment(""); setNotice(type === "comment" ? "Comment added." : "Annotation added.");
    void saveAnnotations();
  }
  function removeAnnotation(id: string) {
    if (!documentRef.current) return;
    pendingOperations.current.push({ kind: "remove", id });
    setAnnotations(applyOperations(documentRef.current.annotations, pendingOperations.current));
    void saveAnnotations();
  }
  async function createExcerpt(mode: "new" | "append") {
    if (!selection || !book || sending) return;
    setSending(true); setError(""); setNotice("");
    try {
      const excerpt: PdfExcerpt = { id: crypto.randomUUID(), title: book.title, page: selection.pages[0].page, text: selection.text, ...(selection.imageDataUrl ? { imageDataUrl: selection.imageDataUrl } : {}) };
      await sendExcerpt(mode, excerpt);
      setNotice(mode === "new" ? "New draft opened in the notebook." : "Selection appended to the draft.");
    } catch (failure) { setError(errorText(failure)); }
    finally { setSending(false); }
  }
  function goToPage(value: number) { if (engine.current) engine.current.viewer.currentPageNumber = clamp(value, 1, pageCount); }
  function zoom(value: number | string) { if (engine.current) { if (typeof value === "number") engine.current.viewer.currentScale = clamp(value, 0.1, 8); else engine.current.viewer.currentScaleValue = value; } }
  function find(previous = false, repeat = false) {
    engine.current?.events.dispatch("find", { source: window, type: repeat ? "again" : "", query, caseSensitive: false, entireWord: false, highlightAll: true, findPrevious: previous, matchDiacritics: false });
  }
  const canExcerpt = Boolean(selection && selection.text.length <= PDF_EXCERPT_MAX_TEXT && !sending);

  return (
    <div className="babel-pdf-reader babel-pdf-theme" data-pdf-app={appId} onKeyDown={(event) => {
      if (event.key === "Escape") { setClipMode(false); drag.current = null; setDragRect(null); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") { event.preventDefault(); document.getElementById("babel-pdf-search")?.focus(); }
    }}>
      <header className="babel-pdf-reader-header"><div><span className="babel-pdf-reader-label">{appName} / PDF LIBRARY</span><h1>{book?.title ?? "PDF reader"}</h1></div><a href={`${endpoint}/file`} download={book?.fileName}>Original PDF ↗</a></header>
      <div className="babel-pdf-toolbar" role="toolbar" aria-label="PDF reading tools">
        <div className="babel-pdf-toolgroup"><button type="button" aria-pressed={sidebar === "pages"} onClick={() => setSidebar(sidebar === "pages" ? null : "pages")}>Pages</button><button type="button" aria-pressed={sidebar === "contents"} onClick={() => setSidebar(sidebar === "contents" ? null : "contents")}>Contents</button><button type="button" aria-pressed={sidebar === "annotations"} onClick={() => setSidebar(sidebar === "annotations" ? null : "annotations")}>Annotations ({annotations.length})</button></div>
        <div className="babel-pdf-toolgroup"><button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => goToPage(page - 1)}>←</button><form onSubmit={(event) => { event.preventDefault(); const value = Number(pageInput); if (Number.isInteger(value)) goToPage(value); }}><label className="babel-pdf-sr-only" htmlFor="babel-pdf-page">Page</label><input id="babel-pdf-page" type="number" min={1} max={pageCount || 1} value={pageInput} onChange={(event) => setPageInput(event.target.value)} /><span> / {pageCount || "–"}</span></form><button type="button" aria-label="Next page" disabled={page >= pageCount} onClick={() => goToPage(page + 1)}>→</button></div>
        <div className="babel-pdf-toolgroup"><button type="button" aria-label="Zoom out" onClick={() => zoom(scale / 1.2)}>−</button><span className="babel-pdf-zoom">{Math.round(scale * 100)}%</span><button type="button" aria-label="Zoom in" onClick={() => zoom(scale * 1.2)}>＋</button><button type="button" onClick={() => zoom("page-width")}>Fit width</button><button type="button" onClick={() => { if (engine.current) engine.current.viewer.pagesRotation = (rotation + 90) % 360; }}>Rotate</button></div>
        <form className="babel-pdf-find" role="search" onSubmit={(event) => { event.preventDefault(); find(false); }}><label className="babel-pdf-sr-only" htmlFor="babel-pdf-search">Find in PDF</label><input id="babel-pdf-search" value={query} onChange={(event) => setQuery(event.target.value)} type="search" placeholder="Find in this PDF" /><button type="submit">Find</button>{matches ? <span>{matches}</span> : null}<button type="button" aria-label="Previous match" disabled={!query} onClick={() => find(true, true)}>↑</button><button type="button" aria-label="Next match" disabled={!query} onClick={() => find(false, true)}>↓</button></form>
      </div>
      <div className="babel-pdf-excerpt-bar" aria-label="PDF excerpt actions">
        <button type="button" aria-pressed={clipMode} disabled={!pdf} onClick={() => { setClipMode(!clipMode); setSelection(null); }}>Area capture</button>
        <span className="babel-pdf-selection-status">{selection?.imageDataUrl ? "Image selected" : selection ? `${selection.text.length.toLocaleString("en-US")} characters selected` : "Select text, or capture an area for diagrams and scanned pages."}</span>
        <button className="babel-pdf-primary" type="button" disabled={!canExcerpt || !notebook.connected || !notebook.canCreate} onClick={() => { void createExcerpt("new"); }}>New note</button>
        <button type="button" disabled={!canExcerpt || !notebook.target || notebook.target.pending || !notebook.connected} title={notebook.target ? notebook.target.pending ? "This draft is saving" : notebook.target.title : "Open a draft in the notebook first"} onClick={() => { void createExcerpt("append"); }}>Append to {notebook.target?.title ?? "current draft"}</button>
      </div>
      <div className="babel-pdf-annotation-bar"><button type="button" disabled={!selection} onClick={() => addAnnotation("highlight")}>Highlight</button><button type="button" disabled={!selection} onClick={() => addAnnotation("underline")}>Underline</button><label className="babel-pdf-sr-only" htmlFor="babel-pdf-comment">Annotation comment</label><input id="babel-pdf-comment" placeholder="Add a short comment to the selection…" value={comment} maxLength={4000} onChange={(event) => setComment(event.target.value)} /><button type="button" disabled={!selection || !comment.trim()} onClick={() => addAnnotation("comment")}>Add comment</button><span role="status">{annotationStatus}</span>{annotationStatus === "Not saved" ? <button type="button" onClick={() => { void saveAnnotations(); }}>Retry save</button> : null}</div>
      {!notebook.connected ? <p className="babel-pdf-connection">Reading works independently. Keep the originating notebook window open to send excerpts.</p> : null}
      {error ? <div className="babel-pdf-message error" role="alert"><span>{error}</span><button type="button" onClick={() => setError("")}>Dismiss</button></div> : null}
      {notice ? <div className="babel-pdf-message" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice("")}>Dismiss</button></div> : null}
      <div className="babel-pdf-reading-area">
        {sidebar ? <aside className="babel-pdf-sidebar" aria-label={sidebar === "pages" ? "PDF pages" : sidebar === "contents" ? "PDF contents" : "PDF annotations"}>
          {sidebar === "pages" && pdf ? Array.from({ length: pageCount }, (_, index) => <PdfThumbnail key={index} pdf={pdf} page={index + 1} current={page === index + 1} onSelect={() => goToPage(index + 1)} />) : null}
          {sidebar === "contents" ? outline.length ? <Outline items={outline} onSelect={(item) => { if (item.dest) void engine.current?.links.goToDestination(item.dest); }} /> : <p>This PDF has no embedded table of contents. Use Pages to navigate.</p> : null}
          {sidebar === "annotations" ? annotations.length ? <ul className="babel-pdf-annotation-list">{annotations.map((annotation) => <li key={annotation.id}><button type="button" onClick={() => goToPage(annotation.page)}><strong>p. {annotation.page} · {annotation.type}</strong>{annotation.text ? <span>{annotation.text.slice(0, 220)}</span> : null}{annotation.comment ? <p>{annotation.comment}</p> : null}</button><button type="button" className="babel-pdf-remove" aria-label={`Remove ${annotation.type} on page ${annotation.page}`} onClick={() => removeAnnotation(annotation.id)}>Remove</button></li>)}</ul> : <p>Select text or an area, then add a highlight, underline, or comment.</p> : null}
        </aside> : null}
        <div className="babel-pdf-canvas-host">
          {loading && !passwordRequired ? <div className="babel-pdf-load" role="status">Opening PDF…</div> : null}
          {loadError ? <div className="babel-pdf-load error" role="alert"><p>{loadError}</p><button type="button" onClick={() => { setLoadError(""); setLoading(true); setReloadVersion((version) => version + 1); }}>Try again</button></div> : null}
          {passwordRequired ? <form className="babel-pdf-password" onSubmit={(event) => { event.preventDefault(); passwordCallback.current?.(password); setPassword(""); setPasswordRequired(false); }}><label htmlFor="babel-pdf-password">This PDF needs a password</label><input id="babel-pdf-password" autoFocus type="password" value={password} onChange={(event) => setPassword(event.target.value)} /><button type="submit">Open PDF</button></form> : null}
          <div ref={container} className={`babel-pdf-scroll${clipMode ? " capture-mode" : ""}`} tabIndex={0} aria-label="PDF document pages" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => { drag.current = null; setDragRect(null); }} onKeyUp={() => setTimeout(captureText, 0)}><div ref={viewerElement} className="pdfViewer" /></div>
          {[...layers].map(([number, layer]) => createPortal(<>{annotations.filter((annotation) => annotation.page === number).flatMap((annotation) => annotation.rects.map((rect, index) => { const visible = rotatePdfRect(rect, rotation); return <span key={`${annotation.id}-${index}`} className={`babel-pdf-mark ${annotation.type}`} title={annotation.comment || annotation.text} style={{ left: `${visible.x * 100}%`, top: `${visible.y * 100}%`, width: `${visible.width * 100}%`, height: `${visible.height * 100}%`, "--mark-color": annotation.color } as CSSProperties} />; }))}{dragRect?.page === number ? <span className="babel-pdf-capture-box" style={{ left: `${dragRect.rect.x * 100}%`, top: `${dragRect.rect.y * 100}%`, width: `${dragRect.rect.width * 100}%`, height: `${dragRect.rect.height * 100}%` }} /> : null}</>, layer, String(number)))}
        </div>
      </div>
    </div>
  );
}
