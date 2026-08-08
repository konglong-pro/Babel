export type NavigationId = string | number;

export interface NavigationItem<Id extends NavigationId = NavigationId> {
  readonly id: Id;
  readonly label: string;
  readonly disabled?: boolean;
  readonly visible?: boolean;
}

export interface TreeNavigationItem<Id extends NavigationId = NavigationId>
  extends NavigationItem<Id> {
  readonly parentId?: Id | null;
  readonly hasChildren?: boolean;
  readonly expanded?: boolean;
  readonly level?: number;
}

export type NavigationMovement =
  | "next"
  | "previous"
  | "first"
  | "last"
  | "page-next"
  | "page-previous";

export function enabledNavigationItems<
  Id extends NavigationId,
  Item extends NavigationItem<Id>,
>(items: readonly Item[]): readonly Item[] {
  return items.filter((item) => item.visible !== false && !item.disabled);
}

export function navigationMovementIndex(
  length: number,
  currentIndex: number,
  movement: NavigationMovement,
  pageSize = 10,
): number | null {
  if (length <= 0) return null;
  const current = currentIndex >= 0 ? currentIndex : 0;
  if (movement === "first") return 0;
  if (movement === "last") return length - 1;
  const delta = movement === "next"
    ? 1
    : movement === "previous"
      ? -1
      : movement === "page-next"
        ? Math.max(1, pageSize)
        : -Math.max(1, pageSize);
  return Math.min(length - 1, Math.max(0, current + delta));
}

export function cyclicNavigationIndex(
  length: number,
  currentIndex: number,
  direction: 1 | -1,
): number | null {
  if (length <= 0) return null;
  if (currentIndex < 0 || currentIndex >= length) {
    return direction === 1 ? 0 : length - 1;
  }
  return (currentIndex + direction + length) % length;
}

function searchableLabel(label: string): string {
  return label.normalize("NFKD").toLocaleLowerCase();
}

export function findTypeaheadItem<
  Id extends NavigationId,
  Item extends NavigationItem<Id>,
>(
  items: readonly Item[],
  currentId: Id | null,
  query: string,
): Item | null {
  if (items.length === 0 || query.length === 0) return null;
  const normalizedQuery = searchableLabel(query);
  const currentIndex = items.findIndex((item) => item.id === currentId);
  for (let step = 1; step <= items.length; step += 1) {
    const index = (Math.max(currentIndex, -1) + step) % items.length;
    const item = items[index];
    if (item && searchableLabel(item.label).startsWith(normalizedQuery)) return item;
  }
  return null;
}

export function treeItemLevel<Id extends NavigationId>(
  items: readonly TreeNavigationItem<Id>[],
  id: Id,
): number {
  const byId = new Map(items.map((item) => [item.id, item]));
  const item = byId.get(id);
  if (item?.level !== undefined) return Math.max(1, item.level);
  let level = 1;
  let parentId = item?.parentId;
  const visited = new Set<Id>();
  while (parentId !== null && parentId !== undefined && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = byId.get(parentId);
    if (parent === undefined) break;
    level += 1;
    parentId = parent.parentId;
  }
  return level;
}

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (typeof Element === "undefined" || !(target instanceof Element)) return false;
  const editable = target.closest(
    "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']",
  );
  return editable !== null;
}

function elementOrAncestorMatches(element: Element, selector: string): boolean {
  return element.matches(selector) || element.closest(selector) !== null;
}

export function isPaneAvailable(pane: HTMLElement): boolean {
  if (!pane.isConnected) return false;
  if (elementOrAncestorMatches(pane, "[hidden], [inert], [aria-hidden='true']")) return false;
  if (typeof window === "undefined") return true;
  for (let current: HTMLElement | null = pane; current !== null; current = current.parentElement) {
    const style = window.getComputedStyle(current);
    if (style.display === "none" || style.visibility === "hidden") return false;
  }
  return true;
}
