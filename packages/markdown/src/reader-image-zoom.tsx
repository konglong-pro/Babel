"use client";

import React, {
  createContext, useCallback, useContext, useEffect, useEffectEvent,
  useId, useLayoutEffect, useRef, useState,
  type ImgHTMLAttributes, type ReactNode,
} from "react";
import { createPortal } from "react-dom";

interface ImageSize { width: number; height: number }
interface OpenImage { src: string; alt: string; trigger: HTMLImageElement }

const ReaderImageContext = createContext<((image: OpenImage) => void) | null>(null);
const PADDING = 48;

export function fitReaderImage(image: ImageSize, viewport: ImageSize): number {
  if (image.width <= 0 || image.height <= 0) return 1;
  return Math.min(1, Math.max(1, viewport.width - PADDING) / image.width,
    Math.max(1, viewport.height - PADDING) / image.height);
}

export function clampReaderImageZoom(scale: number, fit: number): number {
  return Math.min(8, Math.max(Math.min(0.1, fit), scale));
}

/** Only detached Read content opts in; editing previews keep their existing behavior. */
export function ReaderImageZoom({ children }: { children: ReactNode }) {
  const [image, setImage] = useState<OpenImage | null>(null);
  const close = useCallback(() => setImage(null), []);
  return (
    <ReaderImageContext.Provider value={setImage}>
      {children}
      {image === null ? null : createPortal(
        <ReaderImageDialog image={image} onClose={close} />,
        image.trigger.ownerDocument.body,
      )}
    </ReaderImageContext.Provider>
  );
}

