"use client";

import {
  type MouseEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

export interface DetachedEditorRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface DetachedEditorViewport {
  screenX: number;
  screenY: number;
  innerWidth: number;
  innerHeight: number;
  outerWidth: number;
  outerHeight: number;
}

export interface PrepareDetachedEditorWindowOptions {
  title: string;
  windowKey: string;
  anchorElement?: HTMLElement | null;
  onBlocked?: () => void;
}

export interface DetachedEditorWindowProps {
  children?: ReactNode;
  title: string;
  windowKey: string;
  label?: string;
  disabled?: boolean;
  onSave?: () => void;
  onBlocked?: () => void;
}

interface DetachedEditorHost {
  windowKey: string;
  popup: Window;
  root: HTMLElement;
}

const preparedHosts = new Map<string, DetachedEditorHost>();

const DETACHED_EDITOR_STYLE = `
html {
  height: 100%;
}

body.babel-detached-editor-window {
  min-height: 100%;
  overflow: hidden;
}

.babel-detached-editor-root {
  width: 100%;
  height: 100vh;
  min-height: 0;
  padding: clamp(1.5rem, 4vw, 4rem);
}

.babel-detached-editor-root > .editor-outline-layout {
  width: 100%;
  height: 100%;
  min-height: 0;
  margin: 0;
  grid-template-columns: minmax(0, 1fr) 220px;
  grid-template-rows: minmax(0, 1fr);
}

.babel-detached-editor-root > .babel-detached-editor-sections {
  display: grid;
  height: 100%;
  min-height: 0;
  gap: 2rem;
  overflow: auto;
  overscroll-behavior: contain;
}

.babel-detached-editor-root
  > .babel-detached-editor-sections
  > .editor-outline-layout {
  min-height: min(70vh, 44rem);
  grid-template-columns: minmax(0, 1fr) 220px;
}

.babel-detached-editor-root .editor-field {
  height: 100%;
  min-height: 0;
  grid-template-rows: auto minmax(0, 1fr);
}

.babel-detached-editor-root .editor-grid {
  height: 100%;
  min-height: 0;
}

.babel-detached-editor-root .editor-grid textarea {
  height: 100%;
  min-height: 100%;
  resize: none;
}

.babel-detached-editor-root .outline-panel {
  position: sticky;
  order: initial;
  max-height: 100%;
  overflow: hidden;
  border-bottom: 0;
  border-left: 1px solid var(--line);
  padding: 0 0 0 1rem;
}

.babel-detached-editor-root .outline-panel ol {
  max-height: calc(100vh - 6rem);
}

@media (max-width: 620px) {
  body.babel-detached-editor-window {
    overflow: auto;
  }

  .babel-detached-editor-root {
    height: auto;
    min-height: 100vh;
  }

  .babel-detached-editor-root > .editor-outline-layout {
    height: auto;
    grid-template-columns: minmax(0, 1fr);
  }

  .babel-detached-editor-root > .babel-detached-editor-sections {
    height: auto;
    overflow: visible;
  }

  .babel-detached-editor-root
    > .babel-detached-editor-sections
    > .editor-outline-layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .babel-detached-editor-root .editor-field {
    min-height: 70vh;
  }

  .babel-detached-editor-root .outline-panel {
    position: static;
    order: -1;
    border-bottom: 1px solid var(--line);
    border-left: 0;
    padding: 0 0 0.8rem;
  }
}
`;

export function detachedEditorWindowName(windowKey: string): string {
  const normalized = windowKey
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return `babel-editor-${normalized || "document"}`;
}

export function detachedEditorWindowFeatures(
  rect: DetachedEditorRect,
  viewport: DetachedEditorViewport,
): string {
  const horizontalChrome = Math.max(0, viewport.outerWidth - viewport.innerWidth) / 2;
  const verticalChrome = Math.max(0, viewport.outerHeight - viewport.innerHeight);
  const left = Math.round(viewport.screenX + horizontalChrome + rect.left);
  const top = Math.round(viewport.screenY + verticalChrome + rect.top);
  const width = Math.max(320, Math.round(rect.width));
  const height = Math.max(320, Math.round(rect.height));

  return [
    // Request normal browser chrome so the editor has native window controls.
    "popup=no",
    `left=${left}`,
    `top=${top}`,
    `width=${width}`,
    `height=${height}`,
    "resizable=yes",
    "scrollbars=yes",
  ].join(",");
}

export function prepareDetachedEditorWindow({
  title,
  windowKey,
  anchorElement,
  onBlocked,
}: PrepareDetachedEditorWindowOptions): boolean {
  if (typeof window === "undefined") return false;
  const existing = preparedHosts.get(windowKey);
  if (existing !== undefined && hostIsUsable(existing)) {
    existing.popup.focus();
    return true;
  }
  preparedHosts.delete(windowKey);

  const host = createDetachedEditorHost(title, windowKey, anchorElement ?? null, onBlocked);
  if (host === null) return false;
  preparedHosts.set(windowKey, host);

  window.setTimeout(() => {
    if (preparedHosts.get(windowKey) !== host) return;
    preparedHosts.delete(windowKey);
    if (hostIsUsable(host)) host.popup.close();
  }, 5_000);
  return true;
}

export function DetachedEditorWindow(props: DetachedEditorWindowProps) {
  return <DetachedEditorWindowInstance key={props.windowKey} {...props} />;
}

function DetachedEditorWindowInstance({
  children,
  title,
  windowKey,
  label = "Content",
  disabled = false,
  onSave,
  onBlocked,
}: DetachedEditorWindowProps) {
  const [host, setHost] = useState<DetachedEditorHost | null>(() => peekPreparedHost(windowKey));
  const hostRef = useRef<DetachedEditorHost | null>(host);
  const closeTimerRef = useRef<number | null>(null);
  const onSaveRef = useRef(onSave);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    hostRef.current = host;
    if (host !== null && preparedHosts.get(windowKey) === host) {
      preparedHosts.delete(windowKey);
    }
  }, [host, windowKey]);

  useEffect(() => {
    if (host === null) return;
    try {
      updateDetachedEditorTitle(host.popup, title);
    } catch {
      window.setTimeout(() => {
        setHost((current) => current?.root === host.root ? null : current);
      }, 0);
    }
  }, [host, title]);

  useEffect(() => {
    if (host === null) return;
    const { popup } = host;
    const forgetClosedWindow = () => {
      if (hostIsUsable(host)) return;
      if (hostRef.current?.root === host.root) hostRef.current = null;
      setHost((current) => current?.root === host.root ? null : current);
    };
    const saveFromShortcut = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== "s" ||
        (!event.ctrlKey && !event.metaKey) ||
        event.altKey ||
        event.shiftKey ||
        event.repeat ||
        event.isComposing
      ) return;
      const save = onSaveRef.current;
      if (save === undefined) return;
      event.preventDefault();
      save();
    };
    const interval = window.setInterval(forgetClosedWindow, 500);
    try {
      popup.addEventListener("pagehide", forgetClosedWindow);
      popup.addEventListener("keydown", saveFromShortcut);
      popup.requestAnimationFrame(() => host.root.querySelector("textarea")?.focus());
    } catch {
      forgetClosedWindow();
    }
    return () => {
      window.clearInterval(interval);
      try {
        popup.removeEventListener("pagehide", forgetClosedWindow);
        popup.removeEventListener("keydown", saveFromShortcut);
      } catch {
        // A user can navigate the popup cross-origin before React cleans up.
      }
    };
  }, [host]);

  useEffect(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    return () => {
      const current = hostRef.current;
      closeTimerRef.current = window.setTimeout(() => {
        hostRef.current = null;
        if (current !== null && hostIsUsable(current)) current.popup.close();
        const preparedWindowKey = current?.windowKey ?? windowKey;
        const prepared = preparedHosts.get(preparedWindowKey);
        if (prepared !== undefined) {
          preparedHosts.delete(preparedWindowKey);
          if (hostIsUsable(prepared)) prepared.popup.close();
        }
      }, 0);
    };
  }, [windowKey]);

  function openOrFocus(event: MouseEvent<HTMLButtonElement>) {
    const current = hostRef.current;
    if (current?.windowKey === windowKey && hostIsUsable(current)) {
      current.popup.focus();
      current.root.querySelector("textarea")?.focus();
      return;
    }

    const anchorElement = event.currentTarget.closest<HTMLElement>(".detail-panel");
    const nextHost = createDetachedEditorHost(title, windowKey, anchorElement, onBlocked);
    if (nextHost !== null) {
      hostRef.current = nextHost;
      setHost(nextHost);
    }
  }

  const isOpen = host !== null && hostIsUsable(host);

  return (
    <>
      <section className="babel-detached-editor-launcher" aria-label={`${label} editor`}>
        <div>
          <strong>{label}</strong>
          <p className="muted" aria-live="polite">
            {isOpen
              ? "Open in the focused editing window."
              : "Open the focused editing window to change this field."}
          </p>
        </div>
        <button type="button" disabled={disabled} onClick={openOrFocus}>
          {isOpen ? `Focus ${label}` : `Open ${label}`}
        </button>
      </section>
      {isOpen ? createPortal(children, host.root) : null}
    </>
  );
}

