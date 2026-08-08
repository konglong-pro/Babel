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
  matchesShortcutBinding,
  parseShortcutSettings,
  SHORTCUT_DEFINITIONS,
  shouldIgnoreShortcutEvent,
  type ShortcutCommand,
  type ShortcutKeyboardEventLike,
  type ShortcutSettings,
} from "./core";
import { PaneFocusProvider } from "../navigation/react";
import { useWorkspaceProcessActive } from "../pages/react";

export interface ShortcutProviderProps {
  readonly children: ReactNode;
  readonly endpoint?: string;
}

export interface CommandPaletteAction {
  readonly id: string;
  readonly label: string;
  readonly keywords?: readonly string[];
  readonly group?: string;
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

  const style = window.getComputedStyle(element);
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
  return element instanceof HTMLElement && element.matches(EDITABLE_SELECTOR) && isEnabled(element);
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
    const style = window.getComputedStyle(ancestor);
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
  return !editable || (command !== "new" && command !== "edit" && command !== "delete");
}

export function handleReadShortcutKeyDown(
  event: ShortcutKeyDownEventLike,
  binding: string | null,
  editable: boolean,
  execute: () => boolean,
): boolean {
  if (binding === null) return false;
  const matches = matchesShortcutBinding(
    {
      key: event.key,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
      isComposing: event.isComposing,
      keyCode: event.keyCode,
      repeat: false,
      defaultPrevented: event.defaultPrevented,
      getModifierState: (keyArg) => event.getModifierState?.(keyArg) ?? false,
    },
    binding,
  );
  if (!matches || !commandAllowedFromEditable("read", editable)) return false;

  if (event.repeat !== true) execute();
  event.preventDefault();
  event.stopPropagation();
  return true;
}