export function ReaderImage({ alt = "", ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  const open = useContext(ReaderImageContext);
  const canZoom = open !== null && typeof props.src === "string" && props.src.length > 0;
  function show(image: HTMLImageElement) {
    // Use the resolved URL in the image's own document, including draft blob URLs.
    open?.({ src: image.currentSrc || image.src, alt, trigger: image });
  }
  return (
    // Markdown images can have local/remote/blob sources and unknown dimensions.
    // eslint-disable-next-line @next/next/no-img-element
    <img {...props} alt={alt} loading="lazy"
      className={[props.className, canZoom ? "babel-reader-image" : ""].filter(Boolean).join(" ") || undefined}
      role={canZoom ? "button" : undefined}
      tabIndex={canZoom ? 0 : undefined}
      aria-label={canZoom ? `Zoom image: ${alt.trim() || "Untitled image"}` : undefined}
      aria-haspopup={canZoom ? "dialog" : undefined}
      title={canZoom ? `${props.title ? `${props.title} — ` : ""}Click to zoom` : props.title}
      onClick={canZoom ? (event) => {
        // Preserve modified clicks on linked images (e.g. open link in a new tab).
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        event.stopPropagation();
        show(event.currentTarget);
      } : undefined}
      onKeyDown={canZoom ? (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        show(event.currentTarget);
      } : undefined}
    />
  );
}

function ReaderImageDialog({ image, onClose }: { image: OpenImage; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const helpId = useId();
  const [size, setSize] = useState<ImageSize>({ width: 0, height: 0 });
  const [viewport, setViewport] = useState<ImageSize>({ width: 0, height: 0 });
  const [zoom, setZoom] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const previous = useRef({ scale: 1, width: 0, height: 0, viewport });
  const fit = fitReaderImage(size, viewport);
  const scale = zoom === null ? fit : clampReaderImageZoom(zoom, fit);
  const ready = size.width > 0 && !failed;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    const body = dialog.ownerDocument.body;
    const overflow = body.style.overflow;
    body.style.overflow = "hidden";
    dialog.showModal();
    return () => {
      dialog.close();
      body.style.overflow = overflow;
      if (image.trigger.isConnected) image.trigger.focus({ preventScroll: true });
    };
  }, [image]);

  useEffect(() => {
    const stage = stageRef.current;
    const view = stage?.ownerDocument.defaultView;
    if (!stage || !view) return;
    const observer = new view.ResizeObserver(([entry]) => {
      // Fractional CSS pixels matter under browser/Windows scaling: rounding up
      // clientWidth can otherwise introduce a scrollbar even at Fit.
      setViewport({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  // Keep the same image point at the viewport center when changing zoom.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    const before = previous.current;
    if (stage && before.width === size.width && before.height === size.height && ready) {
      const oldLeft = Math.max(PADDING / 2, (before.viewport.width - size.width * before.scale) / 2);
      const oldTop = Math.max(PADDING / 2, (before.viewport.height - size.height * before.scale) / 2);
      const x = (stage.scrollLeft + before.viewport.width / 2 - oldLeft) / before.scale;
      const y = (stage.scrollTop + before.viewport.height / 2 - oldTop) / before.scale;
      const newLeft = Math.max(PADDING / 2, (viewport.width - size.width * scale) / 2);
      const newTop = Math.max(PADDING / 2, (viewport.height - size.height * scale) / 2);
      stage.scrollLeft = newLeft + x * scale - viewport.width / 2;
      stage.scrollTop = newTop + y * scale - viewport.height / 2;
    }
    previous.current = { scale, width: size.width, height: size.height, viewport };
  }, [scale, size, viewport, ready]);

  function changeZoom(factor: number) {
    if (ready) setZoom(clampReaderImageZoom(scale * factor, fit));
  }
  const onWheel = useEffectEvent((event: WheelEvent) => {
    event.preventDefault();
    if (event.deltaY !== 0) changeZoom(event.deltaY < 0 ? 1.2 : 1 / 1.2);
  });
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const wheel = (event: WheelEvent) => onWheel(event);
    stage.addEventListener("wheel", wheel, { passive: false });
    return () => stage.removeEventListener("wheel", wheel);
  }, []);

  return (
    <dialog ref={dialogRef} className="babel-image-viewer" aria-labelledby={titleId} aria-describedby={helpId}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClose={(event) => { if (!event.currentTarget.open) onClose(); }}
      onClick={(event) => { event.stopPropagation(); if (event.target === event.currentTarget) onClose(); }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (event.key === "+" || event.key === "=") { event.preventDefault(); changeZoom(1.25); }
        if (event.key === "-") { event.preventDefault(); changeZoom(1 / 1.25); }
        if (event.key === "0") { event.preventDefault(); setZoom(null); }
      }}>
      <header className="babel-image-viewer-toolbar">
        <strong id={titleId}>{image.alt.trim() || "Image"}</strong>
        <div className="babel-image-viewer-controls" role="group" aria-label="Image zoom">
          <button type="button" aria-label="Zoom out" title="Zoom out (−)" disabled={!ready || scale <= Math.min(0.1, fit)} onClick={() => changeZoom(1 / 1.25)}>−</button>
          <output aria-label="Zoom level">{ready ? `${Math.round(scale * 100)}%` : "—"}</output>
          <button type="button" aria-label="Zoom in" title="Zoom in (+)" disabled={!ready || scale >= 8} onClick={() => changeZoom(1.25)}>+</button>
          <button type="button" disabled={!ready} onClick={() => setZoom(null)} title="Fit to window (0)">Fit</button>
          <button type="button" disabled={!ready} onClick={() => setZoom(1)} title="Original image size">100%</button>
          <button type="button" onClick={onClose} aria-label="Close image" title="Close (Esc)">Close</button>
        </div>
      </header>
      <div ref={stageRef} className="babel-image-viewer-stage" tabIndex={0} aria-label="Image preview"
        onPointerDown={(event) => {
          if (event.button !== 0 || !ready) return;
          const stage = event.currentTarget;
          drag.current = { x: event.clientX, y: event.clientY, left: stage.scrollLeft, top: stage.scrollTop };
          stage.setPointerCapture(event.pointerId);
          stage.focus({ preventScroll: true });
          stage.dataset.dragging = "true";
          event.preventDefault();
        }}
        onPointerMove={(event) => {
          if (drag.current === null) return;
          event.currentTarget.scrollLeft = drag.current.left - (event.clientX - drag.current.x);
          event.currentTarget.scrollTop = drag.current.top - (event.clientY - drag.current.y);
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          drag.current = null;
          delete event.currentTarget.dataset.dragging;
        }}
        onLostPointerCapture={(event) => { drag.current = null; delete event.currentTarget.dataset.dragging; }}>
        <div className="babel-image-viewer-content" style={{ width: size.width * scale + PADDING, height: size.height * scale + PADDING }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image.src} alt={image.alt} draggable={false}
            style={{ width: ready ? size.width * scale : undefined, height: ready ? size.height * scale : undefined, visibility: ready ? "visible" : "hidden" }}
            onLoad={(event) => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
            onError={() => setFailed(true)} />
          {!ready && <p role="status">{failed ? "This image could not be loaded." : "Loading image…"}</p>}
        </div>
      </div>
      <footer id={helpId}>Scroll or use + / − to zoom · Drag to pan · 0 to fit · Esc to close</footer>
    </dialog>
  );
}
