"use client";

import React, {
  type ChangeEvent,
  createContext,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type SyntheticEvent,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  DEFAULT_SHORTCUT_SETTINGS,
  isDesktopOnlyShortcutBinding,
  isShortcutBindingAvailable,
  matchesShortcutBinding,
  parseShortcutSequence,
  parseShortcutSettings,
  resolveShortcutBindings,
  SHORTCUT_DEFINITIONS,
  shouldIgnoreShortcutEvent,
  type ShortcutCommand,
  type ShortcutBindings,
  type ShortcutKeyboardEventLike,
  type ShortcutSettings,
  type ShortcutMode,
  type ParsedShortcutBinding,
} from "./core";
import { focusModeContent, focusNotebookList, getKeyboardContext, isKeyboardInput, type KeyboardContext } from "./context";
import { PaneFocusProvider } from "../navigation/react";
import { useWorkspaceProcessActive } from "../pages/react";

export interface ShortcutProviderProps {
  readonly children: ReactNode;
  readonly endpoint?: string;
  readonly ownerDocument?: Document;
  readonly fixedMode?: ShortcutMode;
  readonly onReturnToApp?: () => void;
  readonly onEditSource?: () => boolean;
  readonly onReadSource?: () => boolean;
}

export interface CommandPaletteAction {
  readonly id: string;
  readonly label: string;
  readonly keywords?: readonly string[];
  readonly group?: string;
  readonly binding?: string;
  readonly available?: boolean;
  readonly run: () => boolean | void | Promise<boolean | void>;
}

export interface CommandPaletteItem {
  readonly id: string;
  readonly dedupeKey?: string;
  readonly label: string;
  readonly description?: string;
  readonly keywords?: readonly string[];
  readonly open: () => boolean | void | Promise<boolean | void>;
  readonly edit?: () => boolean | void | Promise<boolean | void>;
}

export interface CommandPaletteItemSource {
  readonly id: string;
  readonly label: string;
  readonly items: readonly CommandPaletteItem[];
  readonly scope?: "workspace" | "global";
  readonly searchItems?: (
    query: string,
    signal: AbortSignal,
  ) => Promise<readonly CommandPaletteItem[]>;
}

interface ShortcutKeyDownEventLike extends ShortcutKeyboardEventLike {
  preventDefault(): void;
  stopPropagation(): void;
}

const SEQUENCE_TIMEOUT_MS = 1500;
interface PendingShortcutSequence {
  candidates: { command: ShortcutCommand; label: string; steps: ParsedShortcutBinding[] }[];
  index: number;
  prefix: string;
  expiresAt: number;
  settings: ShortcutSettings;
  mode: ShortcutMode;
  focus: Element | null;
  dialog: HTMLDialogElement | null;
  page: Element | null;
}

function ShortcutSequenceHint({ text }: { text: string }) {
  return text ? <span className="babel-shortcut-sequence" data-babel-shortcut-sequence=""
    role="status" aria-live="polite" aria-atomic="true">{text}</span> : null;
}

interface PaletteRegistrationContextValue {
  registerActions(sourceId: string, actions: readonly CommandPaletteAction[]): () => void;
  registerItemSource(source: CommandPaletteItemSource): () => void;
}

interface RegisteredValue<T> {
  readonly token: symbol;
  readonly value: T;
}

interface ItemSourceSearchState {
  readonly items: readonly CommandPaletteItem[];
  readonly pending: boolean;
  readonly query: string;
  readonly token: symbol;
}

type PaletteMode = "universal" | "items";
type PaletteResultKind = "command" | "action" | "item";

interface PaletteResult {
  readonly key: string;
  readonly kind: PaletteResultKind;
  readonly label: string;
  readonly description: string;
  readonly binding?: string | null;
  readonly available: boolean;
  readonly command?: ShortcutCommand;
  readonly run?: () => boolean | void | Promise<boolean | void>;
}

const PaletteRegistrationContext = createContext<PaletteRegistrationContextValue | null>(null);
const ShortcutBindingsContext = createContext<ShortcutBindings>(DEFAULT_SHORTCUT_SETTINGS.bindings);
const ShortcutSettingsContext = createContext<ShortcutSettings>(DEFAULT_SHORTCUT_SETTINGS);
const ShortcutDocumentContext = createContext<Document | null>(null);

export function useShortcutDocument(): Document | null {
  return useContext(ShortcutDocumentContext);
}

const EDITABLE_SELECTOR = [
  "input:not([type='hidden'])",
  "textarea",
  "select",
  "[contenteditable]:not([contenteditable='false'])",
].join(",");
const SEARCHABLE_SELECTOR = [
  "input:not([type])",
  "input[type='text']",
  "input[type='search']",
  "textarea",
  "[contenteditable]:not([contenteditable='false'])",
].join(",");
const CONTEXT_SELECTOR = "[data-babel-shortcut-context], dialog, form";
const INTERNAL_COMMANDS = new Set<ShortcutCommand>([
  "commandPalette",
  "quickOpen",
  "help",
]);
const PALETTE_RESULT_LIMIT = 100;

function isVisible(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest("[hidden], [inert], [aria-hidden='true']")) {
    return false;
  }

  const style = element.ownerDocument.defaultView!.getComputedStyle(element);
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    element.getClientRects().length > 0
  );
}

function isEnabled(element: HTMLElement): boolean {
  return (
    !element.matches(":disabled") &&
    element.closest("[inert], [aria-disabled='true']") === null
  );
}

function isEditable(element: Element | null): element is HTMLElement {
  return element !== null && element.nodeType === 1 && element.matches(EDITABLE_SELECTOR) && isEnabled(element as HTMLElement);
}

function getActiveDialog(document: Document): HTMLDialogElement | null {
  const focusedDialog = document.activeElement?.closest<HTMLDialogElement>("dialog[open]");
  if (focusedDialog !== undefined && focusedDialog !== null) return focusedDialog;

  const openDialogs = document.querySelectorAll<HTMLDialogElement>("dialog[open]");
  return openDialogs.length === 0 ? null : openDialogs[openDialogs.length - 1] ?? null;
}

function parsePriority(element: HTMLElement): number {
  const priority = Number(element.dataset.babelPriority ?? "0");
  return Number.isFinite(priority) ? priority : 0;
}