function peekPreparedHost(windowKey: string): DetachedEditorHost | null {
  const host = preparedHosts.get(windowKey);
  if (host !== undefined && hostIsUsable(host)) return host;
  preparedHosts.delete(windowKey);
  return null;
}

function createDetachedEditorHost(
  title: string,
  windowKey: string,
  anchorElement: HTMLElement | null,
  onBlocked: (() => void) | undefined,
): DetachedEditorHost | null {
  const sourceDocument = anchorElement?.ownerDocument ?? document;
  const sourceWindow = sourceDocument.defaultView ?? window;
  const rect = anchorElement?.getBoundingClientRect() ?? {
    left: 0,
    top: 0,
    width: sourceWindow.innerWidth,
    height: sourceWindow.innerHeight,
  };
  const popup = sourceWindow.open(
    "",
    detachedEditorWindowName(windowKey),
    detachedEditorWindowFeatures(rect, sourceWindow),
  );
  if (popup === null) {
    reportBlocked(onBlocked);
    return null;
  }

  try {
    popup.opener = null;
    const root = prepareDetachedEditorDocument(popup, sourceDocument, title);
    if (anchorElement !== null) {
      root.style.padding = sourceWindow.getComputedStyle(anchorElement).padding;
    }
    popup.focus();
    return { windowKey, popup, root };
  } catch {
    popup.close();
    reportBlocked(onBlocked);
    return null;
  }
}

