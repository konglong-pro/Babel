"use client";

import {
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import {
  fitCanvasViewport,
  type CanvasArrowElement,
  type CanvasDetail,
  type CanvasElement,
  type CanvasPathElement,
  type CanvasPoint,
  type CanvasScene,
  type CanvasShapeElement,
  type CanvasViewport,
} from "./core";

type CanvasTool = "select" | "hand" | "card" | "pen" | "rectangle" | "ellipse" | "arrow";
type SaveState = "saved" | "pending" | "saving" | "error";

export interface CanvasEditorProps {
  canvas: CanvasDetail;
  updateCanvas: (id: number, input: { scene: CanvasScene }) => Promise<CanvasDetail>;
  errorMessage: (error: unknown) => string;
  onSaved: (canvas: CanvasDetail) => void;
  onSaveStateChange?: (state: SaveState) => void;
  onRegisterSave?: (action: (() => void) | null) => void;
}

type Interaction =
  | { type: "pan"; pointerId: number; origin: CanvasPoint; viewport: CanvasViewport }
  | { type: "draw"; pointerId: number; elementId: string; origin: CanvasPoint }
  | {
      type: "move";
      pointerId: number;
      elementId: string;
      origin: CanvasPoint;
      before: CanvasScene;
      moved: boolean;
    };

const tools: ReadonlyArray<{ id: CanvasTool; label: string; shortcut: string }> = [
  { id: "select", label: "Select", shortcut: "V" },
  { id: "hand", label: "Hand", shortcut: "H" },
  { id: "card", label: "Card", shortcut: "N" },
  { id: "pen", label: "Pen", shortcut: "P" },
  { id: "rectangle", label: "Rectangle", shortcut: "R" },
  { id: "ellipse", label: "Ellipse", shortcut: "O" },
  { id: "arrow", label: "Arrow", shortcut: "A" },
];

export function CanvasEditor({
  canvas,
  updateCanvas,
  errorMessage,
  onSaved,
  onSaveStateChange,
  onRegisterSave,
}: CanvasEditorProps) {
  const [scene, setScene] = useState<CanvasScene>(canvas.scene);
  const [tool, setTool] = useState<CanvasTool>("select");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [history, setHistory] = useState<CanvasScene[]>([]);
  const [future, setFuture] = useState<CanvasScene[]>([]);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const interactionRef = useRef<Interaction | null>(null);
  const sceneRef = useRef(scene);
  const lastSavedRef = useRef(JSON.stringify(canvas.scene));
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const markerId = `${useId().replaceAll(":", "")}-canvas-arrow`;
  const gridId = `${useId().replaceAll(":", "")}-canvas-grid`;

  const queueSave = useCallback((nextScene: CanvasScene, reportState = true): Promise<void> => {
    const snapshot = JSON.stringify(nextScene);
    if (snapshot === lastSavedRef.current) return saveChainRef.current;
    if (reportState) {
      setSaveState("saving");
      setSaveError(null);
    }
    saveChainRef.current = saveChainRef.current
      .catch(() => undefined)
      .then(async () => {
        const updated = await updateCanvas(canvas.id, { scene: nextScene });
        lastSavedRef.current = snapshot;
        onSaved(updated);
      })
      .then(
        () => {
          if (reportState) {
            setSaveState(JSON.stringify(sceneRef.current) === snapshot ? "saved" : "pending");
          }
        },
        (cause: unknown) => {
          if (reportState) {
            setSaveState("error");
            setSaveError(errorMessage(cause));
          }
        },
      );
    return saveChainRef.current;
  }, [canvas.id, errorMessage, onSaved, updateCanvas]);

  useEffect(() => {
    sceneRef.current = scene;
    if (JSON.stringify(scene) === lastSavedRef.current) return;
    setSaveState("pending");
    const timer = window.setTimeout(() => void queueSave(scene), 500);
    return () => window.clearTimeout(timer);
  }, [queueSave, scene]);

  useEffect(() => () => {
    const latestScene = sceneRef.current;
    if (JSON.stringify(latestScene) !== lastSavedRef.current) void queueSave(latestScene, false);
  }, [queueSave]);

  useEffect(() => onSaveStateChange?.(saveState), [onSaveStateChange, saveState]);
  useEffect(() => {
    onRegisterSave?.(() => void queueSave(sceneRef.current));
    return () => onRegisterSave?.(null);
  }, [onRegisterSave, queueSave]);

  function commit(next: CanvasScene) {
    setHistory((items) => [...items.slice(-49), scene]);
    setFuture([]);
    setScene(next);
  }

  function undo() {
    const previous = history.at(-1);
    if (!previous) return;
    setFuture((items) => [scene, ...items].slice(0, 50));
    setHistory((items) => items.slice(0, -1));
    setScene(previous);
    setSelectedId(null);
  }

  function redo() {
    const next = future[0];
    if (!next) return;
    setHistory((items) => [...items.slice(-49), scene]);
    setFuture((items) => items.slice(1));
    setScene(next);
    setSelectedId(null);
  }

  function deleteSelected() {
    if (!selectedId) return;
    commit({ ...scene, elements: scene.elements.filter(({ id }) => id !== selectedId) });
    setSelectedId(null);
  }

  function handleKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    if (event.target instanceof HTMLTextAreaElement) return;
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === "z") {
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && key === "y") {
      event.preventDefault();
      redo();
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      deleteSelected();
      return;
    }
    const match = tools.find(({ shortcut }) => shortcut.toLowerCase() === key);
    if (match) setTool(match.id);
  }

  function handleStagePointerDown(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0 && event.button !== 1) return;
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    const screen = screenPoint(event);
    const point = worldPoint(screen, scene.viewport);
    if (tool === "hand" || event.button === 1) {
      interactionRef.current = { type: "pan", pointerId: event.pointerId, origin: screen, viewport: scene.viewport };
      return;
    }
    setSelectedId(null);
    if (tool === "select") return;

    const id = makeElementId();
    let element: CanvasElement;
    if (tool === "card") {
      element = { id, type: "card", x: point.x, y: point.y, width: 240, height: 140, text: "" };
      commit({ ...scene, elements: [...scene.elements, element] });
      setSelectedId(id);
      setTool("select");
      return;
    }
    if (tool === "pen") element = { id, type: "path", points: [point, point] };
    else if (tool === "arrow") element = { id, type: "arrow", start: point, end: point };
    else element = { id, type: "shape", shape: tool, x: point.x, y: point.y, width: 1, height: 1 };
    setHistory((items) => [...items.slice(-49), scene]);
    setFuture([]);
    setScene({ ...scene, elements: [...scene.elements, element] });
    setSelectedId(id);
    interactionRef.current = { type: "draw", pointerId: event.pointerId, elementId: id, origin: point };
  }

  function handleStagePointerMove(event: PointerEvent<SVGSVGElement>) {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    const screen = screenPoint(event);
    if (interaction.type === "pan") {
      setScene((current) => ({
        ...current,
        viewport: {
          ...interaction.viewport,
          x: interaction.viewport.x + screen.x - interaction.origin.x,
          y: interaction.viewport.y + screen.y - interaction.origin.y,
        },
      }));
      return;
    }
    const point = worldPoint(screen, scene.viewport);
    if (interaction.type === "draw") {
      setScene((current) => ({
        ...current,
        elements: current.elements.map((element) =>
          element.id === interaction.elementId ? updateDraftElement(element, interaction.origin, point) : element),
      }));
      return;
    }
    const dx = point.x - interaction.origin.x;
    const dy = point.y - interaction.origin.y;
    if (!interaction.moved && (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5)) {
      interaction.moved = true;
      setHistory((items) => [...items.slice(-49), interaction.before]);
      setFuture([]);
    }
    if (interaction.moved) {
      setScene((current) => ({
        ...current,
        elements: interaction.before.elements.map((element) =>
          element.id === interaction.elementId ? translateElement(element, dx, dy) : element),
      }));
    }
  }

  function endInteraction(event: PointerEvent<SVGSVGElement>) {
    if (interactionRef.current?.pointerId === event.pointerId) interactionRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function startElementMove(event: PointerEvent<SVGElement>, elementId: string) {
    if (tool !== "select" || event.button !== 0) return;
    event.stopPropagation();
    const svg = svgRef.current;
    if (!svg) return;
    svg.focus();
    svg.setPointerCapture(event.pointerId);
    setSelectedId(elementId);
    interactionRef.current = {
      type: "move",
      pointerId: event.pointerId,
      elementId,
      origin: worldPoint(screenPoint(event, svg), scene.viewport),
      before: scene,
      moved: false,
    };
  }

  function handleWheel(event: WheelEvent<SVGSVGElement>) {
    const screen = screenPoint(event);
    const world = worldPoint(screen, scene.viewport);
    const zoom = clamp(scene.viewport.zoom * Math.exp(-event.deltaY * 0.0012), 0.1, 4);
    setScene({ ...scene, viewport: { x: screen.x - world.x * zoom, y: screen.y - world.y * zoom, zoom } });
  }

  function setZoom(zoom: number) {
    const svg = svgRef.current;
    const center = { x: (svg?.clientWidth ?? 800) / 2, y: (svg?.clientHeight ?? 600) / 2 };
    const world = worldPoint(center, scene.viewport);
    const nextZoom = clamp(zoom, 0.1, 4);
    setScene({ ...scene, viewport: { x: center.x - world.x * nextZoom, y: center.y - world.y * nextZoom, zoom: nextZoom } });
  }

  return (
    <div className="canvas-editor">
      <div className="canvas-toolbar" role="toolbar" aria-label="Canvas tools">
        <div className="canvas-tool-group">
          {tools.map(({ id, label, shortcut }) => (
            <button key={id} className={tool === id ? "active" : undefined} type="button"
              title={`${label} (${shortcut})`} aria-pressed={tool === id} onClick={() => setTool(id)}>
              {toolGlyph(id)} <span>{label}</span>
            </button>
          ))}
        </div>
        <div className="canvas-tool-group canvas-history-tools">
          <button type="button" disabled={history.length === 0} onClick={undo}>Undo</button>
          <button type="button" disabled={future.length === 0} onClick={redo}>Redo</button>
          <button type="button" disabled={!selectedId} onClick={deleteSelected}>Delete</button>
        </div>
        <div className="canvas-save-status" data-state={saveState}>
          {saveState === "saved" ? "Saved" : saveState === "pending" ? "Unsaved changes" : saveState === "saving" ? "Saving…" : "Save failed"}
          {saveError ? <span title={saveError}> — {saveError}</span> : null}
        </div>
      </div>
      <div className="canvas-stage-wrap">
        <svg ref={svgRef} className={`canvas-stage tool-${tool}`} role="application"
          aria-label="Infinite brainstorming canvas" tabIndex={0} onKeyDown={handleKeyDown}
          onPointerDown={handleStagePointerDown} onPointerMove={handleStagePointerMove}
          onPointerUp={endInteraction} onPointerCancel={endInteraction} onWheel={handleWheel}>
          <CanvasDefinitions gridId={gridId} markerId={markerId} viewport={scene.viewport} />
          <rect width="100%" height="100%" className="canvas-grid" fill={`url(#${gridId})`} />
          <g transform={`translate(${scene.viewport.x} ${scene.viewport.y}) scale(${scene.viewport.zoom})`}>
            {scene.elements.map((element) => (
              <CanvasElementView key={element.id} element={element} selected={selectedId === element.id}
                markerId={markerId} editable onPointerDown={(event) => startElementMove(event, element.id)}
                onCardTextChange={(text) => setScene((current) => ({
                  ...current,
                  elements: current.elements.map((item) => item.id === element.id && item.type === "card" ? { ...item, text } : item),
                }))} />
            ))}
          </g>
        </svg>
        <div className="canvas-zoom-controls" aria-label="Canvas zoom">
          <button type="button" aria-label="Zoom out" onClick={() => setZoom(scene.viewport.zoom / 1.2)}>−</button>
          <button type="button" onClick={() => setZoom(1)}>{Math.round(scene.viewport.zoom * 100)}%</button>
          <button type="button" aria-label="Zoom in" onClick={() => setZoom(scene.viewport.zoom * 1.2)}>+</button>
        </div>
      </div>
    </div>
  );
}

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
            <CanvasElementView key={element.id} element={element} selected={false} markerId={markerId} editable={false}
              onPointerDown={() => undefined} onCardTextChange={() => undefined} />
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

