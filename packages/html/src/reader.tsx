"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { HtmlAnnotation, HtmlDocument, HtmlProgress } from "@babel-apps/platform/html/core";
import { HTML_MAX_DOCUMENT_BYTES } from "@babel-apps/platform/html/core";
import { usePdfNotebookConnection, type PdfExcerpt } from "@babel-apps/pdf/excerpts";
import { buildHtmlDocument, HTML_FRAME_SANDBOX } from "./sandbox";
import { isHtmlBridgeMessage, isHtmlBridgeReady, type HtmlBridgeCommand, type HtmlBridgeMessage, type HtmlHeading, type HtmlSelection } from "./bridge";
import { decodeHtmlBytes, isHtmlDocument } from "./reader-core";

type Operation = { kind: "add"; annotation: HtmlAnnotation } | { kind: "remove"; id: string };
class HtmlRequestError extends Error {
  constructor(message: string, readonly current?: HtmlDocument) { super(message); }
}
function message(error: unknown) { return error instanceof Error ? error.message : "The operation failed. Please retry."; }
async function requestDocument(url: string, body?: unknown, keepalive = false): Promise<HtmlDocument> {
  const response = await fetch(url, body === undefined ? { cache: "no-store" } : {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive,
  });
  const data = await response.json() as { document?: unknown; error?: { message?: string; details?: { document?: unknown } } };
  const current = isHtmlDocument(data.error?.details?.document) ? data.error.details.document : undefined;
  if (!response.ok || !isHtmlDocument(data.document)) throw new HtmlRequestError(data.error?.message ?? "The HTML document could not be opened or saved.", current);
  return data.document;
}
function applyOperations(base: readonly HtmlAnnotation[], operations: readonly Operation[]): HtmlAnnotation[] {
  const result = new Map(base.map((annotation) => [annotation.id, annotation]));
  for (const operation of operations) {
    if (operation.kind === "add") result.set(operation.annotation.id, operation.annotation);
    else result.delete(operation.id);
  }
  return [...result.values()];
}

