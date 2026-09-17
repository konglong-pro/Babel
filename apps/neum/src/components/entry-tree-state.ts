export interface EntryTreeItem {
  readonly id: number;
  readonly parentId: number | null;
}

export interface EntrySelectionPath {
  readonly key: string;
  readonly ancestorIds: readonly number[];
}

export interface EntryExpansionState {
  readonly expandedIds: ReadonlySet<number>;
  readonly revealedPathKey: string;
}

export function entrySelectionPath(
  entries: readonly EntryTreeItem[],
  selectedId: number | null,
): EntrySelectionPath {
  if (selectedId === null) return { key: "root", ancestorIds: [] };

  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  const ancestorIds: number[] = [];
  const seen = new Set([selectedId]);
  let current = entriesById.get(selectedId);

  while (current && current.parentId !== null) {
    const parentId = current.parentId;
    if (seen.has(parentId)) break;
    const parent = entriesById.get(parentId);
    if (!parent) break;
    ancestorIds.unshift(parent.id);
    seen.add(parent.id);
    current = parent;
  }

  return { key: `${selectedId}:${ancestorIds.join("/")}`, ancestorIds };
}

export function revealEntryPath(
  expandedIds: ReadonlySet<number>,
  path: EntrySelectionPath,
): ReadonlySet<number> {
  const missingIds = path.ancestorIds.filter((id) => !expandedIds.has(id));
  if (missingIds.length === 0) return expandedIds;
  const next = new Set(expandedIds);
  for (const id of missingIds) next.add(id);
  return next;
}

export function revealEntrySelection(
  state: EntryExpansionState,
  path: EntrySelectionPath,
): EntryExpansionState {
  if (state.revealedPathKey === path.key) return state;
  return {
    expandedIds: revealEntryPath(state.expandedIds, path),
    revealedPathKey: path.key,
  };
}

export function toggleEntryExpansion(
  expandedIds: ReadonlySet<number>,
  entryId: number,
): ReadonlySet<number> {
  const next = new Set(expandedIds);
  if (next.has(entryId)) next.delete(entryId);
  else next.add(entryId);
  return next;
}

export function entrySubtreeIds(items: readonly EntryTreeItem[], rootId: number): ReadonlySet<number> {
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
