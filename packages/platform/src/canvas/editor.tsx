"use client";

import React, { type PointerEvent, useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { usePageDeckPageContext, useWorkspaceProcessActive } from "../pages/react";
import { useCommandPaletteActions } from "../shortcuts/react";
import { useCanvasAutosave } from "./autosave";
import { encodeCanvasScene, fitCanvasViewport, type CanvasBounds, type CanvasDetail, type CanvasElement,
  type CanvasPoint, type CanvasScene, type CanvasViewport } from "./core";
import { CANVAS_TOOLS, canvasToolFromKey, recordCanvasChange, stepCanvasHistory, type CanvasHistory, type CanvasTool } from "./editor-state";
import { readCanvasClipboardImage } from "./images";
import { boundsForElements, deleteElements, eraseElements, findArrowBinding, intersectsBounds, resizeElements,
  resolveArrowBindings, translateElements } from "./operations";
import { CanvasDefinitions, CanvasElementView } from "./render";

type SaveState = "saved" | "pending" | "saving" | "error";
export interface CanvasEditorProps {
  canvas: CanvasDetail;
  updateCanvas: (id: number, input: { scene: CanvasScene }) => Promise<CanvasDetail>;
  errorMessage: (error: unknown) => string;
  onSaved: (canvas: CanvasDetail) => void;
  onSaveStateChange?: (state: SaveState) => void;
  onRegisterSave?: (action: (() => void) | null) => void;
  onRegisterDiscard?: (action: (() => Promise<void>) | null) => void;
}
type Properties = { stroke: string; strokeWidth: number; fill: string; fontSize: number; textAlign: "left" | "center" | "right" };
const INITIAL_PROPERTIES: Properties = { stroke: "#202020", strokeWidth: 3, fill: "none", fontSize: 24, textAlign: "left" };
type Interaction = { pointerId: number; origin: CanvasPoint; before: CanvasElement[] } & (
  | { type: "pan"; viewport: CanvasViewport }
  | { type: "draw"; id: string }
  | { type: "erase"; previous: CanvasPoint }
  | { type: "move"; ids: Set<string> }
  | { type: "resize"; ids: Set<string>; bounds: CanvasBounds; corner: string }
  | { type: "marquee"; previousIds: Set<string> }
);

export function CanvasEditor(props: CanvasEditorProps) {
  const [scene, setScene] = useState(props.canvas.scene);
  const sceneRef = useRef(scene);
  const [tool, setTool] = useState<CanvasTool>("select");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<CanvasHistory>({ past: [], future: [] });
  const [settings, setSettings] = useState<Partial<Record<CanvasTool, Properties>>>({});
  const [eraserSize, setEraserSize] = useState(24);
  const [cursor, setCursor] = useState<CanvasPoint | null>(null);
  const [marquee, setMarquee] = useState<CanvasBounds | null>(null);
  const [snapPoint, setSnapPoint] = useState<CanvasPoint | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const spaceRef = useRef(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const textSession = useRef<{ id: string; before: CanvasElement[] } | null>(null);
  const [notice, setNotice] = useState("");
  const [pasting, setPasting] = useState(false);
  const pasteRef = useRef(false);
  const alive = useRef(true);
  const rootRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const interaction = useRef<Interaction | null>(null);
  const pointerTargetId = useRef<string | null>(null);
  const processActive = useWorkspaceProcessActive();
  const { active: pageActive } = usePageDeckPageContext();
  const active = processActive && pageActive;
  const markerId = `${useId().replaceAll(":", "")}-arrow`;
  const gridId = `${useId().replaceAll(":", "")}-grid`;
  const { saveState, saveError } = useCanvasAutosave({ ...props, scene });
  const selection = scene.elements.filter(({ id }) => selectedIds.has(id));
  const selectionBounds = boundsForElements(selection);
  const currentProperties = settings[tool] ?? INITIAL_PROPERTIES;
  const first = selection[0];
  const properties: Properties = { ...currentProperties, ...first,
    fontSize: first?.type === "text" ? first.fontSize : currentProperties.fontSize,
    textAlign: first?.type === "text" ? first.textAlign : currentProperties.textAlign };
  const textProperties = tool === "text" || selection.some(({ type }) => type === "text");
  const shapeProperties = tool === "rectangle" || tool === "ellipse" || selection.some(({ type }) => type === "shape");

  function display(next: CanvasScene) { sceneRef.current = next; setScene(next); }
  function displayElements(elements: CanvasElement[]) { display({ ...sceneRef.current, elements }); }
  function record(before: CanvasElement[]) {
    try {
      encodeCanvasScene(sceneRef.current);
      const after = sceneRef.current.elements;
      setHistory((current) => recordCanvasChange(current, before, after));
    } catch (error) {
      displayElements(before);
      setNotice(error instanceof Error ? error.message : "This change could not be saved.");
    }
  }
  function commit(elements: CanvasElement[]) {
    const before = sceneRef.current.elements;
    displayElements(elements);
    record(before);
  }
  function finishText(cancel = false) {
    const session = textSession.current;
    if (!session) return;
    textSession.current = null;
    setEditingId(null);
    if (cancel) displayElements(session.before);
    else {
      const element = sceneRef.current.elements.find(({ id }) => id === session.id);
      if (element?.type === "text" && !element.text.trim()) {
        displayElements(deleteElements(sceneRef.current.elements, new Set([session.id])));
      }
      record(session.before);
    }
  }
  function chooseTool(next: CanvasTool) {
    if (pasteRef.current) return;
    finishText();
    if (interaction.current) return;
    setTool(next); setSelectedIds(new Set()); setNotice("");
    svgRef.current?.focus();
  }
  function travel(direction: "undo" | "redo") {
    if (interaction.current || pasteRef.current) return;
    finishText();
    const next = stepCanvasHistory(history, sceneRef.current.elements, direction);
    if (!next) return;
    setHistory(next.history); displayElements(next.elements); setSelectedIds(new Set());
  }
  function removeSelected() {
    if (interaction.current || pasteRef.current || selectedIds.size === 0) return;
    finishText(); commit(deleteElements(sceneRef.current.elements, selectedIds)); setSelectedIds(new Set());
  }
  function fit(selected = false) {
    const svg = svgRef.current;
    if (!svg) return;
    const elements = selected ? sceneRef.current.elements.filter(({ id }) => selectedIds.has(id)) : sceneRef.current.elements;
    display({ ...sceneRef.current, viewport: fitCanvasViewport(elements, svg.clientWidth, svg.clientHeight, 60) });
  }
  function zoomAt(zoom: number, point: CanvasPoint) {
    if (interaction.current) return;
    const current = sceneRef.current;
    const world = worldPoint(point, current.viewport);
    const nextZoom = clamp(zoom, 0.1, 4);
    display({ ...current, viewport: { x: point.x - world.x * nextZoom, y: point.y - world.y * nextZoom, zoom: nextZoom } });
  }
  function setZoom(zoom: number) {
    zoomAt(zoom, { x: (svgRef.current?.clientWidth ?? 800) / 2, y: (svgRef.current?.clientHeight ?? 600) / 2 });
  }
  function startText(id: string, before = sceneRef.current.elements) {
    if (pasteRef.current) return;
    finishText();
    textSession.current = { id, before }; setEditingId(id); setSelectedIds(new Set([id]));
  }
  function changeProperties(patch: Partial<Properties>) {
    if (pasteRef.current) return;
    setSettings((current) => ({ ...current, [tool]: { ...(current[tool] ?? INITIAL_PROPERTIES), ...patch } }));
    if (!selectedIds.size) return;
    commit(resolveArrowBindings(sceneRef.current.elements.map((element) => {
      if (!selectedIds.has(element.id) || element.type === "image") return element;
      const { fontSize, textAlign, fill, ...stroke } = patch;
      return { ...element, ...stroke,
        ...(fill !== undefined && element.type === "shape" ? { fill } : {}),
        ...(element.type === "text" ? { ...(fontSize ? { fontSize, height: Math.max(element.height, fontSize * 1.4) } : {}), ...(textAlign ? { textAlign } : {}) } : {}) };
    })));
  }

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (!active || event.defaultPrevented || event.isComposing || !rootRef.current?.getClientRects().length || document.querySelector("dialog[open]")) return;
    if (isEditable(event.target) || pasteRef.current) return;
    const nextTool = canvasToolFromKey(event);
    let handled = true;
    if (nextTool) { if (!event.repeat) chooseTool(nextTool); }
    else if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.code === "KeyZ") travel("undo");
    else if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.code === "KeyY") travel("redo");
    else if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.code === "KeyA") setSelectedIds(new Set(sceneRef.current.elements.map(({ id }) => id)));
    else if (event.code === "Space" && !event.ctrlKey && !event.metaKey && !event.altKey) { spaceRef.current = true; setSpaceHeld(true); }
    else if (event.code === "Escape") {
      if (interaction.current) { displayElements(interaction.current.before); interaction.current = null; setMarquee(null); setSnapPoint(null); }
      else { setSelectedIds(new Set()); setTool("select"); }
    }
    else if (!event.ctrlKey && !event.metaKey && !event.altKey && (event.key === "Delete" || event.key === "Backspace")) removeSelected();
    else if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.startsWith("Arrow") && selectedIds.size) {
      const step = event.shiftKey ? 10 : 1;
      commit(translateElements(sceneRef.current.elements, selectedIds, event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0,
        event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0));
    }
    else if (event.code === "Enter" && selection.length === 1 && selection[0].type === "text") startText(selection[0].id);
    else handled = false;
    if (handled) { event.preventDefault(); event.stopPropagation(); }
  });
  const onPaste = useEffectEvent(async (event: ClipboardEvent) => {
    if (!active || isEditable(event.target) || document.querySelector("dialog[open]") || !rootRef.current?.getClientRects().length) return;
    const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith("image/"));
    if (!files.length) return;
    event.preventDefault(); event.stopPropagation();
    if (pasteRef.current || interaction.current) return;
    pasteRef.current = true; setPasting(true); setNotice("");
    const viewport = sceneRef.current.viewport;
    const center = worldPoint({ x: (svgRef.current?.clientWidth ?? 800) / 2, y: (svgRef.current?.clientHeight ?? 600) / 2 }, viewport);
    try {
      const images = await Promise.all(files.map(readCanvasClipboardImage));
      if (!alive.current) return;
      const elements: CanvasElement[] = images.map((image, index) => {
        const scale = Math.min(1, 600 / Math.max(image.width, image.height));
        const width = image.width * scale; const height = image.height * scale;
        return { id: makeId(), type: "image", src: image.src, alt: "Pasted image", width, height,
          x: center.x - width / 2 + index * 24, y: center.y - height / 2 + index * 24 };
      });
      const next = { ...sceneRef.current, elements: [...sceneRef.current.elements, ...elements] };
      encodeCanvasScene(next);
      commit(next.elements); setSelectedIds(new Set(elements.map(({ id }) => id))); setTool("select");
    } catch (error) { if (alive.current) setNotice(error instanceof Error ? error.message : "Could not paste this image."); }
    finally { pasteRef.current = false; if (alive.current) setPasting(false); }
  });
  const onWheel = useEffectEvent((event: WheelEvent) => {
    if (isEditable(event.target)) return;
    event.preventDefault();
    zoomAt(sceneRef.current.viewport.zoom * Math.exp(-event.deltaY * 0.0012), screenPoint(event, svgRef.current!));
  });
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => onKey(event);
    const paste = (event: ClipboardEvent) => { void onPaste(event); };
    const release = (event?: KeyboardEvent) => {
      if (!event || event.code === "Space") { spaceRef.current = false; setSpaceHeld(false); }
    };
    const blur = () => release();
    document.addEventListener("keydown", key);
    document.addEventListener("keyup", release);
    document.addEventListener("paste", paste);
    window.addEventListener("blur", blur);
    return () => {
      document.removeEventListener("keydown", key); document.removeEventListener("keyup", release);
      document.removeEventListener("paste", paste); window.removeEventListener("blur", blur);
    };
  }, []);
  useEffect(() => {
    const svg = svgRef.current;
    const wheel = (event: WheelEvent) => onWheel(event);
    svg?.addEventListener("wheel", wheel, { passive: false });
    return () => svg?.removeEventListener("wheel", wheel);
  }, []);

  useCommandPaletteActions(`canvas-tools.${props.canvas.id}`, active ? [
    ...CANVAS_TOOLS.map(({ id, label, binding }) => ({ id: `canvas.tool.${id}`, label: `Canvas: ${label}`, group: "Canvas tools", binding,
      keywords: ["canvas", "画布", label], run: () => chooseTool(id) })),
    { id: "canvas.undo", label: "Canvas: Undo", group: "Canvas editing", binding: "Ctrl+Z", available: history.past.length > 0, run: () => travel("undo") },
    { id: "canvas.redo", label: "Canvas: Redo", group: "Canvas editing", binding: "Ctrl+Y", available: history.future.length > 0, run: () => travel("redo") },
    { id: "canvas.select-all", label: "Canvas: Select all", group: "Canvas editing", binding: "Ctrl+A", run: () => setSelectedIds(new Set(sceneRef.current.elements.map(({ id }) => id))) },
    { id: "canvas.delete-selection", label: "Canvas: Delete selection", group: "Canvas editing", binding: "Delete", available: selectedIds.size > 0, run: removeSelected },
    { id: "canvas.fit", label: "Canvas: Fit all", group: "Canvas view", run: () => fit() },
    { id: "canvas.fit-selection", label: "Canvas: Fit selection", group: "Canvas view", available: selectedIds.size > 0, run: () => fit(true) },
    { id: "canvas.pan", label: "Canvas: Hold Space and drag to pan", group: "Canvas view", binding: "Space + drag", run: () => chooseTool("hand") },
    { id: "canvas.paste", label: "Canvas: Paste image", group: "Canvas editing", binding: "Ctrl+V", run: () => { svgRef.current?.focus(); setNotice("Copy an image, then press Ctrl+V on the canvas."); } },
  ] : []);

  function pointerDown(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0 && event.button !== 1) return;
    if (interaction.current || pasteRef.current) return;
    finishText(); event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
    const before = sceneRef.current.elements;
    const screen = screenPoint(event, event.currentTarget);
    const point = worldPoint(screen, sceneRef.current.viewport);
    const base = { pointerId: event.pointerId, origin: point, before };
    if (tool === "hand" || spaceRef.current || event.button === 1) {
      interaction.current = { ...base, type: "pan", origin: screen, viewport: sceneRef.current.viewport }; return;
    }
    const target = event.target instanceof Element ? event.target : null;
    const corner = target?.closest("[data-canvas-resize]")?.getAttribute("data-canvas-resize");
    if (corner && selectionBounds) {
      interaction.current = { ...base, type: "resize", ids: selectedIds, bounds: selectionBounds, corner }; return;
    }
    const targetId = target?.closest("[data-canvas-element]")?.getAttribute("data-canvas-element");
    pointerTargetId.current = targetId ?? null;
    const hit = before.find(({ id }) => id === targetId);
    if (tool === "select") {
      if (hit) {
        const ids = new Set(event.shiftKey || selectedIds.has(hit.id) ? selectedIds : []);
        if (event.shiftKey && ids.has(hit.id)) { ids.delete(hit.id); setSelectedIds(ids); return; }
        ids.add(hit.id); setSelectedIds(ids); interaction.current = { ...base, type: "move", ids };
      } else {
        const previousIds = event.shiftKey ? selectedIds : new Set<string>();
        setSelectedIds(previousIds); setMarquee({ ...point, width: 0, height: 0 });
        interaction.current = { ...base, type: "marquee", previousIds };
      }
      return;
    }
    if (tool === "eraser") {
      setSelectedIds(new Set());
      displayElements(eraseElements(before, point, point, eraserSize / (2 * sceneRef.current.viewport.zoom), makeId));
      interaction.current = { ...base, type: "erase", previous: point }; return;
    }
    if (tool === "text" && hit?.type === "text") { startText(hit.id); return; }
    const id = makeId();
    const style = { stroke: currentProperties.stroke, strokeWidth: currentProperties.strokeWidth };
    let element: CanvasElement;
    if (tool === "text") {
      element = { id, type: "text", ...point, width: 260, height: currentProperties.fontSize * 1.5, text: "",
        fontSize: currentProperties.fontSize, textAlign: currentProperties.textAlign, stroke: currentProperties.stroke };
      displayElements([...before, element]); startText(id, before); return;
    }
    if (tool === "pen") element = { id, type: "path", points: [point, point], ...style };
    else if (tool === "arrow") {
      const snap = findArrowBinding(before, point, 14 / sceneRef.current.viewport.zoom);
      element = { id, type: "arrow", start: snap?.point ?? point, end: point, ...(snap ? { startBinding: snap.binding } : {}), ...style };
    } else element = { id, type: "shape", shape: tool, ...point, width: 1, height: 1, ...style, fill: currentProperties.fill };
    displayElements([...before, element]); setSelectedIds(new Set([id])); interaction.current = { ...base, type: "draw", id };
  }
  function pointerMove(event: PointerEvent<SVGSVGElement>) {
    const current = interaction.current;
    const screen = screenPoint(event, event.currentTarget);
    const point = worldPoint(screen, sceneRef.current.viewport);
    if (tool === "eraser") setCursor(point);
    if (!current || event.pointerId !== current.pointerId) return;
    if (current.type === "pan") {
      display({ ...sceneRef.current, viewport: { ...current.viewport,
        x: current.viewport.x + screen.x - current.origin.x, y: current.viewport.y + screen.y - current.origin.y } }); return;
    }
    if (current.type === "erase") {
      displayElements(eraseElements(sceneRef.current.elements, current.previous, point, eraserSize / (2 * sceneRef.current.viewport.zoom), makeId));
      current.previous = point; return;
    }
    if (current.type === "marquee") {
      const bounds = dragBounds(current.origin, point); setMarquee(bounds);
      setSelectedIds(new Set([...current.previousIds, ...current.before.filter((element) => intersectsBounds(element, bounds)).map(({ id }) => id)])); return;
    }
    if (current.type === "move") {
      displayElements(translateElements(current.before, current.ids, point.x - current.origin.x, point.y - current.origin.y)); return;
    }
    if (current.type === "resize") {
      const { x, y, width, height } = current.bounds;
      const left = current.corner.includes("w") ? Math.min(point.x, x + width - 1) : x;
      const top = current.corner.includes("n") ? Math.min(point.y, y + height - 1) : y;
      const right = current.corner.includes("e") ? Math.max(point.x, x + 1) : x + width;
      const bottom = current.corner.includes("s") ? Math.max(point.y, y + 1) : y + height;
      displayElements(resizeElements(current.before, current.ids, current.bounds, { x: left, y: top, width: right - left, height: bottom - top })); return;
    }
    displayElements(sceneRef.current.elements.map((element) => {
      if (element.id !== current.id) return element;
      if (element.type === "path") {
        const last = element.points.at(-1)!;
        if (Math.hypot(last.x - point.x, last.y - point.y) < 1 / sceneRef.current.viewport.zoom || element.points.length >= 20_000) return element;
        return { ...element, points: [...element.points, point] };
      }
      if (element.type === "shape") return { ...element, ...dragBounds(current.origin, point) };
      if (element.type === "arrow") {
        const snap = findArrowBinding(current.before, point, 14 / sceneRef.current.viewport.zoom);
        setSnapPoint(snap?.point ?? null);
        return { ...element, end: snap?.point ?? point, endBinding: snap?.binding };
      }
      return element;
    }));
  }
  function pointerEnd(event: PointerEvent<SVGSVGElement>, cancel = false) {
    const current = interaction.current;
    if (!current || current.pointerId !== event.pointerId) return;
    interaction.current = null; setMarquee(null); setSnapPoint(null);
    if (cancel && current.type !== "pan") displayElements(current.before);
    else if (current.type !== "pan" && current.type !== "marquee") record(current.before);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return <div className="canvas-editor" ref={rootRef}>
    <div className="canvas-toolbar" role="toolbar" aria-label="Canvas tools">
      <div className="canvas-tool-group">{CANVAS_TOOLS.map(({ id, label, glyph, binding }, index) =>
        <button type="button" key={id} className={tool === id ? "active" : undefined} aria-pressed={tool === id}
          aria-keyshortcuts={binding.replace("Ctrl", "Control")} title={`${label} (${binding})`} onClick={() => chooseTool(id)}>
          <span aria-hidden="true">{glyph}</span><span>{label}</span><kbd>{index + 1}</kbd>
        </button>)}</div>
      <div className="canvas-tool-group canvas-history-tools">
        <button type="button" title="Undo (Ctrl+Z)" aria-keyshortcuts="Control+Z" disabled={!history.past.length} onClick={() => travel("undo")}>Undo</button>
        <button type="button" title="Redo (Ctrl+Y)" aria-keyshortcuts="Control+Y" disabled={!history.future.length} onClick={() => travel("redo")}>Redo</button>
        <button type="button" title="Delete selection (Delete)" disabled={!selectedIds.size} onClick={removeSelected}>Delete</button>
      </div>
      <span className="canvas-save-status" data-state={saveState} role="status">{pasting ? "Pasting image…" : saveState === "saved" ? "Saved" : saveState === "saving" ? "Saving…" : saveState === "error" ? "Save failed" : "Unsaved changes"}</span>
    </div>
    <div className="canvas-properties" role="group" aria-label="Canvas properties">
      {tool === "eraser" ? <label>Eraser size <input type="range" min="8" max="100" step="2" value={eraserSize} onChange={(event) => setEraserSize(Number(event.target.value))} /><output>{eraserSize}px</output></label> : <>
        {first?.type !== "image" && tool !== "hand" ? <label>Color <input type="color" value={properties.stroke.length === 7 ? properties.stroke : "#202020"} onChange={(event) => changeProperties({ stroke: event.target.value })} /></label> : null}
        {!textProperties && first?.type !== "image" && tool !== "hand" ? <label>Width <select value={properties.strokeWidth} onChange={(event) => changeProperties({ strokeWidth: Number(event.target.value) })}>{[1,2,3,5,8,12,20,32].map((width) => <option key={width} value={width}>{width}px</option>)}</select></label> : null}
        {shapeProperties ? <><label><input type="checkbox" checked={properties.fill !== "none"} onChange={(event) => changeProperties({ fill: event.target.checked ? "#dbeafe" : "none" })} />Fill</label>{properties.fill !== "none" ? <label>Fill color <input type="color" value={properties.fill} onChange={(event) => changeProperties({ fill: event.target.value })} /></label> : null}</> : null}
        {textProperties ? <><label>Font size <select value={properties.fontSize} onChange={(event) => changeProperties({ fontSize: Number(event.target.value) })}>{[12,16,20,24,32,48,64,96].map((size) => <option key={size} value={size}>{size}px</option>)}</select></label>
          <label>Align <select value={properties.textAlign} onChange={(event) => changeProperties({ textAlign: event.target.value as Properties["textAlign"] })}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label></> : null}
      </>}
      <span className="canvas-selection-count">{selection.length ? `${selection.length} selected` : CANVAS_TOOLS.find(({ id }) => id === tool)?.label}</span>
      <span className="canvas-shortcut-hint">Ctrl+Shift+1–8 tools · Space drag · Ctrl+V image · Ctrl+K commands</span>
    </div>
    {notice || saveError ? <div className="canvas-editor-notice" role="alert"><span>{notice || saveError}</span><button type="button" aria-label="Dismiss canvas message" onClick={() => setNotice("")}>×</button></div> : null}
    <div className="canvas-stage-wrap">
      <svg ref={svgRef} className={`canvas-stage tool-${spaceHeld ? "hand" : tool}`} role="application" aria-label="Infinite brainstorming canvas" tabIndex={0}
        onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={(event) => pointerEnd(event)} onPointerCancel={(event) => pointerEnd(event, true)}
        onPointerLeave={() => setCursor(null)} onDoubleClick={(event) => {
          if (tool !== "select" && tool !== "text") return;
          // Pointer capture retargets the browser's double-click to the SVG.
          const id = (event.target as Element).closest("[data-canvas-element]")?.getAttribute("data-canvas-element") ?? pointerTargetId.current;
          const element = sceneRef.current.elements.find((item) => item.id === id);
          if (element?.type === "text") startText(element.id);
        }}>
        <CanvasDefinitions gridId={gridId} markerId={markerId} viewport={scene.viewport} />
        <rect width="100%" height="100%" fill={`url(#${gridId})`} />
        <g transform={`translate(${scene.viewport.x} ${scene.viewport.y}) scale(${scene.viewport.zoom})`}>
          {scene.elements.map((element) => <CanvasElementView key={element.id} element={element} markerId={markerId} selected={selectedIds.has(element.id)}
            editing={editingId === element.id} onTextChange={(text, height) => displayElements(resolveArrowBindings(sceneRef.current.elements.map((item) => item.id === element.id && item.type === "text" ? { ...item, text, height } : item)))}
            onTextFinish={(cancel) => finishText(cancel)} />)}
          {selectionBounds && !editingId && tool === "select" ? <g className="canvas-selection-box">
            <rect {...selectionBounds} fill="none" strokeWidth={1 / scene.viewport.zoom} />
            {[["nw",0,0],["ne",1,0],["sw",0,1],["se",1,1]].map(([corner, x, y]) => <rect key={corner} data-canvas-resize={corner}
              x={selectionBounds.x + Number(x) * selectionBounds.width - 4 / scene.viewport.zoom} y={selectionBounds.y + Number(y) * selectionBounds.height - 4 / scene.viewport.zoom}
              width={8 / scene.viewport.zoom} height={8 / scene.viewport.zoom} strokeWidth={1 / scene.viewport.zoom} />)}
          </g> : null}
          {marquee ? <rect {...marquee} className="canvas-marquee" strokeWidth={1 / scene.viewport.zoom} /> : null}
          {snapPoint ? <circle cx={snapPoint.x} cy={snapPoint.y} r={6 / scene.viewport.zoom} className="canvas-snap-point" strokeWidth={2 / scene.viewport.zoom} /> : null}
          {tool === "eraser" && cursor && !spaceHeld ? <circle cx={cursor.x} cy={cursor.y} r={eraserSize / (2 * scene.viewport.zoom)} className="canvas-eraser-cursor" strokeWidth={1 / scene.viewport.zoom} /> : null}
        </g>
      </svg>
      <div className="canvas-zoom-controls" aria-label="Canvas zoom">
        <button type="button" onClick={() => fit()} title="Show all canvas objects">Fit all</button>
        <button type="button" onClick={() => fit(true)} disabled={!selection.length}>Fit selection</button>
        <button type="button" aria-label="Zoom out" onClick={() => setZoom(scene.viewport.zoom / 1.2)}>−</button>
        <button type="button" aria-label="Reset zoom to 100%" onClick={() => setZoom(1)}>{Math.round(scene.viewport.zoom * 100)}%</button>
        <button type="button" aria-label="Zoom in" onClick={() => setZoom(scene.viewport.zoom * 1.2)}>+</button>
      </div>
    </div>
  </div>;
}

function screenPoint(event: { clientX: number; clientY: number }, element: Element): CanvasPoint {
  const bounds = element.getBoundingClientRect(); return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}
function worldPoint(point: CanvasPoint, viewport: CanvasViewport): CanvasPoint {
  return { x: clamp((point.x - viewport.x) / viewport.zoom, -900_000, 900_000), y: clamp((point.y - viewport.y) / viewport.zoom, -900_000, 900_000) };
}
function dragBounds(a: CanvasPoint, b: CanvasPoint): CanvasBounds {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.max(1, Math.abs(b.x - a.x)), height: Math.max(1, Math.abs(b.y - a.y)) };
}
function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }
function makeId() { return `e_${crypto.randomUUID().replaceAll("-", "")}`; }
function isEditable(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}