export function HtmlReader({ appId, appName, documentId, ownerId, anchor = "" }: {
  appId: string; appName: string; documentId: string; ownerId: string; anchor?: string;
}) {
  const router = useRouter();
  const frame = useRef<HTMLIFrameElement>(null);
  const port = useRef<MessagePort | null>(null);
  const metadata = useRef<HtmlDocument | null>(null);
  const mounted = useRef(false);
  const ready = useRef(false);
  const pending = useRef<Operation[]>([]);
  const annotationSaving = useRef(false);
  const progressSaving = useRef(false);
  const wantedProgress = useRef<HtmlProgress | null>(null);
  const progressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [book, setBook] = useState<HtmlDocument | null>(null);
  const [frameUrl, setFrameUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [version, setVersion] = useState(0);
  const [headings, setHeadings] = useState<HtmlHeading[]>([]);
  const [annotations, setAnnotations] = useState<HtmlAnnotation[]>([]);
  const [annotationStatus, setAnnotationStatus] = useState("Saved");
  const [selection, setSelection] = useState<HtmlSelection | null>(null);
  const [position, setPosition] = useState(0);
  const [scale, setScale] = useState(1);
  const [sidebar, setSidebar] = useState<"contents" | "annotations" | null>("contents");
  const [capture, setCapture] = useState(false);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState("");
  const [comment, setComment] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const { state: notebook, sendExcerpt } = usePdfNotebookConnection(ownerId, "HTML");
  const endpoint = `/api/html/documents/${encodeURIComponent(documentId)}`;
  const post = useCallback((command: HtmlBridgeCommand) => port.current?.postMessage(command), []);

  const saveAnnotations = useCallback(async () => {
    if (annotationSaving.current || !metadata.current || !pending.current.length) return;
    annotationSaving.current = true;
    if (mounted.current) setAnnotationStatus("Saving…");
    let conflicts = 0;
    try {
      while (pending.current.length && metadata.current) {
        const operations = pending.current.slice();
        const current = metadata.current;
        try {
          const result = await requestDocument(`${endpoint}/annotations`, { revision: current.annotationsRevision, annotations: applyOperations(current.annotations, operations) });
          pending.current.splice(0, operations.length);
          metadata.current = { ...metadata.current, annotations: result.annotations, annotationsRevision: result.annotationsRevision };
          const visible = applyOperations(result.annotations, pending.current);
          if (mounted.current) { setAnnotations(visible); post({ kind: "annotations", annotations: visible }); }
          conflicts = 0;
        } catch (failure) {
          if (failure instanceof HtmlRequestError && failure.current && conflicts++ < 2) {
            metadata.current = { ...metadata.current, annotations: failure.current.annotations, annotationsRevision: failure.current.annotationsRevision };
            continue;
          }
          if (mounted.current) { setAnnotationStatus("Not saved — retry"); setError(message(failure)); }
          return;
        }
      }
      if (mounted.current) setAnnotationStatus("Saved");
    } finally { annotationSaving.current = false; }
  }, [endpoint, post]);

  const saveProgress = useCallback(async (keepalive = false) => {
    if (progressSaving.current || !wantedProgress.current || !metadata.current) return;
    progressSaving.current = true;
    let conflicts = 0;
    try {
      while (wantedProgress.current && metadata.current) {
        const progress: HtmlProgress = wantedProgress.current;
        wantedProgress.current = null;
        try {
          const result = await requestDocument(`${endpoint}/progress`, { revision: metadata.current.progressRevision, progress }, keepalive);
          metadata.current = { ...metadata.current, progress: result.progress, progressRevision: result.progressRevision };
        } catch (failure) {
          if (failure instanceof HtmlRequestError && failure.current && conflicts++ < 2) {
            metadata.current = { ...metadata.current, progressRevision: failure.current.progressRevision };
            wantedProgress.current ??= progress;
            continue;
          }
          if (mounted.current) setError(`Reading progress: ${message(failure)}`);
          break;
        }
      }
    } finally { progressSaving.current = false; }
  }, [endpoint]);

  useEffect(() => {
    mounted.current = true; ready.current = false;
    let active = true;
    let blobUrl = "";
    let connected = false;
    let pendingAnchor = anchor;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const channelId = crypto.randomUUID();
    function receive(data: HtmlBridgeMessage) {
      if (!active) return;
      if (data.kind === "ready") {
        setHeadings(data.headings);
        const current = metadata.current;
        if (current) { post({ kind: "restore", progress: current.progress }); post({ kind: "annotations", annotations: current.annotations }); }
      } else if (data.kind === "restored") {
        if (timeout) clearTimeout(timeout);
        setLoading(false); ready.current = true; setPosition(data.progress.position); setScale(data.progress.scale);
        if (pendingAnchor) { post({ kind: "fragment", hash: pendingAnchor }); pendingAnchor = ""; }
      } else if (data.kind === "focus-find") {
        document.getElementById("babel-html-search")?.focus();
      } else if (data.kind === "capture-state") {
        setCapture(data.active);
      } else if (data.kind === "headings") setHeadings(data.headings);
      else if (data.kind === "selection") { setSelection(data.selection); if (data.selection?.imageDataUrl) { setCapture(false); post({ kind: "capture", active: false }); } }
      else if (data.kind === "progress") {
        setPosition(data.progress.position); setScale(data.progress.scale);
        if (ready.current) {
          wantedProgress.current = data.progress;
          if (progressTimer.current) clearTimeout(progressTimer.current);
          progressTimer.current = setTimeout(() => { void saveProgress(); }, 400);
        }
      } else if (data.kind === "find-result") setMatches(`${data.current} / ${data.total}`);
      else if (data.kind === "notice") setNotice(data.message);
      else if (data.kind === "navigate") {
        void (async () => {
          try {
            if (pending.current.length) throw new Error("Wait for annotations to finish saving before opening another document.");
            const current = metadata.current;
            if (!current) return;
            const response = await fetch("/api/html/documents", { cache: "no-store", signal: controller.signal });
            const index = await response.json() as { documents?: Array<{ id?: string; bundleId?: string; entryPath?: string }> };
            const target = response.ok ? index.documents?.find((candidate) => candidate.bundleId === current.bundleId && candidate.entryPath === data.path) : undefined;
            if (!target?.id || !/^[0-9a-f-]{36}$/u.test(target.id)) throw new Error("This linked HTML document is not in the library. Import it with the same resource folder.");
            await saveProgress();
            if (active) router.push(`/html-reader?id=${encodeURIComponent(target.id)}&owner=${encodeURIComponent(ownerId)}${data.hash ? `&anchor=${encodeURIComponent(data.hash)}` : ""}`);
          } catch (failure) { if (active) setNotice(message(failure)); }
        })();
      }
    }
    const connect = (event: MessageEvent<unknown>) => {
      if (!active || connected || event.source !== frame.current?.contentWindow || !isHtmlBridgeReady(event.data, channelId, documentId)) return;
      connected = true;
      const connection = new MessageChannel();
      port.current = connection.port1;
      connection.port1.onmessage = (incoming: MessageEvent<unknown>) => {
        if (isHtmlBridgeMessage(incoming.data, channelId, documentId)) receive(incoming.data);
      };
      frame.current?.contentWindow?.postMessage({ v: 1, kind: "html-connect", channelId, documentId }, "*", [connection.port2]);
    };
    window.addEventListener("message", connect);
    async function load() {
      try {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(documentId)) throw new Error("Open a document from this app’s HTML library.");
        const current = await requestDocument(endpoint);
        if (current.size > HTML_MAX_DOCUMENT_BYTES) throw new Error("The HTML document exceeds the 64 MiB reading limit.");
        const source = await fetch(`${endpoint}/assets/${current.entryPath.split("/").map(encodeURIComponent).join("/")}`, { cache: "no-store", signal: controller.signal });
        if (!source.ok) throw new Error("The original HTML file is unavailable. Reload the library or import it again.");
        const bytes = new Uint8Array(await source.arrayBuffer());
        if (bytes.byteLength > HTML_MAX_DOCUMENT_BYTES) throw new Error("The HTML document exceeds the 64 MiB reading limit.");
        const html = decodeHtmlBytes(bytes);
        if (!active) return;
        const prepared = buildHtmlDocument({ html, entryPath: current.entryPath, assetBaseUrl: new URL(`${endpoint}/assets/`, window.location.origin).href, channelId, documentId });
        blobUrl = URL.createObjectURL(new Blob([prepared.html], { type: "text/html;charset=utf-8" }));
        metadata.current = current; pending.current = [];
        setBook(current); setAnnotations(current.annotations); setScale(current.progress.scale); setPosition(current.progress.position);
        if (prepared.warnings.length) setNotice(prepared.warnings.join(" "));
        setFrameUrl(blobUrl);
        timeout = setTimeout(() => { if (active && !ready.current) { setLoadError("The HTML page did not finish opening. Reload it to retry."); setLoading(false); } }, 20_000);
      } catch (failure) { if (active && !controller.signal.aborted) { setLoadError(message(failure)); setLoading(false); } }
    }
    void load();
    const beforeUnload = (event: BeforeUnloadEvent) => { void saveProgress(true); if (pending.current.length) event.preventDefault(); };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      active = false; mounted.current = false; ready.current = false; controller.abort();
      if (timeout) clearTimeout(timeout);
      if (progressTimer.current) clearTimeout(progressTimer.current);
      window.removeEventListener("message", connect); window.removeEventListener("beforeunload", beforeUnload);
      port.current?.close(); port.current = null;
      void saveProgress(true);
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [anchor, documentId, endpoint, ownerId, post, router, saveProgress, version]);

  function zoom(value: number) { post({ kind: "restore", progress: { position, scale: Math.max(.1, Math.min(8, value)) } }); }
  function find(direction?: "next" | "previous") { post({ kind: "find", query, direction }); }
  function toggleCapture(active: boolean) { setCapture(active); setSelection(null); post({ kind: "capture", active }); }
  function addAnnotation(type: HtmlAnnotation["type"]) {
    if (!selection?.text || !metadata.current) return;
    const annotation: HtmlAnnotation = { id: crypto.randomUUID(), type, text: selection.text, prefix: selection.prefix, suffix: selection.suffix,
      occurrence: selection.occurrence, comment: comment.trim(), color: type === "underline" ? "#2082bf" : "#efc44b", createdAt: new Date().toISOString() };
    pending.current.push({ kind: "add", annotation });
    const visible = applyOperations(metadata.current.annotations, pending.current);
    setAnnotations(visible); post({ kind: "annotations", annotations: visible }); setComment("");
    void saveAnnotations();
  }
  function removeAnnotation(id: string) {
    if (!metadata.current) return;
    pending.current.push({ kind: "remove", id });
    const visible = applyOperations(metadata.current.annotations, pending.current);
    setAnnotations(visible); post({ kind: "annotations", annotations: visible }); void saveAnnotations();
  }
  async function excerpt(mode: "new" | "append") {
    if (!selection || !book || sending) return;
    setSending(true); setError("");
    try {
      const value: PdfExcerpt = { id: crypto.randomUUID(), title: book.title, page: 1, sourceType: "html", location: selection.section || "HTML document",
        text: selection.text, ...(selection.imageDataUrl ? { imageDataUrl: selection.imageDataUrl } : {}) };
      await sendExcerpt(mode, value);
      setNotice(mode === "new" ? "New draft opened in the notebook." : "Selection appended to the current draft.");
    } catch (failure) { setError(message(failure)); } finally { setSending(false); }
  }
  const canExcerpt = Boolean(selection && !sending && !loading);
  const sourcePath = book ? `${endpoint}/assets/${book.entryPath.split("/").map(encodeURIComponent).join("/")}` : "#";
  return <div className="babel-pdf-reader babel-pdf-theme babel-html-reader" data-pdf-app={appId} onKeyDown={(event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") { event.preventDefault(); document.getElementById("babel-html-search")?.focus(); }
    if (event.key === "Escape" && capture) toggleCapture(false);
  }}>
    <header className="babel-pdf-reader-header"><div><span className="babel-pdf-reader-label">{appName} / HTML LIBRARY</span><h1>{book?.title ?? "HTML reader"}</h1></div><a href={sourcePath} download={book?.fileName}>Original HTML ↗</a></header>
    <div className="babel-pdf-toolbar" role="toolbar" aria-label="HTML reading tools">
      <div className="babel-pdf-toolgroup"><button type="button" aria-pressed={sidebar === "contents"} onClick={() => setSidebar(sidebar === "contents" ? null : "contents")}>Contents</button><button type="button" aria-pressed={sidebar === "annotations"} onClick={() => setSidebar(sidebar === "annotations" ? null : "annotations")}>Annotations ({annotations.length})</button></div>
      <div className="babel-pdf-toolgroup"><button type="button" disabled={loading} aria-label="Zoom out" onClick={() => zoom(scale / 1.2)}>−</button><span className="babel-pdf-zoom">{Math.round(scale * 100)}%</span><button type="button" disabled={loading} aria-label="Zoom in" onClick={() => zoom(scale * 1.2)}>＋</button><button type="button" disabled={loading} onClick={() => zoom(1)}>Reset zoom</button><span className="babel-html-position">{Math.round(position * 100)}% read</span></div>
      <form className="babel-pdf-find" role="search" onSubmit={(event) => { event.preventDefault(); find(); }}><label className="babel-pdf-sr-only" htmlFor="babel-html-search">Find in HTML</label><input id="babel-html-search" type="search" value={query} maxLength={240} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Find in this document" /><button type="submit" disabled={loading}>Find</button>{matches && <span>{matches}</span>}<button type="button" disabled={!query || loading} aria-label="Previous match" onClick={() => find("previous")}>↑</button><button type="button" disabled={!query || loading} aria-label="Next match" onClick={() => find("next")}>↓</button></form>
    </div>
    <div className="babel-pdf-excerpt-bar" aria-label="HTML excerpt actions"><button type="button" disabled={loading} aria-pressed={capture} onClick={() => toggleCapture(!capture)}>Area capture</button><span className="babel-pdf-selection-status">{selection ? selection.imageDataUrl ? "Image captured. Choose a note action." : `${selection.text.length} characters selected · ${selection.section || "HTML document"}` : capture ? "Drag over the document to capture an area." : "Select text, or capture a diagram or interactive result."}</span><button className="babel-pdf-primary" type="button" disabled={!canExcerpt || !notebook.canCreate || !notebook.connected} onClick={() => void excerpt("new")}>New note</button><button type="button" disabled={!canExcerpt || !notebook.target || notebook.target.pending || !notebook.connected} onClick={() => void excerpt("append")}>Append to {notebook.target?.title ?? "current draft"}</button></div>
    {!notebook.connected && <p className="babel-pdf-connection">Keep the originating notebook window open to create and append notes.</p>}
    <div className="babel-pdf-annotation-bar"><button type="button" disabled={!selection?.text || loading} onClick={() => addAnnotation("highlight")}>Highlight</button><button type="button" disabled={!selection?.text || loading} onClick={() => addAnnotation("underline")}>Underline</button><label className="babel-pdf-sr-only" htmlFor="babel-html-comment">Annotation comment</label><input id="babel-html-comment" value={comment} maxLength={4000} placeholder="Add a comment to this selection" onChange={(event) => setComment(event.currentTarget.value)} /><button type="button" disabled={!selection?.text || !comment.trim() || loading} onClick={() => addAnnotation("comment")}>Add comment</button><span>{annotationStatus}</span>{annotationStatus !== "Saved" && annotationStatus !== "Saving…" && <button type="button" onClick={() => void saveAnnotations()}>Retry save</button>}</div>
    <p className="babel-html-offline">Offline · Local scripts enabled · External resources blocked</p>
    {notice && <div className="babel-pdf-message" role="status"><span>{notice}</span><button type="button" aria-label="Dismiss notice" onClick={() => setNotice("")}>×</button></div>}
    {error && <div className="babel-pdf-message error" role="alert"><span>{error}</span><button type="button" aria-label="Dismiss error" onClick={() => setError("")}>×</button></div>}
    <div className="babel-pdf-reading-area">
      {sidebar && <aside className="babel-pdf-sidebar" aria-label={sidebar === "contents" ? "HTML contents" : "HTML annotations"}>
        {sidebar === "contents" ? headings.length ? <ul className="babel-pdf-outline">{headings.map((heading) => <li key={heading.id} style={{ paddingLeft: `${(heading.level - 1) * 10}px` }}><button type="button" onClick={() => post({ kind: "scroll", headingId: heading.id })}>{heading.text || "Untitled section"}</button></li>)}</ul> : <p>No section headings in this document.</p>
          : annotations.length ? <ul className="babel-pdf-annotation-list">{annotations.map((annotation) => <li key={annotation.id}><button type="button" onClick={() => post({ kind: "reveal", annotation })}><strong>{annotation.type}</strong><span>{annotation.text}</span>{annotation.comment && <span>{annotation.comment}</span>}</button><button className="babel-pdf-remove" type="button" onClick={() => removeAnnotation(annotation.id)}>Remove</button></li>)}</ul> : <p>Select text to add your first annotation.</p>}
      </aside>}
      <div className="babel-html-frame-host">
        {loading && !loadError && <div className="babel-pdf-load" role="status">Opening HTML…</div>}
        {loadError && <div className="babel-pdf-load error" role="alert"><p>{loadError}</p><button type="button" onClick={() => { setLoading(true); setLoadError(""); setVersion((value) => value + 1); }}>Reload document</button><button type="button" onClick={() => router.back()}>Back</button></div>}
        {frameUrl && <iframe ref={frame} title={book?.title ?? "HTML document"} src={frameUrl} sandbox={HTML_FRAME_SANDBOX} referrerPolicy="no-referrer" allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; fullscreen 'none'; payment 'none'" />}
      </div>
    </div>
  </div>;
}
