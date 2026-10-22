"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { isPdfExcerpt, type PdfExcerpt } from "./core";
export { preparePdfExcerpt, appendPdfMarkdown } from "./core";
export type { PdfExcerpt, PdfPreparedImage, PreparedPdfExcerpt } from "./core";

interface Creation {
  id: string;
  onCreate: (excerpt: PdfExcerpt) => void | Promise<void>;
  isReady?: () => boolean;
}
interface Editor {
  id: string;
  title: string;
  isActive: () => boolean;
  isPending: () => boolean;
  onAppend: (excerpt: PdfExcerpt) => void | Promise<void>;
}
export interface PdfDraftTarget { id: string; title: string; pending: boolean }
export interface PdfNotebookState { connected: boolean; canCreate: boolean; target: PdfDraftTarget | null }

interface Broker {
  id: string;
  channel: BroadcastChannel;
  creations: Map<string, Creation>;
  editors: Map<string, Editor>;
  requests: Map<string, Promise<void>>;
  prepareCreation?: () => void;
}
let broker: Broker | undefined;

function activeEditor(owner: Broker): Editor | undefined {
  return [...owner.editors.values()].reverse().find((editor) => editor.isActive());
}
function publish(owner: Broker) {
  const editor = activeEditor(owner);
  owner.channel.postMessage({ v: 1, kind: "state", canCreate: Boolean(owner.prepareCreation || owner.creations.size),
    target: editor ? { id: editor.id, title: editor.title.trim() || "Untitled note", pending: editor.isPending() } : null });
}

