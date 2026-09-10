"use client";

import React, { type PointerEvent, type WheelEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { fitCanvasViewport, type CanvasPoint, type CanvasScene, type CanvasViewport } from "./core";
import { CanvasDefinitions, CanvasElementView } from "./render";
export { CanvasEditor, type CanvasEditorProps } from "./editor";

export function CanvasPreview({ scene, label }: { scene: CanvasScene; label: string }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const interactionRef = useRef<{ pointerId: number; origin: CanvasPoint; viewport: CanvasViewport } | null>(null);
  const [viewport, setViewport] = useState<CanvasViewport>({ x: 0, y: 0, zoom: 1 });
  const markerId = `${useId().replaceAll(":", "")}-preview-arrow`;
  const gridId = `${useId().replaceAll(":", "")}-preview-grid`;

  const fit = useCallback(() => {
    const svg = svgRef.current;
    if (svg) setViewport(fitCanvasViewport(scene.elements, svg.clientWidth, svg.clientHeight));
  }, [scene.elements]);

  useEffect(() => {
    fit();
    const svg = svgRef.current;
    if (svg === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(fit);
    observer.observe(svg);
    return () => observer.disconnect();
  }, [fit]);

  function pointerDown(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    interactionRef.current = { pointerId: event.pointerId, origin: screenPoint(event), viewport };
  }

  function pointerMove(event: PointerEvent<SVGSVGElement>) {
    const interaction = interactionRef.current;
    if (interaction?.pointerId !== event.pointerId) return;
    const point = screenPoint(event);
    setViewport({ ...interaction.viewport, x: interaction.viewport.x + point.x - interaction.origin.x,
      y: interaction.viewport.y + point.y - interaction.origin.y });
  }

  function pointerEnd(event: PointerEvent<SVGSVGElement>) {
    if (interactionRef.current?.pointerId === event.pointerId) interactionRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function wheel(event: WheelEvent<SVGSVGElement>) {
    const screen = screenPoint(event);
    const world = worldPoint(screen, viewport);
    const zoom = clamp(viewport.zoom * Math.exp(-event.deltaY * 0.0012), 0.1, 4);
    setViewport({ x: screen.x - world.x * zoom, y: screen.y - world.y * zoom, zoom });
  }

  return (
    <span className="canvas-preview-stage">
      <svg ref={svgRef} className="canvas-preview" role="img" aria-label={label} tabIndex={0}
        onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd}
        onPointerCancel={pointerEnd} onWheel={wheel}>
        <CanvasDefinitions gridId={gridId} markerId={markerId} viewport={viewport} />
        <rect width="100%" height="100%" className="canvas-grid" fill={`url(#${gridId})`} />
        <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}>
          {scene.elements.map((element) => (
            <CanvasElementView key={element.id} element={element} markerId={markerId} />
          ))}
        </g>
      </svg>
      {scene.elements.length === 0 ? <span className="canvas-preview-empty">Empty canvas</span> : null}
      <button className="canvas-preview-fit" type="button" onClick={fit}>Fit</button>
    </span>
  );
}

export interface NewContentMenuProps {
  contentLabel: string;
  contentAvailable: boolean;
  onCreateContent: () => void;
  className?: string;
  describedBy?: string;
  unavailableTitle?: string;
  beforeNavigateEvent?: string;
}

export function NewContentMenu({
  contentLabel,
  contentAvailable,
  onCreateContent,
  className,
  describedBy,
  unavailableTitle,
  beforeNavigateEvent,
}: NewContentMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: globalThis.PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div className="new-content-menu" ref={rootRef}>
      <button type="button" data-babel-command="new" className={className}
        aria-expanded={open} aria-haspopup="menu" aria-describedby={describedBy}
        onClick={() => setOpen((current) => !current)}>New</button>
      {open ? (
        <div className="new-content-menu__options" role="menu">
          <button type="button" role="menuitem" disabled={!contentAvailable} title={!contentAvailable ? unavailableTitle : undefined}
            onClick={() => { setOpen(false); onCreateContent(); }}>{contentLabel}</button>
          <button type="button" role="menuitem" onClick={() => {
            setOpen(false);
            const destination = `/canvases?new=${Date.now()}`;
            if (beforeNavigateEvent !== undefined && !window.dispatchEvent(
              new CustomEvent(beforeNavigateEvent, {
                cancelable: true,
                detail: { destination },
              }),
            )) return;
            window.history.pushState(window.history.state, "", destination);
          }}>New canvas</button>
        </div>
      ) : null}
    </div>
  );
}

function screenPoint(event: PointerEvent<SVGElement> | WheelEvent<SVGSVGElement>, element = event.currentTarget): CanvasPoint {
  const bounds = element.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

function worldPoint(point: CanvasPoint, viewport: CanvasViewport): CanvasPoint {
  return { x: (point.x - viewport.x) / viewport.zoom, y: (point.y - viewport.y) / viewport.zoom };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
