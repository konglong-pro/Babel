export interface OrderedFolder {
  id: number;
  parentId: number | null;
}

export type FolderDropPlacement = "before" | "after";
export type FolderMoveDirection = "up" | "down";

/**
 * Returns the insertion position after the dragged folder is removed from its
 * sibling list. Cross-parent drops and no-op drops are rejected with `null`.
 */
export function folderDropPosition(
  folders: readonly OrderedFolder[],
  draggedId: number,
  targetId: number,
  placement: FolderDropPlacement,
): number | null {
  if (draggedId === targetId) return null;

  const dragged = folders.find(({ id }) => id === draggedId);
  const target = folders.find(({ id }) => id === targetId);
  if (dragged === undefined || target === undefined || dragged.parentId !== target.parentId) {
    return null;
  }

  const siblings = folders.filter(({ parentId }) => parentId === dragged.parentId);
  const currentIndex = siblings.findIndex(({ id }) => id === draggedId);
  const remaining = siblings.filter(({ id }) => id !== draggedId);
  const targetIndex = remaining.findIndex(({ id }) => id === targetId);
  if (currentIndex < 0 || targetIndex < 0) return null;

  const position = targetIndex + (placement === "after" ? 1 : 0);
  return position === currentIndex ? null : position;
}

/** Returns the insertion position for an accessible one-step sibling move. */
export function folderKeyboardPosition(
  folders: readonly OrderedFolder[],
  folderId: number,
  direction: FolderMoveDirection,
): number | null {
  const folder = folders.find(({ id }) => id === folderId);
  if (folder === undefined) return null;

  const siblings = folders.filter(({ parentId }) => parentId === folder.parentId);
  const currentIndex = siblings.findIndex(({ id }) => id === folderId);
  if (currentIndex < 0) return null;

  const position = currentIndex + (direction === "up" ? -1 : 1);
  return position < 0 || position >= siblings.length ? null : position;
}
