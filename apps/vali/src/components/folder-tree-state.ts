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

  const folderMap = new Map(folders.map((folder) => [folder.id, folder]));
  const ancestorIds: number[] = [];
  const visited = new Set([selectedId]);
  let cursor = folderMap.get(selectedId)?.parentId ?? null;

  while (cursor !== null && !visited.has(cursor)) {
    const ancestor = folderMap.get(cursor);
    if (!ancestor) break;
    visited.add(cursor);
    ancestorIds.push(cursor);
    cursor = ancestor.parentId;
  }

  ancestorIds.reverse();
  return {
    key: `${selectedId}:${ancestorIds.join("/")}`,
    ancestorIds,
  };
}

export function revealFolderPath(
  expandedIds: ReadonlySet<number>,
  path: FolderSelectionPath,
): ReadonlySet<number> {
  let nextExpandedIds: Set<number> | undefined;
  for (const ancestorId of path.ancestorIds) {
    if (expandedIds.has(ancestorId)) continue;
    nextExpandedIds ??= new Set(expandedIds);
    nextExpandedIds.add(ancestorId);
  }
  return nextExpandedIds ?? expandedIds;
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
  const nextExpandedIds = new Set(expandedIds);
  if (nextExpandedIds.has(folderId)) {
    nextExpandedIds.delete(folderId);
  } else {
    nextExpandedIds.add(folderId);
  }
  return nextExpandedIds;
}
