export const folderItemMime = "application/x-babel-folder-item";

export interface FolderMoveItem {
  id: number;
  folderId: number;
}

export interface FolderItemDrag extends FolderMoveItem {
  scope: string;
}

export function parseFolderItemDrag(value: string): FolderItemDrag | null {
  try {
    const input: unknown = JSON.parse(value);
    if (input === null || typeof input !== "object") return null;
    const drag = input as Partial<FolderItemDrag>;
    if (
      typeof drag.scope !== "string" || !drag.scope ||
      !Number.isSafeInteger(drag.id) || Number(drag.id) <= 0 ||
      !Number.isSafeInteger(drag.folderId) || Number(drag.folderId) <= 0
    ) return null;
    return { scope: drag.scope, id: drag.id!, folderId: drag.folderId! };
  } catch {
    return null;
  }
}

/** Validate against the current workspace, never trust a transfer's IDs alone. */
export function canMoveFolderItem(
  drag: FolderItemDrag | null,
  scope: string,
  items: readonly FolderMoveItem[],
  folderIds: readonly number[],
  targetId: number,
): boolean {
  if (!drag || drag.scope !== scope || !folderIds.includes(targetId)) return false;
  const item = items.find(({ id }) => id === drag.id);
  return Boolean(item && item.folderId === drag.folderId && item.folderId !== targetId);
}