function CanvasDefinitions({ gridId, markerId, viewport }: {
  gridId: string;
  markerId: string;
  viewport: CanvasViewport;
}) {
  const gridSize = 24 * viewport.zoom;
  return (
    <defs>
      <pattern id={gridId} width={gridSize} height={gridSize} patternUnits="userSpaceOnUse"
        x={viewport.x % gridSize} y={viewport.y % gridSize}>
        <circle cx={1} cy={1} r={1} className="canvas-grid-dot" />
      </pattern>
      <marker id={markerId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" />
      </marker>
    </defs>
  );
}

function CanvasElementView({ element, selected, markerId, editable, onPointerDown, onCardTextChange }: {
  element: CanvasElement;
  selected: boolean;
  markerId: string;
  editable: boolean;
  onPointerDown: (event: PointerEvent<SVGElement>) => void;
  onCardTextChange: (text: string) => void;
}) {
  const className = `canvas-element${selected ? " selected" : ""}`;
  if (element.type === "card") {
    return (
      <g className={className} onPointerDown={onPointerDown}>
        <rect className="canvas-card" x={element.x} y={element.y} width={element.width} height={element.height} rx="5" />
        <rect className="canvas-card-handle" x={element.x} y={element.y} width={element.width} height="22" rx="5" />
        <foreignObject x={element.x + 10} y={element.y + 30} width={element.width - 20} height={element.height - 40}>
          {editable ? (
            <textarea className="canvas-card-text" aria-label="Card text" maxLength={20_000}
              placeholder="Type an unfinished thought…" value={element.text}
              onPointerDown={(event) => event.stopPropagation()} onChange={(event) => onCardTextChange(event.target.value)} />
          ) : <div className="canvas-card-text canvas-card-text--preview">{element.text}</div>}
        </foreignObject>
      </g>
    );
  }
  if (element.type === "path") {
    const points = element.points.map(({ x, y }) => `${x},${y}`).join(" ");
    return <g className={className} onPointerDown={onPointerDown}><polyline className="canvas-hit-stroke" points={points} />
      <polyline className="canvas-path" points={points} /></g>;
  }
  if (element.type === "arrow") {
    return <g className={className} onPointerDown={onPointerDown}>
      <line className="canvas-hit-stroke" x1={element.start.x} y1={element.start.y} x2={element.end.x} y2={element.end.y} />
      <line className="canvas-arrow" x1={element.start.x} y1={element.start.y} x2={element.end.x} y2={element.end.y} markerEnd={`url(#${markerId})`} />
    </g>;
  }
  if (element.shape === "ellipse") {
    return <ellipse className={className} cx={element.x + element.width / 2} cy={element.y + element.height / 2}
      rx={element.width / 2} ry={element.height / 2} onPointerDown={onPointerDown} />;
  }
  return <rect className={className} x={element.x} y={element.y} width={element.width}
    height={element.height} rx="3" onPointerDown={onPointerDown} />;
}

function updateDraftElement(element: CanvasElement, origin: CanvasPoint, point: CanvasPoint): CanvasElement {
  if (element.type === "path") {
    const previous = element.points.at(-1)!;
    if (distance(previous, point) < 2) return element;
    return { ...element, points: [...element.points, point] } satisfies CanvasPathElement;
  }
  if (element.type === "arrow") return { ...element, end: point } satisfies CanvasArrowElement;
  if (element.type === "shape") {
    return { ...element, x: Math.min(origin.x, point.x), y: Math.min(origin.y, point.y),
      width: Math.max(1, Math.abs(point.x - origin.x)), height: Math.max(1, Math.abs(point.y - origin.y)) } satisfies CanvasShapeElement;
  }
  return element;
}

function translateElement(element: CanvasElement, dx: number, dy: number): CanvasElement {
  if (element.type === "path") return { ...element, points: element.points.map((point) => ({ x: point.x + dx, y: point.y + dy })) };
  if (element.type === "arrow") return { ...element, start: { x: element.start.x + dx, y: element.start.y + dy },
    end: { x: element.end.x + dx, y: element.end.y + dy } };
  return { ...element, x: element.x + dx, y: element.y + dy };
}

function screenPoint(event: PointerEvent<SVGElement> | WheelEvent<SVGSVGElement>, element = event.currentTarget): CanvasPoint {
  const bounds = element.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

function worldPoint(point: CanvasPoint, viewport: CanvasViewport): CanvasPoint {
  return { x: (point.x - viewport.x) / viewport.zoom, y: (point.y - viewport.y) / viewport.zoom };
}

function distance(left: CanvasPoint, right: CanvasPoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function makeElementId(): string {
  return `e_${crypto.randomUUID().replaceAll("-", "")}`;
}

function toolGlyph(tool: CanvasTool): string {
  if (tool === "select") return "↖";
  if (tool === "hand") return "✋";
  if (tool === "card") return "▤";
  if (tool === "pen") return "⌁";
  if (tool === "rectangle") return "□";
  if (tool === "ellipse") return "○";
  return "↗";
}