function eventComesFromEditable(event: KeyboardEvent): boolean {
  const target = event.target instanceof Element ? event.target : window.document.activeElement;
  const targetEditable = target?.closest<HTMLElement>(EDITABLE_SELECTOR) ?? null;
  if (targetEditable !== null && isEnabled(targetEditable)) return true;

  const activeElement = window.document.activeElement;
  const activeEditable = activeElement?.closest<HTMLElement>(EDITABLE_SELECTOR) ?? null;
  return activeEditable !== null && isEnabled(activeEditable);
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

export function ShortcutProvider({ children, endpoint = "/api/shortcuts" }: ShortcutProviderProps) {
  const [settings, setSettings] = useState<ShortcutSettings>(DEFAULT_SHORTCUT_SETTINGS);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteMode, setPaletteMode] = useState<PaletteMode>("universal");
  const [helpOpen, setHelpOpen] = useState(false);
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
    try {
      dialog.showModal();
    } catch {
      return false;
    }
    setHelpOpen(true);
    window.requestAnimationFrame(() => dialog.focus());
    return true;
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
    const handled = command === "cancel"
      ? executeCancelLadder()
      : executeShortcutCommand(command);
    return handled || closed;
  };

  useEffect(() => {
    const abortController = new AbortController();
    void fetch(endpoint, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: abortController.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Shortcut settings request failed: ${response.status}.`);
        return response.json() as Promise<unknown>;
      })
      .then((document) => setSettings(parseShortcutSettings(document)))
      .catch(() => {
        if (!abortController.signal.aborted) setSettings(DEFAULT_SHORTCUT_SETTINGS);
      });

    return () => abortController.abort();
  }, [endpoint]);

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
  }, [filter, itemSourceRegistry, paletteMode, paletteOpen]);

  const paletteResults: readonly PaletteResult[] = (() => {
    const results: PaletteResult[] = [];
    if (paletteMode === "universal") {
      for (const definition of SHORTCUT_DEFINITIONS) {
        if (!matchesQuery(filter, [definition.command, definition.label])) continue;
        results.push({
          key: `command:${definition.command}`,
          kind: "command",
          label: definition.label,
          description: "Command",
          binding: settings.bindings[definition.command],
          available: availability[definition.command],
          command: definition.command,
        });
      }

      for (const [sourceId, registration] of actionRegistry) {
        for (const action of registration.value) {
          if (!matchesQuery(filter, [action.id, action.label, action.group, ...(action.keywords ?? [])])) {
            continue;
          }
          results.push({
            key: `action:${sourceId}:${action.id}`,
            kind: "action",
            label: action.label,
            description: action.group ?? "Action",
            available: action.available !== false,
            run: action.run,
          });
        }
      }
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

  const onWindowKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.repeat === true) {
      handleReadShortcutKeyDown(
        event,
        settings.bindings.read,
        eventComesFromEditable(event),
        () => executeShortcutCommand("read"),
      );
      return;
    }
    if (shouldIgnoreShortcutEvent(event)) return;

    const bareEscape =
      (event.key === "Escape" || event.key === "Esc") &&
      event.ctrlKey !== true &&
      event.altKey !== true &&
      event.shiftKey !== true;
    if (bareEscape) {
      const handled = paletteOpen
        ? closePalette()
        : helpOpen
          ? closeHelp()
          : executeCancelLadder();
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }

    if (
      handleReadShortcutKeyDown(
        event,
        settings.bindings.read,
        eventComesFromEditable(event),
        () => executeShortcutCommand("read"),
      )
    ) return;

    for (const { command } of SHORTCUT_DEFINITIONS) {
      if (command === "read") continue;
      const binding = settings.bindings[command];
      if (binding === null || !matchesShortcutBinding(event, binding)) continue;
      if (!commandAllowedFromEditable(command, eventComesFromEditable(event))) return;

      let handled: boolean;
      if (command === "commandPalette") {
        handled = openPalette("universal");
      } else if (command === "quickOpen") {
        handled = openPalette("items");
      } else if (command === "help") {
        handled = openHelp();
      } else if (command === "cancel") {
        handled = executeCancelLadder();
      } else if (command === "search" && paletteOpen) {
        searchRef.current?.focus();
        searchRef.current?.select();
        handled = searchRef.current !== null;
      } else {
        handled = executeShortcutCommand(command);
      }
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => onWindowKeyDown(event);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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
  }, [paletteOpen, selectedOptionId]);

  return (
    <PaletteRegistrationContext.Provider value={registrationContext}>
      <PaneFocusProvider>{children}</PaneFocusProvider>
      <dialog
        ref={dialogRef}
        className="babel-command-palette"
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
        <section aria-labelledby={`${helpTitleId}-navigation`}>
          <h3 id={`${helpTitleId}-navigation`}>Ready mode</h3>
          <dl className="babel-shortcut-help__grid">
            <div><dt>Panels</dt><dd><kbd>{settings.bindings.focusNextPane ?? "Unbound"}</kbd> / <kbd>{settings.bindings.focusPreviousPane ?? "Unbound"}</kbd></dd></div>
            <div><dt>Tree</dt><dd><kbd>\u2191</kbd>/<kbd>\u2193</kbd>, <kbd>Home</kbd>/<kbd>End</kbd>, <kbd>PageUp</kbd>/<kbd>PageDown</kbd> move; <kbd>\u2190</kbd>/<kbd>\u2192</kbd> collapse or expand</dd></div>
            <div><dt>Flat lists</dt><dd><kbd>\u2191</kbd>/<kbd>\u2193</kbd>, <kbd>Home</kbd>/<kbd>End</kbd>, <kbd>PageUp</kbd>/<kbd>PageDown</kbd>; type to jump</dd></div>
            <div><dt>Open / edit</dt><dd><kbd>Enter</kbd> / <kbd>F2</kbd></dd></div>
            <div><dt>Tabs</dt><dd><kbd>\u2190</kbd>/<kbd>\u2192</kbd> move, <kbd>Enter</kbd> activate</dd></div>
            <div><dt>Palette</dt><dd><kbd>\u2191</kbd>/<kbd>\u2193</kbd> select, <kbd>Enter</kbd> run or open</dd></div>
            <div><dt>Back</dt><dd><kbd>Escape</kbd> leaves edit, then reader, then list</dd></div>
            <div><dt>Reorder</dt><dd><kbd>Ctrl+Alt+\u2191</kbd> / <kbd>Ctrl+Alt+\u2193</kbd></dd></div>
          </dl>
        </section>
        <section aria-labelledby={`${helpTitleId}-commands`}>
          <h3 id={`${helpTitleId}-commands`}>Commands</h3>
          <dl className="babel-shortcut-help__grid">
            {SHORTCUT_DEFINITIONS.map(({ command, label }) => (
              <div key={command}>
                <dt>{label}</dt>
                <dd><kbd>{settings.bindings[command] ?? "Unbound"}</kbd></dd>
              </div>
            ))}
          </dl>
        </section>
      </dialog>
    </PaletteRegistrationContext.Provider>
  );
}