function isCommandAdapterCandidate(element: HTMLElement): boolean {
  if (!element.hasAttribute("data-babel-command-adapter")) return isVisible(element);
  if (!element.hidden) return isVisible(element);
  if (
    !element.isConnected ||
    element.parentElement?.closest("[hidden], [inert], [aria-hidden='true']") !== null
  ) return false;
  for (
    let ancestor: HTMLElement | null = element.parentElement;
    ancestor !== null;
    ancestor = ancestor.parentElement
  ) {
    const style = ancestor.ownerDocument.defaultView!.getComputedStyle(ancestor);
    if (style.display === "none" || style.visibility === "hidden") return false;
  }
  return true;
}

export function findShortcutCommandTarget(
  command: ShortcutCommand,
  document: Document = window.document,
): HTMLElement | null {
  const visibleCandidates = Array.from(
    document.querySelectorAll<HTMLElement>(`[data-babel-command="${command}"]`),
  ).filter((element) => isCommandAdapterCandidate(element) && isEnabled(element));
  const activeDialog = getActiveDialog(document);
  const candidates =
    activeDialog === null
      ? visibleCandidates
      : visibleCandidates.filter((element) => activeDialog.contains(element));
  if (candidates.length === 0) return null;

  const activeElement = document.activeElement;
  const activeContext = isEditable(activeElement)
    ? activeElement.closest<HTMLElement>(CONTEXT_SELECTOR)
    : null;

  return (
    candidates
      .map((element, index) => ({
        element,
        index,
        inActiveDialog:
          activeDialog !== null && element.closest("dialog[open]") === activeDialog ? 1 : 0,
        inActiveContext:
          activeContext !== null && element.closest(CONTEXT_SELECTOR) === activeContext ? 1 : 0,
        priority: parsePriority(element),
      }))
      .sort(
        (left, right) =>
          right.inActiveDialog - left.inActiveDialog ||
          right.inActiveContext - left.inActiveContext ||
          right.priority - left.priority ||
          left.index - right.index,
      )[0]?.element ?? null
  );
}

function findSearchTarget(adapter: HTMLElement): HTMLElement | null {
  const target = adapter.matches(SEARCHABLE_SELECTOR)
    ? adapter
    : adapter.querySelector<HTMLElement>(SEARCHABLE_SELECTOR);
  return target !== null && isVisible(target) && isEnabled(target) ? target : null;
}

function selectEditableText(element: HTMLElement): void {
  const selectable = element as HTMLElement & { select?: () => void };
  if (typeof selectable.select === "function") {
    selectable.select();
    return;
  }

  if (element.isContentEditable) {
    const selection = element.ownerDocument.getSelection();
    const range = element.ownerDocument.createRange();
    range.selectNodeContents(element);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
}

export function executeShortcutCommand(
  command: ShortcutCommand,
  document: Document = window.document,
): boolean {
  if (INTERNAL_COMMANDS.has(command)) return false;

  const adapter = findShortcutCommandTarget(command, document);
  if (adapter === null) return false;

  try {
    // Move focus out of the navigation/mode controls before changing a page's
    // form state. If Edit opens a detached window, that window keeps focus.
    if (command === "edit" || command === "read") adapter.focus({ preventScroll: true });
    if (command === "search") {
      const searchTarget = findSearchTarget(adapter);
      if (searchTarget === null) return false;
      searchTarget.focus();
      selectEditableText(searchTarget);
      return true;
    }

    if (adapter.tagName === "FORM") {
      (adapter as HTMLFormElement).requestSubmit();
    } else {
      adapter.click();
    }
    return true;
  } catch {
    return false;
  }
}

/** A reader can belong to a background page; activate that page before editing. */
export function executeShortcutSourceCommand(anchor: HTMLElement | null, command: ShortcutMode): boolean {
  if (anchor === null || !anchor.isConnected) return false;
  const document = anchor.ownerDocument;
  const view = document.defaultView;
  if (view === null) return false;
  const page = anchor.closest<HTMLElement>("[data-page-key]");
  if (page !== null && page.hidden) {
    const tab = Array.from(document.querySelectorAll<HTMLElement>("[role='tab'][aria-controls]"))
      .find(candidate => candidate.getAttribute("aria-controls") === page.id);
    if (tab === undefined) return false;
    tab.click();
  }
  view.focus();
  view.requestAnimationFrame(() => {
    if (!anchor.isConnected || anchor.closest("[hidden], [inert], [aria-hidden='true']")) return;
    if (command === "app") { focusNotebookList(document); return; }
    const container = page ?? anchor.closest<HTMLElement>("[data-babel-pane='detail']");
    const adapter = container === null ? undefined : Array.from(container.querySelectorAll<HTMLElement>(`[data-babel-command='${command}']`))
      .find(candidate => isCommandAdapterCandidate(candidate) && isEnabled(candidate));
    if (adapter !== undefined) adapter.click();
    else focusModeContent(document, command);
  });
  return true;
}

function closeDialogWithCancelEvent(dialog: HTMLDialogElement): void {
  const EventConstructor = dialog.ownerDocument.defaultView?.Event ?? Event;
  const cancelEvent = new EventConstructor("cancel", { cancelable: true });
  if (dialog.dispatchEvent(cancelEvent) && dialog.open) dialog.close();
}

function findEscapeTarget(document: Document): HTMLElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLElement>("[data-babel-escape]"))
      .filter((element) => isVisible(element) && isEnabled(element))
      .map((element, index) => ({
        element,
        index,
        level: element.dataset.babelEscape === "overlay" ? 1 : 0,
        priority: parsePriority(element),
      }))
      .sort(
        (left, right) =>
          right.level - left.level ||
          right.priority - left.priority ||
          right.index - left.index,
      )[0]?.element ?? null
  );
}

export function executeCancelLadder(document: Document = window.document): boolean {
  const activeDialog = getActiveDialog(document);
  if (activeDialog !== null) {
    const dialogCancel = findShortcutCommandTarget("cancel", document);
    if (dialogCancel !== null) dialogCancel.click();
    else closeDialogWithCancelEvent(activeDialog);
    return true;
  }

  const escapeTarget = findEscapeTarget(document);
  if (escapeTarget?.dataset.babelEscape === "overlay") {
    escapeTarget.click();
    return true;
  }

  const cancel = findShortcutCommandTarget("cancel", document);
  if (cancel !== null) {
    cancel.click();
    return true;
  }

  if (escapeTarget === null) return false;
  escapeTarget.click();
  return true;
}

function commandIsAvailable(command: ShortcutCommand, document: Document): boolean {
  if (INTERNAL_COMMANDS.has(command)) return true;
  if (command === "cancel") {
    return getActiveDialog(document) !== null ||
      findShortcutCommandTarget(command, document) !== null ||
      findEscapeTarget(document) !== null;
  }
  const adapter = findShortcutCommandTarget(command, document);
  if (adapter === null) return false;
  return command !== "search" || findSearchTarget(adapter) !== null;
}

