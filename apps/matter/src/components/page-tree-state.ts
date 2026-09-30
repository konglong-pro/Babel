export interface PageTreeItem {
  readonly id: number;
  readonly parentId: number | null;
}

export interface PageSelectionPath {
  readonly key: string;
  readonly ancestorIds: readonly number[];
}

export interface PageExpansionState {
  readonly expandedIds: ReadonlySet<number>;
  readonly revealedPathKey: string;
}

export function pageSelectionPath(
  pages: readonly PageTreeItem[],
  selectedId: number | null,
): PageSelectionPath {
  if (selectedId === null) return { key: "root", ancestorIds: [] };

  const pagesById = new Map(pages.map((page) => [page.id, page]));
  const ancestorIds: number[] = [];
  const seen = new Set([selectedId]);
  let current = pagesById.get(selectedId);
  while (current && current.parentId !== null) {
    const parentId = current.parentId;
    if (seen.has(parentId)) break;
    const parent = pagesById.get(parentId);
    if (!parent) break;
    ancestorIds.unshift(parent.id);
    seen.add(parent.id);
    current = parent;
  }

  return { key: `${selectedId}:${ancestorIds.join("/")}`, ancestorIds };
}

export function revealPageSelection(
  state: PageExpansionState,
  path: PageSelectionPath,
): PageExpansionState {
  if (state.revealedPathKey === path.key) return state;
  const expandedIds = new Set(state.expandedIds);
  for (const id of path.ancestorIds) expandedIds.add(id);
  return { expandedIds, revealedPathKey: path.key };
}

export function togglePageExpansion(
  expandedIds: ReadonlySet<number>,
  pageId: number,
): ReadonlySet<number> {
  const next = new Set(expandedIds);
  if (next.has(pageId)) next.delete(pageId);
  else next.add(pageId);
  return next;
}

export function pageDescendantIds(
  pages: readonly PageTreeItem[],
  pageId: number,
): Set<number> {
  const grouped = new Map<number, PageTreeItem[]>();
  for (const page of pages) {
    if (page.parentId === null) continue;
    const children = grouped.get(page.parentId) ?? [];
    children.push(page);
    grouped.set(page.parentId, children);
  }

  const result = new Set<number>();
  const stack = [pageId];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    for (const child of grouped.get(current) ?? []) {
      if (child.id === pageId || result.has(child.id)) continue;
      result.add(child.id);
      stack.push(child.id);
    }
  }
  return result;
}

export function pageSubtreeIds(items: readonly PageTreeItem[], rootId: number): ReadonlySet<number> {
  const children = new Map<number, number[]>();
  for (const item of items) {
    if (item.parentId === null) continue;
    const siblings = children.get(item.parentId) ?? [];
    siblings.push(item.id);
    children.set(item.parentId, siblings);
  }
  const ids = new Set<number>();
  const pending = [rootId];
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (ids.has(id)) continue;
    ids.add(id);
    pending.push(...(children.get(id) ?? []));
  }
  return ids;
}