async function receiveExcerpt(owner: Broker, message: Record<string, unknown>) {
  if (!isPdfExcerpt(message.excerpt)) throw new Error("Invalid PDF selection.");
  if (message.mode === "append") {
    const target = activeEditor(owner);
    if (!target || target.id !== message.targetId) throw new Error("The active draft changed. Select the intended draft in the notebook and try again.");
    if (target.isPending()) throw new Error("The draft is saving. Wait for it to finish before appending.");
    await target.onAppend(message.excerpt);
    return;
  }
  if (message.mode !== "new") throw new Error("Unknown excerpt action.");
  owner.prepareCreation?.();
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const target = [...owner.creations.values()].find((candidate) => candidate.isReady?.() !== false);
    if (target) { await target.onCreate(message.excerpt); return; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The notebook is not ready. Open its Notes or Knowledge view and try again.");
}

/** A window owns one broker; the factory also exercises the actual channel protocol in tests. */
export function createPdfExcerptBroker(): Broker {
  const id = crypto.randomUUID();
  const owner: Broker = { id, channel: new BroadcastChannel(`babel:pdf:${id}`), creations: new Map(), editors: new Map(), requests: new Map() };
  owner.channel.onmessage = (event: MessageEvent<unknown>) => {
    const message = event.data;
    if (!message || typeof message !== "object" || (message as { v?: unknown }).v !== 1) return;
    const data = message as Record<string, unknown>;
    if (data.kind === "state-request") { publish(owner); return; }
    if (data.kind !== "excerpt" || typeof data.requestId !== "string" || !/^[a-z0-9-]{1,128}$/iu.test(data.requestId)) return;
    let action = owner.requests.get(data.requestId);
    if (!action) {
      action = receiveExcerpt(owner, data);
      owner.requests.set(data.requestId, action);
      if (owner.requests.size > 200) owner.requests.delete(owner.requests.keys().next().value!);
    }
    void action.then(() => owner.channel.postMessage({ v: 1, kind: "result", requestId: data.requestId, ok: true }),
      (error: unknown) => owner.channel.postMessage({ v: 1, kind: "result", requestId: data.requestId, ok: false, error: error instanceof Error ? error.message : "Could not create the excerpt." })).then(() => publish(owner));
  };
  return owner;
}

function getBroker(): Broker { return broker ??= createPdfExcerptBroker(); }

export function pdfExcerptOwnerId(): string { return getBroker().id; }
export function preparePdfExcerptOwner(prepareCreation: () => void): () => void {
  const owner = getBroker();
  owner.prepareCreation = prepareCreation;
  return () => { if (owner.prepareCreation === prepareCreation) owner.prepareCreation = undefined; };
}

export function usePdfExcerptCreation(options: Creation): void {
  const latest = useRef(options);
  useLayoutEffect(() => { latest.current = options; });
  useEffect(() => {
    const owner = getBroker();
    const entry: Creation = { id: options.id, onCreate: (excerpt) => latest.current.onCreate(excerpt), isReady: () => latest.current.isReady?.() !== false };
    owner.creations.set(options.id, entry);
    return () => { if (owner.creations.get(options.id) === entry) owner.creations.delete(options.id); };
  }, [options.id]);
}

export function usePdfExcerptEditor(options: Editor): void {
  const latest = useRef(options);
  useLayoutEffect(() => { latest.current = options; });
  useEffect(() => {
    const owner = getBroker();
    const entry: Editor = { id: options.id, get title() { return latest.current.title; }, isActive: () => latest.current.isActive(), isPending: () => latest.current.isPending(), onAppend: (excerpt) => latest.current.onAppend(excerpt) };
    owner.editors.set(options.id, entry);
    return () => { if (owner.editors.get(options.id) === entry) owner.editors.delete(options.id); };
  }, [options.id]);
}

export function usePdfNotebookConnection(ownerId: string) {
  const [state, setState] = useState<PdfNotebookState>({ connected: false, canCreate: false, target: null });
  const channelRef = useRef<BroadcastChannel | null>(null);
  const pending = useRef(new Map<string, { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>());
  useEffect(() => {
    if (!/^[a-z0-9-]{1,128}$/iu.test(ownerId)) return;
    const channel = new BroadcastChannel(`babel:pdf:${ownerId}`);
    const requests = pending.current;
    channelRef.current = channel;
    let lastSeen = 0;
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (!event.data || typeof event.data !== "object") return;
      const data = event.data as Record<string, unknown>;
      if (data.v !== 1) return;
      if (data.kind === "state") {
        lastSeen = Date.now();
        const candidate = data.target as Partial<PdfDraftTarget> | null;
        const target = candidate && typeof candidate.id === "string" && typeof candidate.title === "string" && typeof candidate.pending === "boolean" ? candidate as PdfDraftTarget : null;
        setState({ connected: true, canCreate: data.canCreate === true, target });
      } else if (data.kind === "result" && typeof data.requestId === "string") {
        const request = requests.get(data.requestId);
        if (!request) return;
        clearTimeout(request.timer);
        requests.delete(data.requestId);
        if (data.ok === true) request.resolve();
        else request.reject(new Error(typeof data.error === "string" ? data.error : "The excerpt could not be added."));
      }
    };
    const poll = () => {
      channel.postMessage({ v: 1, kind: "state-request" });
      if (lastSeen && Date.now() - lastSeen > 3500) setState({ connected: false, canCreate: false, target: null });
    };
    poll();
    const timer = setInterval(poll, 900);
    return () => {
      clearInterval(timer);
      channel.close();
      channelRef.current = null;
      for (const request of requests.values()) { clearTimeout(request.timer); request.reject(new Error("PDF window disconnected.")); }
      requests.clear();
    };
  }, [ownerId]);

  async function sendExcerpt(mode: "new" | "append", excerpt: PdfExcerpt): Promise<void> {
    if (!channelRef.current || !state.connected) throw new Error("Open this PDF from the notebook's PDF library to create excerpts.");
    if (mode === "append" && (!state.target || state.target.pending)) throw new Error("Open a draft in the notebook before appending.");
    const requestId = crypto.randomUUID();
    const completion = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { pending.current.delete(requestId); reject(new Error("The notebook did not respond. Check its window before trying again.")); }, 20_000);
      pending.current.set(requestId, { resolve, reject, timer });
    });
    channelRef.current.postMessage({ v: 1, kind: "excerpt", requestId, mode, excerpt, targetId: mode === "append" ? state.target?.id : undefined });
    await completion;
  }
  return { state, sendExcerpt };
}