function getAvailabilitySnapshot(document: Document): Record<ShortcutCommand, boolean> {
  return Object.fromEntries(
    SHORTCUT_DEFINITIONS.map(({ command }) => [command, commandIsAvailable(command, document)]),
  ) as Record<ShortcutCommand, boolean>;
}

function getInitialAvailability(): Record<ShortcutCommand, boolean> {
  return Object.fromEntries(
    SHORTCUT_DEFINITIONS.map(({ command }) => [command, INTERNAL_COMMANDS.has(command)]),
  ) as Record<ShortcutCommand, boolean>;
}

function normalizedSearchText(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}

function matchesQuery(query: string, values: readonly (string | undefined)[]): boolean {
  const tokens = normalizedSearchText(query).split(/\s+/u).filter(Boolean);
  if (tokens.length === 0) return true;
  const text = normalizedSearchText(values.filter(Boolean).join(" "));
  return tokens.every((token) => text.includes(token));
}

export function commandAllowedFromEditable(
  command: ShortcutCommand,
  editable: boolean,
): boolean {
  return !editable || (command !== "new" && command !== "edit" && command !== "delete" &&
    command !== "underlineSelection" && command !== "removeUnderline");
}

export function useShortcutBinding(command: ShortcutCommand): string | null {
  return useContext(ShortcutBindingsContext)[command];
}

function withoutKeyRepeat(event: ShortcutKeyboardEventLike): ShortcutKeyboardEventLike {
  return {
    key: event.key,
    code: event.code,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    metaKey: event.metaKey,
    isComposing: event.isComposing,
    keyCode: event.keyCode,
    repeat: false,
    defaultPrevented: event.defaultPrevented,
    getModifierState: (keyArg) => event.getModifierState?.(keyArg) ?? false,
  };
}

function isNativeEditingKey(event: ShortcutKeyboardEventLike): boolean {
  return event.ctrlKey === true && event.altKey !== true && (
    /^[acvxyz]$/iu.test(event.key) ||
    ["Backspace", "Delete", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)
  );
}

export function handleShortcutKeyDown(
  event: ShortcutKeyDownEventLike,
  command: ShortcutCommand,
  binding: string | null,
  editable: boolean,
  desktop: boolean,
  execute: () => boolean,
  reserve = desktop,
): boolean {
  if (!isShortcutBindingAvailable(binding, desktop)) return false;
  if (!matchesShortcutBinding(withoutKeyRepeat(event), binding)) return false;
  const textKey = !event.ctrlKey && !event.altKey && event.key !== "Escape" && !/^F\d+$/u.test(event.key);
  if (!commandAllowedFromEditable(command, editable) || (editable && (textKey || isNativeEditingKey(event)))) {
    return false;
  }
  if (event.repeat === true && !reserve && command !== "read") return false;

  const handled = event.repeat !== true && execute();
  if (!handled && !reserve && command !== "read") return false;
  event.preventDefault();
  event.stopPropagation();
  return true;
}

export function handleReadShortcutKeyDown(
  event: ShortcutKeyDownEventLike,
  binding: string | null,
  editable: boolean,
  execute: () => boolean,
): boolean {
  return handleShortcutKeyDown(event, "read", binding, editable, false, execute);
}

