export interface OrderedItem {
  id: number;
  parentId: number | null;
  scopeId: string | number;
}

export type ItemDropPlacement = "before" | "after";
export type ItemMoveDirection = "up" | "down";

function sameSiblingGroup(a: OrderedItem, b: OrderedItem): boolean {
  return a.parentId === b.parentId && a.scopeId === b.scopeId;
}

/** Returns the final zero-based sibling position after removing the dragged item. */
export function itemDropPosition(
  items: readonly OrderedItem[],
  draggedId: number,
  targetId: number,
  placement: ItemDropPlacement,
): number | null {
  if (draggedId === targetId) return null;
  const dragged = items.find(({ id }) => id === draggedId);
  const target = items.find(({ id }) => id === targetId);
  if (!dragged || !target || !sameSiblingGroup(dragged, target)) return null;

  const siblings = items.filter((item) => sameSiblingGroup(item, dragged));
  const currentIndex = siblings.findIndex(({ id }) => id === draggedId);
  const remaining = siblings.filter(({ id }) => id !== draggedId);
  const targetIndex = remaining.findIndex(({ id }) => id === targetId);
  if (currentIndex < 0 || targetIndex < 0) return null;
  const position = targetIndex + (placement === "after" ? 1 : 0);
  return position === currentIndex ? null : position;
}

export function itemKeyboardPosition(
  items: readonly OrderedItem[],
  itemId: number,
  direction: ItemMoveDirection,
): number | null {
  const item = items.find(({ id }) => id === itemId);
  if (!item) return null;
  const siblings = items.filter((candidate) => sameSiblingGroup(candidate, item));
  const currentIndex = siblings.findIndex(({ id }) => id === itemId);
  const position = currentIndex + (direction === "up" ? -1 : 1);
  return position < 0 || position >= siblings.length ? null : position;
}
