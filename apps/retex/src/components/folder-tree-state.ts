export interface FolderTreeItem {
  readonly id: number;
  readonly parentId: number | null;
}

export interface FolderSelectionPath {
  readonly key: string;
  readonly ancestorIds: readonly number[];
}

export interface FolderExpansionState {
  readonly expandedIds: ReadonlySet<number>;
  readonly revealedPathKey: string;
}

export function folderSelectionPath(
  folders: readonly FolderTreeItem[],
  selectedId: number | null,
): FolderSelectionPath {
  if (selectedId === null) {
    return { key: "root", ancestorIds: [] };
  }

  const foldersById = new Map(folders.map((folder) => [folder.id, folder]));
  const ancestorIds: number[] = [];
  const seen = new Set([selectedId]);
  let current = foldersById.get(selectedId);

  while (current && current.parentId !== null) {
    const parentId = current.parentId;
    if (seen.has(parentId)) break;

    const parent = foldersById.get(parentId);
    if (!parent) break;

    ancestorIds.unshift(parent.id);
    seen.add(parent.id);
    current = parent;
  }

  return {
    key: `${selectedId}:${ancestorIds.join("/")}`,
    ancestorIds,
  };
}

export function revealFolderPath(
  expandedIds: ReadonlySet<number>,
  path: FolderSelectionPath,
): ReadonlySet<number> {
  const missingIds = path.ancestorIds.filter((id) => !expandedIds.has(id));
  if (missingIds.length === 0) return expandedIds;

  const next = new Set(expandedIds);
  for (const id of missingIds) next.add(id);
  return next;
}

export function revealFolderSelection(
  state: FolderExpansionState,
  path: FolderSelectionPath,
): FolderExpansionState {
  if (state.revealedPathKey === path.key) return state;

  return {
    expandedIds: revealFolderPath(state.expandedIds, path),
    revealedPathKey: path.key,
  };
}

export function toggleFolderExpansion(
  expandedIds: ReadonlySet<number>,
  folderId: number,
): ReadonlySet<number> {
  const next = new Set(expandedIds);
  if (next.has(folderId)) {
    next.delete(folderId);
  } else {
    next.add(folderId);
  }
  return next;
}
