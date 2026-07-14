"use client";

import {
  type ChangeEvent,
  type ReactNode,
  type SyntheticEvent,
  useEffect,
  useEffectEvent,
  useId,
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
  type ShortcutSettings,
} from "./core";

export interface ShortcutProviderProps {
  readonly children: ReactNode;
  readonly endpoint?: string;
}

interface PaletteItem {
  readonly command: ShortcutCommand;
  readonly label: string;
  readonly binding: string;
  readonly available: boolean;
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

export function findShortcutCommandTarget(
  command: ShortcutCommand,
  document: Document = window.document,
): HTMLElement | null {
  const visibleCandidates = Array.from(
    document.querySelectorAll<HTMLElement>(`[data-babel-command="${command}"]`),
  ).filter((element) => isVisible(element) && isEnabled(element));
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

export function executeShortcutCommand(command: ShortcutCommand, document: Document = window.document): boolean {
  if (command === "commandPalette") return false;

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

function commandIsAvailable(command: ShortcutCommand, document: Document): boolean {
  if (command === "commandPalette") return true;
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
    SHORTCUT_DEFINITIONS.map(({ command }) => [command, command === "commandPalette"]),
  ) as Record<ShortcutCommand, boolean>;
}

function matchingCommands(filter: string): readonly ShortcutCommand[] {
  const query = filter.trim().toLocaleLowerCase();
  return SHORTCUT_DEFINITIONS.filter(
    ({ command, label }) =>
      query === "" ||
      command.toLocaleLowerCase().includes(query) ||
      label.toLocaleLowerCase().includes(query),
  ).map(({ command }) => command);
}

export function commandAllowedFromEditable(
  command: ShortcutCommand,
  editable: boolean,
): boolean {
  return !editable || (command !== "new" && command !== "edit" && command !== "delete");
}

function eventComesFromEditable(event: KeyboardEvent): boolean {
  const target = event.target instanceof Element ? event.target : window.document.activeElement;
  const targetEditable = target?.closest<HTMLElement>(EDITABLE_SELECTOR) ?? null;
  if (targetEditable !== null && isEnabled(targetEditable)) return true;

  const activeElement = window.document.activeElement;
  const activeEditable = activeElement?.closest<HTMLElement>(EDITABLE_SELECTOR) ?? null;
  return activeEditable !== null && isEnabled(activeEditable);
}

export function ShortcutProvider({ children, endpoint = "/api/shortcuts" }: ShortcutProviderProps) {
  const [settings, setSettings] = useState<ShortcutSettings>(DEFAULT_SHORTCUT_SETTINGS);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [availability, setAvailability] = useState(getInitialAvailability);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const searchLabelId = useId();

  const closePalette = (): boolean => {
    const dialog = dialogRef.current;
    if (dialog === null || !dialog.open) return false;
    dialog.close();
    setPaletteOpen(false);
    return true;
  };

  const openPalette = (): boolean => {
    const dialog = dialogRef.current;
    if (dialog === null) return false;
    if (dialog.open) {
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
    setFilter("");
    setAvailability(nextAvailability);
    setPaletteOpen(true);
    window.requestAnimationFrame(() => searchRef.current?.focus());
    return true;
  };

  const runPaletteCommand = (command: ShortcutCommand): boolean => {
    if (command === "commandPalette") {
      searchRef.current?.focus();
      return true;
    }
    const closed = closePalette();
    const handled = executeShortcutCommand(command);
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
        // Defaults remain active when a settings request is unavailable or invalid.
      });

    return () => abortController.abort();
  }, [endpoint]);

  const onWindowKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (shouldIgnoreShortcutEvent(event)) return;

    if (
      paletteOpen &&
      event.ctrlKey !== true &&
      event.altKey !== true &&
      event.shiftKey !== true
    ) {
      if (event.key === "Escape" || event.key === "Esc") {
        if (closePalette()) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }
      if (event.key === "Enter") {
        if (event.target !== searchRef.current) return;
        const firstAvailable = matchingCommands(filter).find(
          (command) => availability[command],
        );
        if (firstAvailable !== undefined && runPaletteCommand(firstAvailable)) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }
    }

    for (const { command } of SHORTCUT_DEFINITIONS) {
      if (!matchesShortcutBinding(event, settings.bindings[command])) continue;
      if (!commandAllowedFromEditable(command, eventComesFromEditable(event))) return;

      let handled: boolean;
      if (command === "commandPalette") {
        handled = openPalette();
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

  const handleCancel = (event: SyntheticEvent<HTMLDialogElement, Event>) => {
    event.preventDefault();
    closePalette();
  };
  const handleFilterChange = (event: ChangeEvent<HTMLInputElement>) => {
    setFilter(event.target.value);
  };

  const paletteItems: readonly PaletteItem[] = matchingCommands(filter).map((command) => {
    const definition = SHORTCUT_DEFINITIONS.find((candidate) => candidate.command === command);
    return {
      command,
      label: definition?.label ?? command,
      binding: settings.bindings[command],
      available: availability[command],
    };
  });

  return (
    <>
      {children}
      <dialog
        ref={dialogRef}
        className="babel-command-palette"
        aria-labelledby={titleId}
        data-state={paletteOpen ? "open" : "closed"}
        onCancel={handleCancel}
        onClose={() => setPaletteOpen(false)}
      >
        <div className="babel-command-palette__header">
          <h2 id={titleId}>Command Palette</h2>
          <button type="button" onClick={closePalette} aria-label="Close command palette">
            {"\u00d7"}
          </button>
        </div>
        <label id={searchLabelId} htmlFor={`${searchLabelId}-input`}>
          Search commands
        </label>
        <input
          ref={searchRef}
          id={`${searchLabelId}-input`}
          className="babel-command-palette__search"
          type="search"
          value={filter}
          onChange={handleFilterChange}
          autoComplete="off"
        />
        <ul className="babel-command-palette__commands" aria-label="Commands">
          {paletteItems.map(({ command, label, binding, available }) => (
            <li key={command}>
              <button
                type="button"
                disabled={!available}
                onClick={() => runPaletteCommand(command)}
              >
                <span>{label}</span>
                <kbd>{binding}</kbd>
                <span className="babel-command-palette__availability">
                  {available ? "Available" : "Unavailable"}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {paletteItems.length === 0 ? (
          <p className="babel-command-palette__empty">No matching commands.</p>
        ) : null}
      </dialog>
    </>
  );
}
