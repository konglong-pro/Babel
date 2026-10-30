export interface NoteTreeItem {
  readonly id: number;
  readonly parentId: number | null;
}

export interface NoteSelectionPath {
  readonly key: string;
  readonly ancestorIds: readonly number[];
}

export interface NoteExpansionState {
  readonly expandedIds: ReadonlySet<number>;
  readonly revealedPathKey: string;
}

export function noteSelectionPath(
  notes: readonly NoteTreeItem[],
  selectedId: number | null,
): NoteSelectionPath {
  if (selectedId === null) return { key: "root", ancestorIds: [] };

  const noteMap = new Map(notes.map((note) => [note.id, note]));
  const ancestorIds: number[] = [];
  const visited = new Set([selectedId]);
  let cursor = noteMap.get(selectedId)?.parentId ?? null;

  while (cursor !== null && !visited.has(cursor)) {
    const ancestor = noteMap.get(cursor);
    if (!ancestor) break;
    visited.add(cursor);
    ancestorIds.push(cursor);
    cursor = ancestor.parentId;
  }

  ancestorIds.reverse();
  return { key: `${selectedId}:${ancestorIds.join("/")}`, ancestorIds };
}

export function revealNoteSelection(
  state: NoteExpansionState,
  path: NoteSelectionPath,
): NoteExpansionState {
  if (state.revealedPathKey === path.key) return state;
  let expandedIds: Set<number> | undefined;
  for (const ancestorId of path.ancestorIds) {
    if (state.expandedIds.has(ancestorId)) continue;
    expandedIds ??= new Set(state.expandedIds);
    expandedIds.add(ancestorId);
  }
  return {
    expandedIds: expandedIds ?? state.expandedIds,
    revealedPathKey: path.key,
  };
}

export function toggleNoteExpansion(
  expandedIds: ReadonlySet<number>,
  noteId: number,
): ReadonlySet<number> {
  const next = new Set(expandedIds);
  if (next.has(noteId)) next.delete(noteId);
  else next.add(noteId);
  return next;
}
