"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

import {
  executeShortcutCommand,
  handleShortcutKeyDown,
  useShortcutBinding,
  useShortcutDocument,
} from "@babel-apps/platform/shortcuts/react";
import type { ShortcutBindings } from "@babel-apps/platform/shortcuts/core";

import {
  captureReaderUnderlineAnchor,
  resolveReaderUnderlineAnchor,
  resolveReaderUnderlineRemovalId,
  type ReaderUnderline,
  type ReaderUnderlineAnchor,
  type ReaderTextPosition,
} from "./reader-annotation-anchor";

export type { ReaderUnderline, ReaderUnderlineAnchor } from "./reader-annotation-anchor";
export { captureReaderUnderlineAnchor, resolveReaderUnderlineAnchor } from "./reader-annotation-anchor";

export interface ReaderNoteOption {
  id: number;
  title: string;
}

export interface ReaderAnnotationLayerProps {
  /** One persistent Markdown field, e.g. `problem` or `solution`. */
  fieldKey: string;
  /** Selectable text root inside children; defaults to the Markdown body. */
  textRootSelector?: string;
  annotations: readonly ReaderUnderline[];
  /** Turn off mutations while a source is new, dirty, or being saved. */
  enabled?: boolean;
  availableNotes?: readonly ReaderNoteOption[];
  onAdd: (anchor: ReaderUnderlineAnchor, color: string) => void | Promise<void>;
  onRecolor: (id: number, color: string) => void | Promise<void>;
  onRemove: (id: number) => void | Promise<void>;
  onCreateNote: (id: number) => void | Promise<void>;
  onLinkNote: (id: number, noteId: number) => void | Promise<void>;
  onEditNote: (noteId: number) => void | Promise<void>;
  children: ReactNode;
}

const COLORS = [
  { key: "yellow", label: "Yellow", value: "#e5ac00" },
  { key: "orange", label: "Orange", value: "#e46d25" },
  { key: "pink", label: "Pink", value: "#d64186" },
  { key: "green", label: "Green", value: "#288353" },
  { key: "blue", label: "Blue", value: "#386bd6" },
] as const;

type UnderlineColor = (typeof COLORS)[number];

interface PositionedUnderline {
  annotation: ReaderUnderline;
  range: Range;
}

interface FallbackLine {
  key: string;
  left: number;
  top: number;
  width: number;
  color: string;
}

function paletteColor(color: string): UnderlineColor {
  return COLORS.find((option) => option.key === color) ?? COLORS[0];
}

function sameIds(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function rangeFromTextPosition(root: HTMLElement, position: ReaderTextPosition): Range | null {
  const walker = root.ownerDocument.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  let cursor = 0;
  let start: { node: Text; offset: number } | null = null;
  let end: { node: Text; offset: number } | null = null;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const next = cursor + node.data.length;
    if (start === null && position.start >= cursor && position.start <= next) {
      start = { node, offset: position.start - cursor };
    }
    if (end === null && position.end >= cursor && position.end <= next) {
      end = { node, offset: position.end - cursor };
    }
    if (start !== null && end !== null) break;
    cursor = next;
  }
  if (start === null || end === null) return null;
  const range = root.ownerDocument.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}