export function subscribeShortcutSettings(
  endpoint: string,
  eventTarget: EventTarget,
  onSettings: (settings: ShortcutSettings) => void,
  fetchSettings: typeof fetch = fetch,
): () => void {
  let controller: AbortController | null = null;
  const refresh = () => {
    controller?.abort();
    const request = new AbortController();
    controller = request;
    void fetchSettings(endpoint, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: request.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Shortcut settings request failed: ${response.status}.`);
        return response.json() as Promise<unknown>;
      })
      .then((document) => {
        if (!request.signal.aborted) onSettings(parseShortcutSettings(document));
      })
      .catch(() => undefined);
  };
  eventTarget.addEventListener("babel:shortcuts-changed", refresh);
  refresh();
  return () => {
    eventTarget.removeEventListener("babel:shortcuts-changed", refresh);
    controller?.abort();
  };
}

function eventComesFromEditable(event: KeyboardEvent, document: Document): boolean {
  const target = event.target as Element | null;
  return isKeyboardInput(target?.nodeType === 1 ? target : null) || isKeyboardInput(document.activeElement);
}

function useKeyboardContext(document: Document | undefined, fixedMode?: ShortcutMode): KeyboardContext {
  const [context, setContext] = useState<KeyboardContext>({ mode: fixedMode ?? "app", focus: "APP", input: false });
  useEffect(() => {
    const view = document?.defaultView;
    if (!document || !view) return;
    let frame = 0;
    let disposed = false;
    const update = () => {
      if (disposed) return;
      const next = getKeyboardContext(document, fixedMode);
      setContext(previous => previous.mode === next.mode && previous.focus === next.focus && previous.input === next.input
        ? previous : next);
    };
    const schedule = () => {
      if (frame !== 0) return;
      frame = view.requestAnimationFrame(() => { frame = 0; update(); });
    };
    const observer = new view.MutationObserver(schedule);
    // A background WebView can change activeElement without focusin. Recheck
    // when it regains focus and after command clicks have changed focus/state.
    const afterClick = () => view.queueMicrotask(update);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true,
      attributeFilter: ["hidden", "inert", "aria-hidden", "data-babel-mode", "data-active", "disabled", "class"] });
    document.addEventListener("focusin", update, true);
    document.addEventListener("click", afterClick);
    view.addEventListener("focus", update);
    schedule();
    return () => {
      disposed = true;
      observer.disconnect();
      document.removeEventListener("focusin", update, true);
      document.removeEventListener("click", afterClick);
      view.removeEventListener("focus", update);
      view.cancelAnimationFrame(frame);
    };
  }, [document, fixedMode]);
  return context;
}

const MODE_LABELS = { app: "APP", edit: "Edit", read: "Read" } as const;

function KeyboardModeBar({ context, bindings, sequenceHint, onMode, onFocus, onHelp }: {
  context: KeyboardContext;
  bindings: ShortcutBindings;
  sequenceHint: string;
  onMode: (mode: ShortcutMode) => void;
  onFocus: () => void;
  onHelp: () => void;
}) {
  return <aside className="babel-keyboard-status" aria-label="Keyboard controls" data-babel-keyboard-status=""
    data-babel-pane="keyboard" data-babel-mode={context.mode} tabIndex={-1}>
    <span role="status" aria-live="polite"><strong>{MODE_LABELS[context.mode]}</strong> · {context.focus}{context.input ? " · Typing" : ""}</span>
    <ShortcutSequenceHint text={sequenceHint} />
    <div role="group" aria-label="Switch keyboard mode">
      {(["app", "edit", "read"] as const).map(mode => <button key={mode} type="button"
        aria-pressed={context.mode === mode} onMouseDown={event => event.preventDefault()} onClick={() => onMode(mode)}
        title={mode === "app" ? "Focus the document list" : `${MODE_LABELS[mode]} · ${bindings[mode === "edit" ? "edit" : "read"] ?? "Unbound"}`}>
        {mode === "app" ? "Browse" : MODE_LABELS[mode]}
      </button>)}
    </div>
    <button type="button" onMouseDown={event => event.preventDefault()} onClick={onFocus}
      title={`Next pane · ${bindings.focusNextPane ?? "Unbound"}`}>Focus</button>
    <button type="button" onMouseDown={event => event.preventDefault()} onClick={onHelp}
      title={`Keyboard help · ${bindings.help ?? "Unbound"}`}>Keys</button>
  </aside>;
}

function settlePaletteAction(
  action: () => boolean | void | Promise<boolean | void>,
): boolean {
  try {
    const result = action();
    if (result instanceof Promise) void result.catch(() => undefined);
    return result !== false;
  } catch {
    return false;
  }
}

export function useCommandPaletteActions(
  sourceId: string,
  actions: readonly CommandPaletteAction[],
): void {
  const context = useContext(PaletteRegistrationContext);
  const processActive = useWorkspaceProcessActive();
  const actionsRef = useRef(actions);
  const signature = JSON.stringify(actions.map((action) => ({
    id: action.id,
    label: action.label,
    keywords: action.keywords,
    group: action.group,
    binding: action.binding,
    available: action.available !== false,
  })));
  useEffect(() => {
    actionsRef.current = actions;
  });
  const actionMetadata = useMemo(
    () => JSON.parse(signature) as ReadonlyArray<Omit<CommandPaletteAction, "run">>,
    [signature],
  );
  const registeredActions = useMemo<readonly CommandPaletteAction[]>(
    () => actionMetadata.map((metadata) => ({
      ...metadata,
      run: () => actionsRef.current.find((action) => action.id === metadata.id)?.run(),
    })),
    [actionMetadata],
  );
  useEffect(() => {
    if (context === null || !processActive) return undefined;
    return context.registerActions(sourceId, registeredActions);
  }, [context, processActive, registeredActions, sourceId]);
}

export function useCommandPaletteItemSource(source: CommandPaletteItemSource): void {
  const context = useContext(PaletteRegistrationContext);
  const processActive = useWorkspaceProcessActive();
  const sourceRef = useRef(source);
  const signature = JSON.stringify({
    id: source.id,
    label: source.label,
    scope: source.scope ?? "workspace",
    searchable: source.searchItems !== undefined,
    items: source.items.map((item) => ({
      id: item.id,
      dedupeKey: item.dedupeKey,
      label: item.label,
      description: item.description,
      keywords: item.keywords,
      editable: item.edit !== undefined,
    })),
  });
  useEffect(() => {
    sourceRef.current = source;
  });
  const sourceMetadata = useMemo(
    () => JSON.parse(signature) as {
      readonly id: string;
      readonly label: string;
      readonly scope: "workspace" | "global";
      readonly searchable: boolean;
      readonly items: ReadonlyArray<
        Omit<CommandPaletteItem, "open" | "edit"> & { readonly editable: boolean }
      >;
    },
    [signature],
  );
  const registeredSource = useMemo<CommandPaletteItemSource>(() => ({
    id: sourceMetadata.id,
    label: sourceMetadata.label,
    scope: sourceMetadata.scope,
    items: sourceMetadata.items.map((metadata) => ({
      id: metadata.id,
      dedupeKey: metadata.dedupeKey,
      label: metadata.label,
      description: metadata.description,
      keywords: metadata.keywords,
      open: () => sourceRef.current.items.find((item) => item.id === metadata.id)?.open(),
      edit: metadata.editable
        ? () => sourceRef.current.items.find((item) => item.id === metadata.id)?.edit?.()
        : undefined,
    })),
    searchItems: sourceMetadata.searchable
      ? (query, signal) => sourceRef.current.searchItems?.(query, signal) ?? Promise.resolve([])
      : undefined,
  }), [sourceMetadata]);
  useEffect(() => {
    if (
      context === null ||
      (registeredSource.scope !== "global" && !processActive)
    ) return undefined;
    return context.registerItemSource(registeredSource);
  }, [context, processActive, registeredSource]);
}

export function ShortcutProvider({ children, endpoint = "/api/shortcuts", ownerDocument, fixedMode,
  onReturnToApp, onEditSource, onReadSource }: ShortcutProviderProps) {
  const window = ownerDocument?.defaultView ?? globalThis.window;
  const scopeDocument = ownerDocument ?? (typeof window === "undefined" ? undefined : window.document);
  const parentSettings = useContext(ShortcutSettingsContext);
  const [localSettings, setSettings] = useState<ShortcutSettings>(DEFAULT_SHORTCUT_SETTINGS);
  const settings = ownerDocument === undefined ? localSettings : parentSettings;
  const keyboardContext = useKeyboardContext(scopeDocument, fixedMode);
  const bindings = useMemo(() => resolveShortcutBindings(settings, keyboardContext.mode), [settings, keyboardContext.mode]);
  const pendingSequence = useRef<PendingShortcutSequence | null>(null);
  const sequenceTimer = useRef<number | undefined>(undefined);
  const [sequenceHint, setSequenceHint] = useState("");
  const resetSequence = useCallback(() => {
    window.clearTimeout(sequenceTimer.current);
    sequenceTimer.current = undefined;
    if (pendingSequence.current === null) return;
    pendingSequence.current = null;
    setSequenceHint("");
  }, [window]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteMode, setPaletteMode] = useState<PaletteMode>("universal");
  const [helpOpen, setHelpOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<ShortcutMode>(fixedMode ?? "app");
  const [filter, setFilter] = useState("");
  const [selectedResult, setSelectedResult] = useState(0);
  const [availability, setAvailability] = useState(getInitialAvailability);
  const [actionRegistry, setActionRegistry] = useState(
    () => new Map<string, RegisteredValue<readonly CommandPaletteAction[]>>(),
  );
  const [itemSourceRegistry, setItemSourceRegistry] = useState(
    () => new Map<string, RegisteredValue<CommandPaletteItemSource>>(),
  );
  const [itemSourceSearchState, setItemSourceSearchState] = useState(
    () => new Map<string, ItemSourceSearchState>(),
  );
  const dialogRef = useRef<HTMLDialogElement>(null);
  const helpDialogRef = useRef<HTMLDialogElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const searchLabelId = useId();
  const listboxId = useId();
  const helpTitleId = useId();

  const registerActions = useCallback((
    sourceId: string,
    actions: readonly CommandPaletteAction[],
  ): (() => void) => {
    const token = Symbol(sourceId);
    setActionRegistry((current) => {
      const next = new Map(current);
      next.set(sourceId, { token, value: actions });
      return next;
    });
    return () => {
      setActionRegistry((current) => {
        if (current.get(sourceId)?.token !== token) return current;
        const next = new Map(current);
        next.delete(sourceId);
        return next;
      });
    };
  }, []);

  const registerItemSource = useCallback((source: CommandPaletteItemSource): (() => void) => {
    const token = Symbol(source.id);
    setItemSourceRegistry((current) => {
      const next = new Map(current);
      next.set(source.id, { token, value: source });
      return next;
    });
    return () => {
      setItemSourceRegistry((current) => {
        if (current.get(source.id)?.token !== token) return current;
        const next = new Map(current);
        next.delete(source.id);
        return next;
      });
      setItemSourceSearchState((current) => {
        if (current.get(source.id)?.token !== token) return current;
        const next = new Map(current);
        next.delete(source.id);
        return next;
      });
    };
  }, []);

  const registrationContext = useMemo<PaletteRegistrationContextValue>(() => ({
    registerActions,
    registerItemSource,
  }), [registerActions, registerItemSource]);

  const closePalette = (): boolean => {
    const dialog = dialogRef.current;
    if (dialog === null || !dialog.open) return false;
    dialog.close();
    setPaletteOpen(false);
    return true;
  };

  const closeHelp = (): boolean => {
    const dialog = helpDialogRef.current;
    if (dialog === null || !dialog.open) return false;
    dialog.close();
    setHelpOpen(false);
    return true;
  };

  const openPalette = (mode: PaletteMode): boolean => {
    const dialog = dialogRef.current;
    if (dialog === null) return false;
    const activeDialog = getActiveDialog(window.document);
    if (activeDialog !== null && activeDialog !== dialog) return false;
    if (dialog.open) {
      setPaletteMode(mode);
      setFilter("");
      setSelectedResult(0);
      searchRef.current?.focus();
      searchRef.current?.select();
      return true;
    }
    const nextAvailability = getAvailabilitySnapshot(window.document);
    if (onEditSource !== undefined || fixedMode === "edit") nextAvailability.edit = true;
    if (onReadSource !== undefined || fixedMode === "read") nextAvailability.read = true;
    if (onReturnToApp !== undefined || window.document.querySelector("[data-babel-pane='items'], [data-babel-pane='tree'], [data-babel-pane='tabs']")) nextAvailability.cancel = true;
    const contextMode = getKeyboardContext(window.document, fixedMode).mode;
    dialog.dataset.babelMode = contextMode;
    setDialogMode(contextMode);
    try {
      dialog.showModal();
    } catch {
      return false;
    }
    setPaletteMode(mode);
    setFilter("");
    setSelectedResult(0);
    setAvailability(nextAvailability);
    setPaletteOpen(true);
    window.requestAnimationFrame(() => searchRef.current?.focus());
    return true;
  };

  const openHelp = (): boolean => {
    const dialog = helpDialogRef.current;
    if (dialog === null) return false;
    const activeDialog = getActiveDialog(window.document);
    if (activeDialog !== null && activeDialog !== dialog) return false;
    if (dialog.open) {
      dialog.focus();
      return true;
    }
    const mode = getKeyboardContext(window.document, fixedMode).mode;
    dialog.dataset.babelMode = mode;
    setDialogMode(mode);
    try {
      dialog.showModal();
    } catch {
      return false;
    }
    setHelpOpen(true);
    window.requestAnimationFrame(() => dialog.focus());
    return true;
  };

  const executeContextCommand = (command: ShortcutCommand): boolean => {
    if (getActiveDialog(window.document) === null) {
      if (command === "edit" && onEditSource !== undefined) return onEditSource();
      if (command === "read" && onReadSource !== undefined) return onReadSource();
      if ((command === "edit" || command === "read") && command === fixedMode) return focusModeContent(window.document, command);
    }
    if (command === "cancel") {
      if (executeCancelLadder(window.document)) return true;
      if (onReturnToApp !== undefined) { onReturnToApp(); return true; }
      return focusNotebookList(window.document);
    }
    return executeShortcutCommand(command, window.document);
  };

  const changeMode = (mode: ShortcutMode) => {
    if (mode === "app") {
      if (onReturnToApp !== undefined) onReturnToApp();
      else focusNotebookList(window.document);
      return;
    }
    executeContextCommand(mode === "edit" ? "edit" : "read");
  };

  const runPaletteCommand = (command: ShortcutCommand): boolean => {
    if (command === "commandPalette") {
      searchRef.current?.focus();
      return true;
    }
    if (command === "quickOpen") {
      setPaletteMode("items");
      setFilter("");
      setSelectedResult(0);
      searchRef.current?.focus();
      return true;
    }
    if (command === "help") {
      closePalette();
      return openHelp();
    }
    const closed = closePalette();
    const handled = executeContextCommand(command);
    return handled || closed;
  };

  useEffect(() => ownerDocument === undefined
    ? subscribeShortcutSettings(endpoint, window, setSettings) : undefined, [endpoint, ownerDocument, window]);

  useEffect(() => {
    const includeItems = paletteMode === "items" || filter.trim() !== "";
    if (!paletteOpen || !includeItems) return;
    const searchableSources = [...itemSourceRegistry.entries()].filter(
      ([, registration]) => registration.value.searchItems !== undefined,
    );
    if (searchableSources.length === 0) return;

    const query = filter.trim();
    const controllers: AbortController[] = [];
    const timer = window.setTimeout(() => {
      setItemSourceSearchState((current) => {
        const next = new Map(current);
        for (const [sourceId, registration] of searchableSources) {
          next.set(sourceId, {
            items: [],
            pending: true,
            query,
            token: registration.token,
          });
        }
        return next;
      });

      for (const [sourceId, registration] of searchableSources) {
        const controller = new AbortController();
        controllers.push(controller);
        void registration.value.searchItems!(query, controller.signal)
          .then((items) => {
            if (controller.signal.aborted) return;
            setItemSourceSearchState((current) => {
              const existing = current.get(sourceId);
              if (
                existing?.token !== registration.token ||
                existing.query !== query
              ) return current;
              const next = new Map(current);
              next.set(sourceId, {
                items,
                pending: false,
                query,
                token: registration.token,
              });
              return next;
            });
          })
          .catch(() => {
            if (controller.signal.aborted) return;
            setItemSourceSearchState((current) => {
              const existing = current.get(sourceId);
              if (
                existing?.token !== registration.token ||
                existing.query !== query
              ) return current;
              const next = new Map(current);
              next.set(sourceId, { ...existing, pending: false });
              return next;
            });
          });
      }
    }, 120);

    return () => {
      window.clearTimeout(timer);
      for (const controller of controllers) controller.abort();
    };
  }, [filter, itemSourceRegistry, paletteMode, paletteOpen, window]);

  const paletteResults: readonly PaletteResult[] = (() => {
    const results: PaletteResult[] = [];
    if (paletteMode === "universal") {
      for (const definition of SHORTCUT_DEFINITIONS) {
        if (!matchesQuery(filter, [definition.command, definition.label])) continue;
        results.push({
          key: `command:${definition.command}`,
          kind: "command",
          label: definition.label,
          description: isDesktopOnlyShortcutBinding(bindings[definition.command])
            ? "Command · Shortcut requires Babel desktop"
            : "Command",
          binding: bindings[definition.command],
          available: availability[definition.command],
          command: definition.command,
        });
      }

      for (const [sourceId, registration] of actionRegistry) {
        for (const action of registration.value) {
          if (!matchesQuery(filter, [action.id, action.label, action.group, action.binding, ...(action.keywords ?? [])])) {
            continue;
          }
          results.push({
            key: `action:${sourceId}:${action.id}`,
            kind: "action",
            label: action.label,
            description: action.group ?? "Action",
            binding: action.binding,
            available: action.available !== false,
            run: action.run,
          });
        }
      }
      // Scoped editing shortcuts should be visible immediately when their editor is active.
      results.sort((left, right) => Number(right.kind === "action" && right.binding !== undefined) -
        Number(left.kind === "action" && left.binding !== undefined));
    }

    const includeItems = paletteMode === "items" || filter.trim() !== "";
    if (includeItems) {
      const seenItems = new Set<string>();
      const orderedSources = [...itemSourceRegistry.values()].sort((left, right) =>
        Number(left.value.scope === "global") - Number(right.value.scope === "global")
      );
      for (const registration of orderedSources) {
        const source = registration.value;
        const searched = itemSourceSearchState.get(source.id);
        const searchedItems = searched?.token === registration.token &&
            searched.query === filter.trim()
          ? searched.items
          : [];
        for (const item of [...source.items, ...searchedItems]) {
          if (!matchesQuery(filter, [item.id, item.label, item.description, ...(item.keywords ?? [])])) {
            continue;
          }
          const dedupeKey = item.dedupeKey ?? `${source.id}:${item.id}`;
          if (seenItems.has(dedupeKey)) continue;
          seenItems.add(dedupeKey);
          results.push({
            key: `item:${source.id}:${item.id}`,
            kind: "item",
            label: item.label,
            description: item.description ?? source.label,
            available: true,
            run: item.open,
          });
        }
      }
    }

    return results.slice(0, PALETTE_RESULT_LIMIT);
  })();

  const paletteSearching = [...itemSourceRegistry.values()].some((registration) => {
    const searched = itemSourceSearchState.get(registration.value.id);
    return searched?.token === registration.token &&
      searched.query === filter.trim() &&
      searched.pending;
  });

  const effectiveSelectedResult = paletteResults.length === 0
    ? 0
    : Math.min(selectedResult, paletteResults.length - 1);

  const runPaletteResult = (result: PaletteResult | undefined): boolean => {
    if (result === undefined || !result.available) return false;
    if (result.command !== undefined) return runPaletteCommand(result.command);
    if (result.run === undefined) return false;
    const closed = closePalette();
    return settlePaletteAction(result.run) || closed;
  };

  const sequenceContextIsCurrent = (pending: PendingShortcutSequence): boolean =>
    pending.settings === settings && pending.mode === getKeyboardContext(window.document, fixedMode).mode &&
    pending.focus === window.document.activeElement && pending.dialog === getActiveDialog(window.document) &&
    pending.page === window.document.querySelector(".babel-page-deck__page[data-active]");

  const checkSequenceContext = useEffectEvent(() => {
    if (pendingSequence.current !== null && !sequenceContextIsCurrent(pendingSequence.current)) resetSequence();
  });

  const waitForSequence = (pending: PendingShortcutSequence) => {
    window.clearTimeout(sequenceTimer.current);
    pendingSequence.current = pending;
    const choices = pending.candidates.map(({ label, steps }) =>
      `${steps.slice(pending.index).map(step => step.binding).join(" ")} · ${label}`);
    setSequenceHint(`${pending.prefix} … → ${choices.join(" / ")} · Esc cancels · 1.5 s`);
    sequenceTimer.current = window.setTimeout(resetSequence, SEQUENCE_TIMEOUT_MS);
  };

  const onWindowKeyDown = useEffectEvent((event: KeyboardEvent, sequencesOnly = false) => {
    if (shouldIgnoreShortcutEvent(withoutKeyRepeat(event))) {
      resetSequence();
      return;
    }
    // Modifier keydown events occur between strokes when a chord is released or
    // started. They neither advance nor cancel the sequence.
    if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return;
    const desktop = (window as Window & { __BABEL_DESKTOP__?: boolean }).__BABEL_DESKTOP__ === true;
    const editable = eventComesFromEditable(event, window.document);
    const currentMode = getKeyboardContext(window.document, fixedMode).mode;
    const currentBindings = resolveShortcutBindings(settings, currentMode);
    const consume = () => { event.preventDefault(); event.stopPropagation(); };
    const runCommand = (command: ShortcutCommand): boolean => {
      if (command === "commandPalette") return openPalette("universal");
      if (command === "quickOpen") return openPalette("items");
      if (command === "help") return openHelp();
      if (command === "search" && paletteOpen) {
        searchRef.current?.focus();
        searchRef.current?.select();
        return searchRef.current !== null;
      }
      return executeContextCommand(command);
    };
    const bareEscape =
      (event.key === "Escape" || event.key === "Esc") &&
      event.ctrlKey !== true &&
      event.altKey !== true &&
      event.shiftKey !== true;

    let pending = pendingSequence.current;
    if (pending !== null && (!sequenceContextIsCurrent(pending) || Date.now() >= pending.expiresAt)) {
      resetSequence();
      pending = null;
    }
    if (pending !== null) {
      if (bareEscape) { resetSequence(); consume(); return; }
      // Copy/paste, cursor movement and undo remain native even after a prefix.
      if (editable && isNativeEditingKey(event)) { resetSequence(); return; }
      if (event.repeat) { consume(); return; }
      const candidates = pending.candidates.filter(({ command, steps }) =>
        commandAllowedFromEditable(command, editable) && matchesShortcutBinding(event, steps[pending.index]));
      consume();
      if (candidates.length === 0) { resetSequence(); return; }
      const completed = candidates.find(({ steps }) => steps.length === pending.index + 1);
      if (completed !== undefined) {
        resetSequence();
        runCommand(completed.command);
      } else {
        waitForSequence({ ...pending, candidates, index: pending.index + 1,
          prefix: `${pending.prefix} ${candidates[0].steps[pending.index].binding}`,
          expiresAt: Date.now() + SEQUENCE_TIMEOUT_MS });
      }
      return;
    }

    const textKey = !event.ctrlKey && !event.altKey && !/^F\d+$/u.test(event.key);
    if (!bareEscape && !(editable && (textKey || isNativeEditingKey(event)))) {
      const candidates = SHORTCUT_DEFINITIONS.flatMap(({ command, label }) => {
        const binding = currentBindings[command];
        if (binding === null || !isShortcutBindingAvailable(binding, desktop) ||
          !commandAllowedFromEditable(command, editable)) return [];
        const steps = parseShortcutSequence(binding, true);
        return steps.length > 1 && matchesShortcutBinding(withoutKeyRepeat(event), steps[0])
          ? [{ command, label, steps }] : [];
      });
      if (candidates.length > 0) {
        consume();
        if (!event.repeat) waitForSequence({ candidates, index: 1, prefix: candidates[0].steps[0].binding,
          expiresAt: Date.now() + SEQUENCE_TIMEOUT_MS, settings, mode: currentMode,
          focus: window.document.activeElement, dialog: getActiveDialog(window.document),
          page: window.document.querySelector(".babel-page-deck__page[data-active]") });
        return;
      }
    }
    if (sequencesOnly) return;
    if (bareEscape) {
      const handled = event.repeat === true ? false : paletteOpen
        ? closePalette()
        : helpOpen
          ? closeHelp()
          : executeContextCommand("cancel");
      if (handled || (desktop && currentBindings.cancel === "Escape")) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }

    for (const { command } of SHORTCUT_DEFINITIONS) {
      const binding = currentBindings[command];
      if (handleShortcutKeyDown(event, command, binding, editable, desktop, () => runCommand(command),
        desktop || Object.hasOwn(settings.layers.app, command) ||
        (currentMode !== "app" && Object.hasOwn(settings.layers[currentMode], command)))) return;
    }
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => onWindowKeyDown(event);
    // Capture prefixes and their tails before local navigation handlers. Single
    // modifier shortcuts retain their existing bubbling order.
    const onModeKey = (event: KeyboardEvent) => {
      const sequencesOnly = Boolean(event.ctrlKey || event.altKey || event.metaKey || event.key === "Escape" ||
        getActiveDialog(window.document) !== null || eventComesFromEditable(event, window.document));
      onWindowKeyDown(event, sequencesOnly);
    };
    const observer = new window.MutationObserver(checkSequenceContext);
    observer.observe(window.document.body, { subtree: true, childList: true, attributes: true,
      attributeFilter: ["open", "hidden", "inert", "aria-hidden", "data-babel-mode", "data-active", "class"] });
    window.addEventListener("keydown", onModeKey, true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", resetSequence);
    window.addEventListener("pagehide", resetSequence);
    window.document.addEventListener("focusin", resetSequence, true);
    window.document.addEventListener("pointerdown", resetSequence, true);
    window.document.addEventListener("compositionstart", resetSequence, true);
    window.document.addEventListener("visibilitychange", resetSequence);
    window.addEventListener("babel:shortcuts-changed", resetSequence);
    return () => {
      window.removeEventListener("keydown", onModeKey, true);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", resetSequence);
      window.removeEventListener("pagehide", resetSequence);
      window.document.removeEventListener("focusin", resetSequence, true);
      window.document.removeEventListener("pointerdown", resetSequence, true);
      window.document.removeEventListener("compositionstart", resetSequence, true);
      window.document.removeEventListener("visibilitychange", resetSequence);
      window.removeEventListener("babel:shortcuts-changed", resetSequence);
      observer.disconnect();
      window.clearTimeout(sequenceTimer.current);
      pendingSequence.current = null;
    };
  }, [window, resetSequence]);

  useEffect(() => {
    // Detached documents inherit settings without receiving the parent's event.
    window.queueMicrotask(checkSequenceContext);
  }, [settings, window]);

  const handlePaletteCancel = (event: SyntheticEvent<HTMLDialogElement, Event>) => {
    event.preventDefault();
    closePalette();
  };
  const handleHelpCancel = (event: SyntheticEvent<HTMLDialogElement, Event>) => {
    event.preventDefault();
    closeHelp();
  };
  const handleFilterChange = (event: ChangeEvent<HTMLInputElement>) => {
    setFilter(event.target.value);
    setSelectedResult(0);
  };
  const handlePaletteKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      event.shiftKey ||
      event.nativeEvent.isComposing ||
      event.nativeEvent.keyCode === 229 ||
      event.nativeEvent.getModifierState("AltGraph")
    ) return;
    let nextIndex: number | null = null;
    if (event.key === "ArrowDown") {
      nextIndex = paletteResults.length === 0
        ? 0
        : (effectiveSelectedResult + 1) % paletteResults.length;
    } else if (event.key === "ArrowUp") {
      nextIndex = paletteResults.length === 0
        ? 0
        : (effectiveSelectedResult - 1 + paletteResults.length) % paletteResults.length;
    } else if (event.key === "Enter") {
      if (runPaletteResult(paletteResults[effectiveSelectedResult])) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    } else {
      return;
    }
    setSelectedResult(nextIndex);
    event.preventDefault();
    event.stopPropagation();
  };

  const selectedOptionId = paletteResults.length === 0
    ? undefined
    : `${listboxId}-option-${effectiveSelectedResult}`;

  useEffect(() => {
    if (!paletteOpen || selectedOptionId === undefined) return;
    const selectedOption = window.document.getElementById(selectedOptionId);
    if (selectedOption !== null && typeof selectedOption.scrollIntoView === "function") {
      selectedOption.scrollIntoView({ block: "nearest" });
    }
  }, [paletteOpen, selectedOptionId, window]);

  return (
    <ShortcutSettingsContext.Provider value={settings}>
    <ShortcutDocumentContext.Provider value={scopeDocument ?? null}>
    <ShortcutBindingsContext.Provider value={bindings}>
    <PaletteRegistrationContext.Provider value={registrationContext}>
      <PaneFocusProvider ownerDocument={ownerDocument}>
        {children}
        <KeyboardModeBar context={keyboardContext} bindings={bindings} sequenceHint={paletteOpen || helpOpen ? "" : sequenceHint} onMode={changeMode}
          onFocus={() => executeContextCommand("focusNextPane")} onHelp={openHelp} />
      </PaneFocusProvider>
      <dialog
        ref={dialogRef}
        className="babel-command-palette"
        data-babel-mode={dialogMode}
        aria-labelledby={titleId}
        data-state={paletteOpen ? "open" : "closed"}
        onCancel={handlePaletteCancel}
        onClose={() => setPaletteOpen(false)}
      >
        <div className="babel-command-palette__header">
          <h2 id={titleId}>{paletteMode === "items" ? "Quick Open" : "Command Palette"}</h2>
          <button type="button" onClick={closePalette} aria-label="Close command palette">
            {"\u00d7"}
          </button>
        </div>
        <ShortcutSequenceHint text={sequenceHint} />
        <label id={searchLabelId} htmlFor={`${searchLabelId}-input`}>
          {paletteMode === "items" ? "Search titles" : "Search commands and titles"}
        </label>
        <input
          ref={searchRef}
          id={`${searchLabelId}-input`}
          className="babel-command-palette__search"
          type="search"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={paletteOpen}
          aria-controls={listboxId}
          aria-activedescendant={selectedOptionId}
          value={filter}
          onChange={handleFilterChange}
          onKeyDown={handlePaletteKeyDown}
          autoComplete="off"
        />
        <ul
          id={listboxId}
          className="babel-command-palette__commands"
          role="listbox"
          aria-label={paletteMode === "items" ? "Titles" : "Commands, actions, and titles"}
        >
          {paletteResults.map((result, index) => (
            <li
              key={result.key}
              role="presentation"
            >
              <button
                id={`${listboxId}-option-${index}`}
                type="button"
                role="option"
                aria-selected={index === effectiveSelectedResult}
                aria-disabled={!result.available}
                data-active={index === effectiveSelectedResult ? "" : undefined}
                disabled={!result.available}
                tabIndex={-1}
                onMouseEnter={() => setSelectedResult(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => runPaletteResult(result)}
              >
                <span>{result.label}</span>
                {result.binding !== undefined ? (
                  <kbd>{result.binding ?? "Unbound"}</kbd>
                ) : null}
                <span className="babel-command-palette__availability">
                  {result.available ? result.description : `${result.description} · Unavailable`}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {paletteResults.length === 0 ? (
          <p className="babel-command-palette__empty" aria-live="polite">
            {paletteSearching ? "Searching titles…" : "No matching results."}
          </p>
        ) : null}
      </dialog>

      <dialog
        ref={helpDialogRef}
        className="babel-shortcut-help"
        data-babel-mode={dialogMode}
        aria-labelledby={helpTitleId}
        data-state={helpOpen ? "open" : "closed"}
        onCancel={handleHelpCancel}
        onClose={() => setHelpOpen(false)}
      >
        <div className="babel-command-palette__header">
          <h2 id={helpTitleId}>Keyboard Help</h2>
          <button type="button" onClick={closeHelp} aria-label="Close keyboard help">
            {"\u00d7"}
          </button>
        </div>
        <ShortcutSequenceHint text={sequenceHint} />
        <section aria-labelledby={`${helpTitleId}-navigation`}>
          <h3 id={`${helpTitleId}-navigation`}>{MODE_LABELS[keyboardContext.mode]} mode · {keyboardContext.focus}</h3>
          <dl className="babel-shortcut-help__grid">
            <div><dt>Panels</dt><dd><kbd>{bindings.focusNextPane ?? "Unbound"}</kbd> / <kbd>{bindings.focusPreviousPane ?? "Unbound"}</kbd></dd></div>
            <div><dt>Tree</dt><dd><kbd>↑</kbd>/<kbd>↓</kbd>, <kbd>Home</kbd>/<kbd>End</kbd>, <kbd>PageUp</kbd>/<kbd>PageDown</kbd> move; <kbd>←</kbd>/<kbd>→</kbd> collapse or expand</dd></div>
            <div><dt>Flat lists</dt><dd><kbd>↑</kbd>/<kbd>↓</kbd>, <kbd>Home</kbd>/<kbd>End</kbd>, <kbd>PageUp</kbd>/<kbd>PageDown</kbd>; type to jump</dd></div>
            <div><dt>Open / edit</dt><dd><kbd>Enter</kbd> / <kbd>F2</kbd></dd></div>
            <div><dt>Tabs</dt><dd><kbd>←</kbd>/<kbd>→</kbd> move, <kbd>Enter</kbd> activate</dd></div>
            <div><dt>Palette</dt><dd><kbd>↑</kbd>/<kbd>↓</kbd> select, <kbd>Enter</kbd> run or open</dd></div>
            <div><dt>Back</dt><dd><kbd>Escape</kbd> leaves edit, then reader, then list</dd></div>
            <div><dt>Reorder</dt><dd><kbd>Ctrl+Alt+↑</kbd> / <kbd>Ctrl+Alt+↓</kbd></dd></div>
            <div><dt>Key sequences</dt><dd>Press each step in order, within 1.5 seconds. <kbd>Escape</kbd> cancels a pending sequence. Configure up to 4 steps in Babel Shortcuts.</dd></div>
          </dl>
        </section>
        <section aria-labelledby={`${helpTitleId}-commands`}>
          <h3 id={`${helpTitleId}-commands`}>Commands</h3>
          <dl className="babel-shortcut-help__grid">
            {SHORTCUT_DEFINITIONS.map(({ command, label }) => (
              <div key={command}>
                <dt>{label}</dt>
                <dd>
                  <kbd>{bindings[command] ?? "Unbound"}</kbd>
                  {isDesktopOnlyShortcutBinding(bindings[command]) ? " · Desktop only" : null}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </dialog>
    </PaletteRegistrationContext.Provider>
    </ShortcutBindingsContext.Provider>
    </ShortcutDocumentContext.Provider>
    </ShortcutSettingsContext.Provider>
  );
}
