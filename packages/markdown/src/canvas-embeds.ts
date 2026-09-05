import { parseCanvasScene, type CanvasDetail } from "@babel-apps/platform/canvas/core";

export interface CanvasEmbedSnapshot {
  canvas: CanvasDetail | null;
  error: string;
}

type Listener = (snapshot: CanvasEmbedSnapshot) => void;
interface CanvasSubscription {
  snapshot: CanvasEmbedSnapshot;
  listeners: Map<Listener, Document>;
  controller: AbortController | null;
  timer: ReturnType<typeof setTimeout> | null;
}

const subscriptions = new Map<number, CanvasSubscription>();

/** One request per canvas, shared only while visible readers still subscribe. */
export function subscribeCanvasEmbed(canvasId: number, document: Document, listener: Listener): () => void {
  let entry = subscriptions.get(canvasId);
  if (entry === undefined) {
    entry = { snapshot: { canvas: null, error: "" }, listeners: new Map(), controller: null, timer: null };
    subscriptions.set(canvasId, entry);
  }
  const subscription = entry;
  subscription.listeners.set(listener, document);
  listener(subscription.snapshot);

  const synchronize = () => {
    if (!hasVisibleReader(subscription)) {
      stopPolling(subscription);
    } else if (subscription.timer === null && subscription.controller === null) {
      void loadCanvas(canvasId, subscription);
    }
  };
  document.addEventListener("visibilitychange", synchronize);
  synchronize();

  return () => {
    document.removeEventListener("visibilitychange", synchronize);
    subscription.listeners.delete(listener);
    synchronize();
    if (subscription.listeners.size === 0) subscriptions.delete(canvasId);
  };
}

function hasVisibleReader(subscription: CanvasSubscription): boolean {
  return [...subscription.listeners.values()].some((document) => document.visibilityState === "visible");
}

function stopPolling(subscription: CanvasSubscription): void {
  if (subscription.timer !== null) clearTimeout(subscription.timer);
  subscription.timer = null;
  subscription.controller?.abort();
  subscription.controller = null;
}

async function loadCanvas(canvasId: number, subscription: CanvasSubscription): Promise<void> {
  const controller = new AbortController();
  subscription.controller = controller;
  let snapshot: CanvasEmbedSnapshot;
  try {
    const response = await fetch(`/api/canvases/${canvasId}`, { signal: controller.signal });
    if (!response.ok) throw new Error(response.status === 404 ? "Canvas unavailable" : "Could not load canvas");
    const payload = await response.json() as CanvasDetail;
    const nextCanvas = { ...payload, scene: parseCanvasScene(payload.scene) };
    const current = subscription.snapshot.canvas;
    snapshot = {
      canvas: current?.id === nextCanvas.id && current.updatedAt === nextCanvas.updatedAt ? current : nextCanvas,
      error: "",
    };
  } catch (error) {
    snapshot = { canvas: null, error: error instanceof Error ? error.message : "Could not load canvas" };
  }
  // An aborted request may still resolve; it must not overwrite a resumed reader.
  if (subscription.controller !== controller || controller.signal.aborted) return;
  subscription.controller = null;
  if (snapshot.canvas !== subscription.snapshot.canvas || snapshot.error !== subscription.snapshot.error) {
    subscription.snapshot = snapshot;
    for (const listener of subscription.listeners.keys()) listener(snapshot);
  }
  if (hasVisibleReader(subscription)) {
    subscription.timer = setTimeout(() => {
      subscription.timer = null;
      void loadCanvas(canvasId, subscription);
    }, 2_000);
  }
}
