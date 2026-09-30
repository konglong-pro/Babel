import type { CanvasElement } from "./core";

export type CanvasTool = "select" | "hand" | "pen" | "eraser" | "text" | "rectangle" | "ellipse" | "arrow";
export const CANVAS_TOOLS: readonly { id: CanvasTool; label: string; glyph: string; binding: string }[] = [
  { id: "select", label: "Select", glyph: "↖", binding: "Ctrl+Shift+1" },
  { id: "hand", label: "Hand", glyph: "✋", binding: "Ctrl+Shift+2" },
  { id: "pen", label: "Pen", glyph: "⌁", binding: "Ctrl+Shift+3" },
  { id: "eraser", label: "Eraser", glyph: "⌫", binding: "Ctrl+Shift+4" },
  { id: "text", label: "Text", glyph: "T", binding: "Ctrl+Shift+5" },
  { id: "rectangle", label: "Rectangle", glyph: "□", binding: "Ctrl+Shift+6" },
  { id: "ellipse", label: "Ellipse", glyph: "○", binding: "Ctrl+Shift+7" },
  { id: "arrow", label: "Arrow", glyph: "↗", binding: "Ctrl+Shift+8" },
];

export interface CanvasHistory {
  past: CanvasElement[][];
  future: CanvasElement[][];
}

/** History holds content snapshots only: navigating the viewport never rewinds content. */
export function recordCanvasChange(history: CanvasHistory, before: CanvasElement[], after: CanvasElement[]): CanvasHistory {
  if (before === after || JSON.stringify(before) === JSON.stringify(after)) return history;
  return { past: [...history.past.slice(-49), before], future: [] };
}

export function stepCanvasHistory(history: CanvasHistory, elements: CanvasElement[], direction: "undo" | "redo") {
  if (direction === "undo") {
    const next = history.past.at(-1);
    return next ? { elements: next, history: { past: history.past.slice(0, -1), future: [elements, ...history.future].slice(0, 50) } } : null;
  }
  const next = history.future[0];
  return next ? { elements: next, history: { past: [...history.past.slice(-49), elements], future: history.future.slice(1) } } : null;
}

export function canvasToolFromKey(event: { code: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean; isComposing: boolean }): CanvasTool | null {
  if (event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey) || !event.shiftKey) return null;
  const match = /^(?:Digit|Numpad)([1-8])$/.exec(event.code);
  return match ? CANVAS_TOOLS[Number(match[1]) - 1].id : null;
}
