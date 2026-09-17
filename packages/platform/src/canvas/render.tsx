"use client";

import React, { useEffect, useRef } from "react";
import type { CanvasElement, CanvasTextElement, CanvasViewport } from "./core";

export function CanvasDefinitions({ gridId, markerId, viewport }: { gridId: string; markerId: string; viewport: CanvasViewport }) {
  const gridSize = 24 * viewport.zoom;
  return <defs>
    <pattern id={gridId} width={gridSize} height={gridSize} patternUnits="userSpaceOnUse" x={viewport.x % gridSize} y={viewport.y % gridSize}>
      <circle cx="1" cy="1" r="1" className="canvas-grid-dot" />
    </pattern>
    <marker id={markerId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" style={{ fill: "context-stroke" }} />
    </marker>
  </defs>;
}

export function CanvasElementView({ element, markerId, selected = false, editing = false, onTextChange, onTextFinish }: {
  element: CanvasElement; markerId: string; selected?: boolean; editing?: boolean;
  onTextChange?: (text: string, height: number) => void; onTextFinish?: (cancel: boolean) => void;
}) {
  const stroke = element.stroke ?? "var(--canvas-stroke, #202020)";
  const style = { stroke, strokeWidth: element.strokeWidth ?? 3, fill: "none" };
  let content;
  if (element.type === "path") {
    const points = element.points.map(({ x, y }) => `${x},${y}`).join(" ");
    content = <><polyline className="canvas-hit-stroke" points={points} /><polyline className="canvas-path" points={points} style={style} /></>;
  } else if (element.type === "arrow") {
    content = <><line className="canvas-hit-stroke" x1={element.start.x} y1={element.start.y} x2={element.end.x} y2={element.end.y} />
      <line className="canvas-arrow" x1={element.start.x} y1={element.start.y} x2={element.end.x} y2={element.end.y} style={style} markerEnd={`url(#${markerId})`} /></>;
  } else if (element.type === "image") {
    content = <image x={element.x} y={element.y} width={element.width} height={element.height} href={element.src} preserveAspectRatio="none"><title>{element.alt ?? "Image"}</title></image>;
  } else if (element.type === "text") {
    content = <foreignObject x={element.x} y={element.y} width={element.width} height={element.height}>
      {editing ? <CanvasTextInput element={element} onChange={onTextChange!} onFinish={onTextFinish!} />
        : <div className="canvas-text-content" style={{ fontSize: element.fontSize, textAlign: element.textAlign, color: stroke }}>{element.text || " "}</div>}
    </foreignObject>;
  } else {
    const shapeStyle = { ...style, fill: element.fill ?? "none", pointerEvents: "all" as const };
    content = element.shape === "ellipse"
      ? <ellipse cx={element.x + element.width / 2} cy={element.y + element.height / 2} rx={element.width / 2} ry={element.height / 2} style={shapeStyle} />
      : <rect x={element.x} y={element.y} width={element.width} height={element.height} rx="3" style={shapeStyle} />;
  }
  return <g className={`canvas-element${selected ? " selected" : ""}`} data-canvas-element={element.id} data-canvas-type={element.type}>{content}</g>;
}

function CanvasTextInput({ element, onChange, onFinish }: { element: CanvasTextElement; onChange: (text: string, height: number) => void; onFinish: (cancel: boolean) => void }) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { inputRef.current?.focus({ preventScroll: true }); }, []);
  return <textarea ref={inputRef} className="canvas-text-input" aria-label="Canvas text" placeholder="Type here…" value={element.text} maxLength={20_000}
    style={{ fontSize: element.fontSize, textAlign: element.textAlign, color: element.stroke ?? "var(--canvas-ink, #202020)" }}
    onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}
    onChange={(event) => onChange(event.target.value, Math.min(100_000, Math.max(element.fontSize * 1.5, event.target.scrollHeight)))}
    onBlur={() => onFinish(false)} onKeyDown={(event) => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === "Escape" || ((event.ctrlKey || event.metaKey) && event.key === "Enter")) {
        event.preventDefault(); event.stopPropagation();
        const svg = event.currentTarget.closest("svg");
        onFinish(event.key === "Escape"); svg?.focus();
      }
    }} />;
}