function prepareDetachedEditorDocument(
  popup: Window,
  sourceDocument: Document,
  title: string,
): HTMLElement {
  const targetDocument = popup.document;
  targetDocument.open();
  targetDocument.write("<!doctype html><html><head></head><body></body></html>");
  targetDocument.close();
  targetDocument.documentElement.lang = sourceDocument.documentElement.lang || "en";
  targetDocument.documentElement.className = sourceDocument.documentElement.className;
  targetDocument.head.replaceChildren();

  const charset = targetDocument.createElement("meta");
  charset.setAttribute("charset", "utf-8");
  targetDocument.head.append(charset);

  const viewport = targetDocument.createElement("meta");
  viewport.name = "viewport";
  viewport.content = "width=device-width, initial-scale=1";
  targetDocument.head.append(viewport);

  const base = targetDocument.createElement("base");
  base.href = sourceDocument.baseURI;
  targetDocument.head.append(base);

  for (const sourceNode of sourceDocument.head.querySelectorAll('link[rel="stylesheet"], style')) {
    const clone = sourceNode.cloneNode(true);
    if (clone.nodeName === "LINK" && sourceNode instanceof HTMLLinkElement) {
      (clone as HTMLLinkElement).href = sourceNode.href;
    }
    targetDocument.head.append(clone);
  }

  const editorStyle = targetDocument.createElement("style");
  editorStyle.dataset.babelDetachedEditor = "";
  editorStyle.textContent = DETACHED_EDITOR_STYLE;
  targetDocument.head.append(editorStyle);

  targetDocument.title = title;
  targetDocument.body.replaceChildren();
  targetDocument.body.className = [
    sourceDocument.body.className,
    "babel-detached-editor-window",
  ].filter(Boolean).join(" ");

  const root = targetDocument.createElement("main");
  root.className = "babel-detached-editor-root";
  root.tabIndex = -1;
  targetDocument.body.append(root);
  return root;
}

function updateDetachedEditorTitle(popup: Window, title: string) {
  popup.document.title = title;
}

function hostIsUsable(host: DetachedEditorHost): boolean {
  try {
    return !host.popup.closed && host.root.isConnected && host.popup.document === host.root.ownerDocument;
  } catch {
    return false;
  }
}

function reportBlocked(onBlocked: (() => void) | undefined) {
  if (onBlocked !== undefined) onBlocked();
  else window.alert("The editing window was blocked. Allow pop-ups for this local app and try again.");
}