function selectedAnchor(root: HTMLElement): ReaderUnderlineAnchor | null {
  const selection = root.ownerDocument.getSelection();
  if (selection === null || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const selected = selection.getRangeAt(0);
  if (!root.contains(selected.startContainer) || !root.contains(selected.endContainer)) {
    return null;
  }
  const before = root.ownerDocument.createRange();
  before.setStart(root, 0);
  before.setEnd(selected.startContainer, selected.startOffset);
  const text = root.textContent ?? "";
  const start = before.toString().length;
  const end = start + selected.toString().length;
  if (text.slice(start, end) !== selected.toString()) return null;
  return captureReaderUnderlineAnchor(text, start, end);
}

function fallbackLinesFor(
  container: HTMLElement,
  positioned: readonly PositionedUnderline[],
): FallbackLine[] {
  const origin = container.getBoundingClientRect();
  const lines: FallbackLine[] = [];
  for (const { annotation, range } of positioned) {
    for (const [index, rect] of Array.from(range.getClientRects()).entries()) {
      if (rect.width <= 0 || rect.height <= 0) continue;
      lines.push({
        key: `${annotation.id}:${index}`,
        left: rect.left - origin.left,
        top: rect.bottom - origin.top - 2,
        width: rect.width,
        color: paletteColor(annotation.color).value,
      });
    }
  }
  return lines;
}

type ReaderAnnotationCommand = "underlineSelection" | "removeUnderline";

/** Portals keep React context, but keyboard events stay in the popup's window. */
export function subscribeDetachedReaderAnnotationShortcuts(
  root: HTMLElement,
  sourceWindow: Window,
  bindings: Pick<ShortcutBindings, ReaderAnnotationCommand>,
  execute: (command: ReaderAnnotationCommand, document: Document) => boolean = executeShortcutCommand,
): () => void {
  const doc = root.ownerDocument;
  const view = doc.defaultView;
  if (view === null || view === sourceWindow) return () => undefined;

  const editableSelector = "input:not([type='hidden']), textarea, select, [contenteditable]:not([contenteditable='false'])";
  const isEditable = (element: Element | null) => {
    const editable = element?.closest(editableSelector);
    return editable !== null && editable !== undefined &&
      !editable.matches(":disabled") && editable.closest("[inert], [aria-disabled='true']") === null;
  };
  const onKeyDown = (event: KeyboardEvent) => {
    // Avoid instanceof checks against the opener's constructors across realms.
    const target = event.target as Element | null;
    const editable = isEditable(target?.nodeType === 1 ? target : null) || isEditable(doc.activeElement);
    const desktop = (view as Window & { __BABEL_DESKTOP__?: boolean }).__BABEL_DESKTOP__ === true;
    for (const command of ["underlineSelection", "removeUnderline"] as const) {
      if (handleShortcutKeyDown(event, command, bindings[command], editable, desktop,
        () => execute(command, doc))) return;
    }
  };
  view.addEventListener("keydown", onKeyDown);
  return () => view.removeEventListener("keydown", onKeyDown);
}

/** Adds reader-only underlines without rewriting Markdown or React's rendered nodes. */
export function ReaderAnnotationLayer({
  fieldKey,
  textRootSelector = ".markdown-body",
  annotations,
  enabled = true,
  availableNotes = [],
  onAdd,
  onRecolor,
  onRemove,
  onCreateNote,
  onLinkNote,
  onEditNote,
  children,
}: ReaderAnnotationLayerProps) {
  const instanceId = useId().replace(/[^a-zA-Z0-9_-]/gu, "");
  const registryPrefix = `babel-reader-underline-${instanceId}`;
  const underlineBinding = useShortcutBinding("underlineSelection");
  const removeBinding = useShortcutBinding("removeUnderline");
  const shortcutDocument = useShortcutDocument();
  const bodyContainerRef = useRef<HTMLDivElement>(null);
  const pickerInputRef = useRef<HTMLInputElement>(null);
  const positionedRef = useRef<PositionedUnderline[]>([]);
  const [selected, setSelected] = useState<ReaderUnderlineAnchor | null>(null);
  const [readerText, setReaderText] = useState("");
  const [shortcutColor, setShortcutColor] = useState<UnderlineColor["key"]>("yellow");
  const [activeId, setActiveId] = useState<number | null>(null);
  const [linkingId, setLinkingId] = useState<number | null>(null);
  const [noteQuery, setNoteQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [unlocatedIds, setUnlocatedIds] = useState<number[]>([]);
  const [fallbackLines, setFallbackLines] = useState<FallbackLine[]>([]);
  const fieldAnnotations = useMemo(
    () => annotations.filter((annotation) => annotation.fieldKey === fieldKey),
    [annotations, fieldKey],
  );
  const active = fieldAnnotations.find((annotation) => annotation.id === activeId) ?? null;
  const removalId = resolveReaderUnderlineRemovalId(readerText, fieldAnnotations, selected, activeId);
  const pickerNotes = useMemo(() => {
    if (active === null) return [];
    const linked = new Set(active.noteIds);
    const query = noteQuery.trim().toLocaleLowerCase();
    return availableNotes.filter((note) =>
      !linked.has(note.id) && (query === "" || note.title.toLocaleLowerCase().includes(query))
    ).slice(0, 30);
  }, [active, availableNotes, noteQuery]);
  const noteTitles = useMemo(
    () => new Map(availableNotes.map((note) => [note.id, note.title])),
    [availableNotes],
  );

  useEffect(() => {
    const root = bodyContainerRef.current;
    if (root === null || root.ownerDocument === shortcutDocument) return;
    return subscribeDetachedReaderAnnotationShortcuts(root, window, {
      underlineSelection: underlineBinding,
      removeUnderline: removeBinding,
    });
  }, [underlineBinding, removeBinding, shortcutDocument]);

  useEffect(() => {
    if (linkingId !== null) pickerInputRef.current?.focus();
  }, [linkingId]);

  useEffect(() => {
    const root = bodyContainerRef.current?.querySelector<HTMLElement>(textRootSelector);
    if (root === null || root === undefined) return;
    const doc = root.ownerDocument;
    const updateSelection = () => {
      setReaderText(root.textContent ?? "");
      setSelected(selectedAnchor(root));
    };
    doc.addEventListener("selectionchange", updateSelection);
    return () => doc.removeEventListener("selectionchange", updateSelection);
  }, [children, textRootSelector]);

  useLayoutEffect(() => {
    const container = bodyContainerRef.current;
    const root = container?.querySelector<HTMLElement>(textRootSelector);
    if (!container || !root) {
      positionedRef.current = [];
      const unlocated = fieldAnnotations.map((annotation) => annotation.id);
      setUnlocatedIds((current) => sameIds(current, unlocated) ? current : unlocated);
      setFallbackLines((current) => current.length === 0 ? current : []);
      return;
    }

    const view = root.ownerDocument.defaultView;
    const registry = (view as (Window & { CSS?: typeof CSS }) | null)?.CSS?.highlights;
    const HighlightConstructor = (view as (Window & { Highlight?: typeof Highlight }) | null)?.Highlight;
    let frame = 0;
    let disposed = false;

    const refresh = () => {
      if (disposed) return;
      const text = root.textContent ?? "";
      setReaderText((current) => current === text ? current : text);
      const positioned: PositionedUnderline[] = [];
      const unlocated: number[] = [];
      for (const annotation of fieldAnnotations) {
        const position = resolveReaderUnderlineAnchor(text, annotation.anchor);
        const range = position === null ? null : rangeFromTextPosition(root, position);
        if (range === null) unlocated.push(annotation.id);
        else positioned.push({ annotation, range });
      }
      positionedRef.current = positioned;
      setUnlocatedIds((current) => sameIds(current, unlocated) ? current : unlocated);

      if (registry && HighlightConstructor) {
        for (const color of COLORS) {
          const ranges = positioned
            .filter(({ annotation }) => paletteColor(annotation.color).key === color.key)
            .map(({ range }) => range);
          if (ranges.length > 0) {
            const highlight = new HighlightConstructor(...ranges);
            highlight.type = "highlight";
            registry.set(`${registryPrefix}-${color.key}`, highlight);
          } else {
            registry.delete(`${registryPrefix}-${color.key}`);
          }
        }
        setFallbackLines((current) => current.length === 0 ? current : []);
      } else {
        setFallbackLines(fallbackLinesFor(container, positioned));
      }
    };

    const scheduleRefresh = () => {
      if (view === null || frame !== 0) return;
      frame = view.requestAnimationFrame(() => {
        frame = 0;
        refresh();
      });
    };
    refresh();
    const observer = view === null ? null : new view.MutationObserver(scheduleRefresh);
    observer?.observe(root, { childList: true, characterData: true, subtree: true });
    const resizeObserver = view === null ? null : new view.ResizeObserver(scheduleRefresh);
    resizeObserver?.observe(root);
    view?.addEventListener("resize", scheduleRefresh);
    return () => {
      disposed = true;
      observer?.disconnect();
      resizeObserver?.disconnect();
      view?.removeEventListener("resize", scheduleRefresh);
      if (frame !== 0) view?.cancelAnimationFrame(frame);
      for (const color of COLORS) registry?.delete(`${registryPrefix}-${color.key}`);
    };
  }, [children, fieldAnnotations, registryPrefix, textRootSelector]);

  const runAction = useCallback(async (action: () => void | Promise<void>, onSuccess?: () => void) => {
    if (!enabled || busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
      onSuccess?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The underline could not be saved.");
    } finally {
      setBusy(false);
    }
  }, [busy, enabled]);

  const addUnderline = useCallback((anchor: ReaderUnderlineAnchor, color: UnderlineColor["key"]) => {
    void runAction(
      () => onAdd(anchor, color),
      () => {
        setShortcutColor(color);
        setSelected(null);
        bodyContainerRef.current?.ownerDocument.getSelection()?.removeAllRanges();
      },
    );
  }, [onAdd, runAction]);

  const removeUnderline = useCallback((id: number) => {
    void runAction(() => onRemove(id), () => {
      setActiveId((current) => current === id ? null : current);
      setSelected(null);
      bodyContainerRef.current?.ownerDocument.getSelection()?.removeAllRanges();
    });
  }, [onRemove, runAction]);

  function selectExistingLine(event: ReactMouseEvent<HTMLDivElement>) {
    const target = event.target;
    if (target === null || (target as Node).nodeType !== 1 ||
      (target as Element).closest("a, button, input, select, label")) return;
    const selection = event.currentTarget.ownerDocument.getSelection();
    if (selection !== null && !selection.isCollapsed) return;
    const hit = positionedRef.current.find(({ range }) =>
      Array.from(range.getClientRects()).some((rect) =>
        event.clientX >= rect.left - 2 && event.clientX <= rect.right + 2 &&
        event.clientY >= rect.top - 3 && event.clientY <= rect.bottom + 3,
      )
    );
    if (hit) {
      setActiveId(hit.annotation.id);
      setLinkingId(null);
      setSelected(null);
    }
  }

  const highlightStyles = COLORS.map((color) => `
    ::highlight(${registryPrefix}-${color.key}) {
      text-decoration-line: underline;
      text-decoration-color: ${color.value};
      text-decoration-thickness: 0.16em;
      text-underline-offset: 0.14em;
    }
  `).join("\n");

  return (
    <div className="babel-reader-annotations">
      <style>{highlightStyles}</style>
      <div className="babel-reader-annotations__toolbar" aria-label="Reading underlines">
        {enabled && selected !== null ? (
          <button hidden type="button" data-babel-command-adapter=""
            data-babel-command="underlineSelection" disabled={busy}
            onClick={() => {
              const root = bodyContainerRef.current?.querySelector<HTMLElement>(textRootSelector);
              const anchor = root ? selectedAnchor(root) : null;
              if (anchor !== null) addUnderline(anchor, shortcutColor);
            }} />
        ) : null}
        {enabled && removalId !== null ? (
          <button hidden type="button" data-babel-command-adapter=""
            data-babel-command="removeUnderline" disabled={busy}
            onClick={() => removeUnderline(removalId)} />
        ) : null}
        {enabled ? (
          selected === null ? (
            <span className="babel-reader-annotations__hint">
              Select text to underline. {underlineBinding === null
                ? "Choose a color."
                : `${underlineBinding} uses ${paletteColor(shortcutColor).label}.`}
            </span>
          ) : (
            <div className="babel-reader-annotations__palette" role="group" aria-label="Underline selected text">
              <span>Underline selection{underlineBinding === null
                ? ":"
                : ` (${underlineBinding}: ${paletteColor(shortcutColor).label}):`}</span>
              {COLORS.map((color) => (
                <button
                  key={color.key}
                  type="button"
                  className="babel-reader-annotations__color"
                  style={{ "--underline-color": color.value } as CSSProperties}
                  aria-label={`${color.label} underline`}
                  title={`${color.label} underline`}
                  disabled={busy}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => addUnderline(selected, color.key)}
                >
                  <span aria-hidden="true">A</span>
                </button>
              ))}
              {removalId !== null ? (
                <span className="babel-reader-annotations__actions">
                  <button type="button" disabled={busy}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => removeUnderline(removalId)}>Remove underline</button>
                </span>
              ) : null}
            </div>
          )
        ) : (
          <span className="babel-reader-annotations__hint">Save the source before adding or changing underlines.</span>
        )}

        {active !== null ? (
          <div className="babel-reader-annotations__active" aria-label="Selected underline">
            <strong>“{active.anchor.exact}”</strong>
            <div className="babel-reader-annotations__palette" role="group" aria-label="Change underline color">
              {COLORS.map((color) => (
                <button
                  key={color.key}
                  type="button"
                  className="babel-reader-annotations__color"
                  style={{ "--underline-color": color.value } as CSSProperties}
                  aria-label={`Change to ${color.label}`}
                  aria-pressed={paletteColor(active.color).key === color.key}
                  title={`Change to ${color.label}`}
                  disabled={!enabled || busy}
                  onClick={() => void runAction(
                    () => onRecolor(active.id, color.key),
                    () => setShortcutColor(color.key),
                  )}
                >
                  <span aria-hidden="true">A</span>
                </button>
              ))}
            </div>
            <div className="babel-reader-annotations__actions">
              <button type="button" disabled={!enabled || busy}
                onClick={() => void runAction(() => onCreateNote(active.id))}>New note</button>
              <button type="button" disabled={!enabled || busy || availableNotes.length === 0}
                onClick={() => {
                  setLinkingId((current) => current === active.id ? null : active.id);
                  setNoteQuery("");
                }}>Link existing note</button>
              <button type="button" disabled={!enabled || busy}
                title={removeBinding === null ? "Remove line" : `Remove line (${removeBinding})`}
                onClick={() => removeUnderline(active.id)}>Remove line</button>
            </div>
            {active.noteIds.length > 0 ? (
              <div className="babel-reader-annotations__linked" aria-label="Linked notes">
                {active.noteIds.map((noteId) => (
                  <button key={noteId} type="button" disabled={!enabled || busy}
                    onClick={() => void runAction(() => onEditNote(noteId))}>
                    Edit {noteTitles.get(noteId) ?? `note #${noteId}`}
                  </button>
                ))}
              </div>
            ) : null}
            {linkingId === active.id ? (
              <div className="babel-reader-annotations__picker">
                <label htmlFor={`${registryPrefix}-note-search`}>Find a note to link</label>
                <input
                  ref={pickerInputRef}
                  id={`${registryPrefix}-note-search`}
                  type="search"
                  value={noteQuery}
                  onChange={(event) => setNoteQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setLinkingId(null);
                  }}
                />
                <ul>
                  {pickerNotes.map((note) => (
                    <li key={note.id}>
                      <button type="button" disabled={!enabled || busy}
                        onClick={() => void runAction(
                          () => onLinkNote(active.id, note.id),
                          () => setLinkingId(null),
                        )}>{note.title}</button>
                    </li>
                  ))}
                </ul>
                {pickerNotes.length === 0 ? <p>No matching unlinked notes.</p> : null}
                <button type="button" onClick={() => setLinkingId(null)}>Cancel</button>
              </div>
            ) : null}
          </div>
        ) : null}
        {error ? <p role="alert" className="babel-reader-annotations__error">{error}</p> : null}
      </div>

      <div ref={bodyContainerRef} className="babel-reader-annotations__body" onClick={selectExistingLine}>
        {children}
        {fallbackLines.length > 0 ? (
          <div className="babel-reader-annotations__fallback" aria-hidden="true">
            {fallbackLines.map((line) => (
              <span key={line.key} style={{
                left: line.left,
                top: line.top,
                width: line.width,
                borderColor: line.color,
              }} />
            ))}
          </div>
        ) : null}
      </div>

      {fieldAnnotations.length > 0 ? (
        <details className="babel-reader-annotations__list">
          <summary>Underlines ({fieldAnnotations.length})</summary>
          <ol>
            {fieldAnnotations.map((annotation) => (
              <li key={annotation.id}>
                <button type="button" className="babel-reader-annotations__entry"
                  aria-pressed={activeId === annotation.id}
                  onClick={() => {
                    setActiveId(annotation.id);
                    setLinkingId(null);
                  }}>
                  <span className="babel-reader-annotations__entry-swatch"
                    style={{ borderColor: paletteColor(annotation.color).value }} aria-hidden="true" />
                  <span>“{annotation.anchor.exact}”</span>
                  {unlocatedIds.includes(annotation.id) ? <small>Text changed; line could not be located</small> : null}
                  {annotation.noteIds.length > 0 ? <small>{annotation.noteIds.length} linked note{annotation.noteIds.length === 1 ? "" : "s"}</small> : null}
                </button>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </div>
  );
}
