"use client";

import React, { type PointerEvent, type WheelEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { fitCanvasViewport, type CanvasPoint, type CanvasScene, type CanvasViewport } from "./core";
import { CanvasDefinitions, CanvasElementView } from "./render";
import { listMenuPosition } from "../navigation/menu-position";
import { useWorkspaceProcessActive } from "../pages/react";
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
  const active = useWorkspaceProcessActive();
  const [open, setOpen] = useState(false);
  const [previousActive, setPreviousActive] = useState(active);
  if (previousActive !== active) {
    setPreviousActive(active);
    if (!active) setOpen(false);
  }
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const focusAfterOpen = useRef<"first" | "last" | null>(null);

  useEffect(() => {
    if (!open || !active) return;
    const popup = popupRef.current;
    const trigger = triggerRef.current;
    if (!popup || !trigger) return;
    if (typeof popup.showPopover === "function") popup.showPopover();
    else popup.setAttribute("data-open", "true");
    const position = () => {
      const bounds = trigger.getBoundingClientRect();
      if (!trigger.getClientRects().length || bounds.bottom < 0 || bounds.top > window.innerHeight ||
        bounds.right < 0 || bounds.left > window.innerWidth) {
        setOpen(false);
        return;
      }
      const placement = listMenuPosition(bounds, {
        width: popup.getBoundingClientRect().width,
        height: popup.scrollHeight + popup.offsetHeight - popup.clientHeight,
      }, { width: window.innerWidth, height: window.innerHeight });
      popup.style.left = `${placement.left}px`;
      popup.style.top = `${placement.top}px`;
      popup.style.maxHeight = `${placement.maxHeight}px`;
    };
    position();
    if (focusAfterOpen.current !== null) {
      const options = popup.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
      options[focusAfterOpen.current === "first" ? 0 : options.length - 1]?.focus();
      focusAfterOpen.current = null;
    }
    const close = (event: globalThis.PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(position);
    observer?.observe(trigger);
    observer?.observe(popup);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      observer?.disconnect();
      if (typeof popup.hidePopover === "function" && popup.matches(":popover-open")) popup.hidePopover();
    };
  }, [active, open]);

  return (
    <div className="new-content-menu" ref={rootRef} data-open={open && active}
      onBlur={event => {
        if (event.relatedTarget !== null && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={event => {
        if (!active || event.ctrlKey || event.altKey || event.metaKey || event.nativeEvent.isComposing || event.key === "Process") return;
        if (!open) {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          event.stopPropagation();
          focusAfterOpen.current = event.key === "ArrowDown" ? "first" : "last";
          setOpen(true);
          return;
        }
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          setOpen(false);
          triggerRef.current?.focus();
        } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const options = Array.from(popupRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
          const index = options.indexOf(event.currentTarget.ownerDocument.activeElement as HTMLButtonElement);
          const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
            : event.key === "ArrowDown" ? (index + 1) % options.length
            : (index < 0 ? options.length - 1 : index - 1 + options.length) % options.length;
          options[next]?.focus();
        }
      }}>
      <button ref={triggerRef} type="button" data-babel-command="new" className={className}
        aria-expanded={open && active} aria-haspopup="menu" aria-describedby={describedBy}
        onClick={() => { if (active) setOpen((current) => !current); }}>New</button>
      {open && active ? (
        <div ref={popupRef} className="new-content-menu__options babel-list-menu-options" role="menu" popover="manual">
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
