import type { ShortcutMode } from "./core";

export interface KeyboardContext {
  readonly mode: ShortcutMode;
  readonly focus: string;
  readonly input: boolean;
}

const INPUT_SELECTOR = "input:not([type='hidden']), textarea, select, [contenteditable]:not([contenteditable='false'])";
const PANE_LABELS: Readonly<Record<string, string>> = {
  tree: "Folders", items: "Documents", tabs: "Tabs", detail: "Content",
};

export function isKeyboardVisible(element: Element): boolean {
  if (!element.isConnected || element.closest("[hidden], [inert], [aria-hidden='true']")) return false;
  const view = element.ownerDocument.defaultView;
  for (let current: Element | null = element; current !== null; current = current.parentElement) {
    const style = view?.getComputedStyle(current);
    if (style?.display === "none" || style?.visibility === "hidden") return false;
  }
  return true;
}

export function isKeyboardInput(element: Element | null): boolean {
  const input = element?.closest(INPUT_SELECTOR);
  return input !== null && input !== undefined && !input.matches(":disabled") &&
    input.closest("[inert], [aria-disabled='true']") === null;
}

/** Resolve from the actual focused document, including windows hosting portals. */
export function getKeyboardContext(document: Document, fixedMode?: ShortcutMode): KeyboardContext {
  const focused = document.activeElement;
  const pane = focused?.closest<HTMLElement>("[data-babel-pane]");
  const dialog = focused?.closest("dialog[open], [role='dialog'][aria-modal='true']");
  const explicit = focused?.closest<HTMLElement>("[data-babel-mode]")?.dataset.babelMode;
  const details = Array.from(document.querySelectorAll<HTMLElement>("[data-babel-pane='detail']"));
  const detail = pane?.dataset.babelPane === "detail" ? pane : details.find(isKeyboardVisible);
  let mode: ShortcutMode = fixedMode ?? "app";
  if (fixedMode === undefined) {
    if (explicit === "app" || explicit === "read" || explicit === "edit") mode = explicit;
    else if (pane !== null && pane !== undefined && pane.dataset.babelPane !== "detail") mode = "app";
    else if (detail !== undefined && detail !== null) {
      // Existing semantic adapters describe the actual form state, including
      // disabled Save buttons while a draft is clean or a save is pending.
      const saves = detail.querySelectorAll<HTMLElement>("[data-babel-command='save']");
      if (Array.from(saves).some(isKeyboardVisible)) mode = "edit";
      else if (Array.from(detail.querySelectorAll("[data-babel-command='edit'], .markdown-body")).some(isKeyboardVisible)) mode = "read";
    }
  }
  const input = isKeyboardInput(focused);
  const focus = dialog ? "Dialog" : pane
    ? PANE_LABELS[pane.dataset.babelPane ?? ""] ?? pane.getAttribute("aria-label") ?? "Content"
    : fixedMode === "read" ? "Reader" : fixedMode === "edit" ? "Editor" : "APP";
  return { mode, focus, input };
}

/** Browse leaves focus in the current notebook without discarding its page. */
export function focusNotebookList(document: Document): boolean {
  for (const id of ["items", "tree", "tabs"]) {
    const pane = Array.from(document.querySelectorAll<HTMLElement>(`[data-babel-pane='${id}']`)).find(isKeyboardVisible);
    if (pane === undefined) continue;
    const target = Array.from(pane.querySelectorAll<HTMLElement>("[tabindex='0'], button:not(:disabled), input:not(:disabled), a[href]"))
      .find(isKeyboardVisible) ?? pane;
    if (!target.hasAttribute("tabindex") && target === pane) target.tabIndex = -1;
    target.focus();
    return document.activeElement === target;
  }
  return false;
}

/** Focus a named visible pane without changing its document or editing state. */
export function focusNamedPane(document: Document, id: "tree" | "items" | "detail"): boolean {
  const pane = Array.from(document.querySelectorAll<HTMLElement>(`[data-babel-pane='${id}']`)).find(isKeyboardVisible);
  if (pane === undefined) return false;
  const target = Array.from(pane.querySelectorAll<HTMLElement>(
    id === "detail" ? "textarea:not(:disabled), [contenteditable='true'], .markdown-body" :
      "[tabindex='0'], button:not(:disabled), input:not(:disabled), a[href]",
  )).find(isKeyboardVisible) ?? pane;
  if (!target.hasAttribute("tabindex") && (target === pane || target.matches(".markdown-body"))) target.tabIndex = -1;
  target.focus();
  return document.activeElement === target;
}

export function focusModeContent(document: Document, mode: "edit" | "read"): boolean {
  const selector = mode === "edit" ? "textarea, [contenteditable='true'], input:not([type='hidden'])" : ".markdown-body";
  const panes = Array.from(document.querySelectorAll<HTMLElement>("[data-babel-pane='detail']")).filter(isKeyboardVisible);
  for (const pane of panes) {
    const target = Array.from(pane.querySelectorAll<HTMLElement>(selector)).find(isKeyboardVisible) ?? pane;
    if (!target.hasAttribute("tabindex") && (target === pane || mode === "read")) target.tabIndex = -1;
    target.focus();
    if (document.activeElement === target) return true;
  }
  return false;
}
