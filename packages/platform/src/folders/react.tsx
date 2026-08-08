"use client";

import {
  type ButtonHTMLAttributes,
  type DragEvent,
  type HTMLAttributes,
  type KeyboardEvent,
  useCallback,
  useMemo,
  useState,
} from "react";

import {
  folderDropPosition,
  folderKeyboardPosition,
  type FolderDropPlacement,
  type OrderedFolder,
} from "./reorder";

export interface FolderReorderController {
  dropClassName: (folderId: number) => string;
  selectionProps: (folderId: number) => FolderReorderSelectionProps;
  rowProps: (folderId: number) => HTMLAttributes<HTMLDivElement>;
}

export type FolderReorderSelectionProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  "data-babel-folder-drag-source": string;
};

export interface UseFolderReorderOptions {
  folders: readonly OrderedFolder[];
  disabled?: boolean;
  onReorder: (folderId: number, position: number) => void | Promise<void>;
}

export function useFolderReorder({
  folders,
  disabled = false,
  onReorder,
}: UseFolderReorderOptions): FolderReorderController {
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    id: number;
    placement: FolderDropPlacement;
  } | null>(null);
  const [pending, setPending] = useState(false);

  const canMove = useMemo(() => {
    const siblingCounts = new Map<number | null, number>();
    for (const folder of folders) {
      siblingCounts.set(folder.parentId, (siblingCounts.get(folder.parentId) ?? 0) + 1);
    }
    return new Set(
      folders
        .filter((folder) => (siblingCounts.get(folder.parentId) ?? 0) > 1)
        .map(({ id }) => id),
    );
  }, [folders]);

  const runReorder = useCallback((folderId: number, position: number) => {
    if (disabled || pending) return;
    setPending(true);
    void Promise.resolve(onReorder(folderId, position))
      .catch(() => undefined)
      .finally(() => setPending(false));
  }, [disabled, onReorder, pending]);

  const clearDrag = useCallback(() => {
    setDraggedId(null);
    setDropTarget(null);
  }, []);

  const selectionProps = useCallback((folderId: number): FolderReorderSelectionProps => {
    const unavailable = disabled || pending || !canMove.has(folderId);
    return {
      draggable: !unavailable,
      "aria-keyshortcuts": "Control+Alt+ArrowUp Control+Alt+ArrowDown",
      title: "Drag to reorder · use Ctrl+Alt+↑/↓ with keyboard",
      "data-babel-folder-drag-source": "",
      onDragStart(event: DragEvent<HTMLButtonElement>) {
        if (unavailable) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", String(folderId));
        setDraggedId(folderId);
      },
      onDragEnd: clearDrag,
      onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
        if (
          event.nativeEvent.isComposing ||
          event.nativeEvent.getModifierState("AltGraph") ||
          event.key === "Process"
        ) return;
        if (!event.ctrlKey || !event.altKey || event.metaKey || event.shiftKey) return;
        const direction = event.key === "ArrowUp"
          ? "up"
          : event.key === "ArrowDown"
            ? "down"
            : null;
        if (direction === null || unavailable) return;
        const position = folderKeyboardPosition(folders, folderId, direction);
        if (position === null) return;
        event.preventDefault();
        runReorder(folderId, position);
      },
    };
  }, [canMove, clearDrag, disabled, folders, pending, runReorder]);

  const rowProps = useCallback((folderId: number): HTMLAttributes<HTMLDivElement> => ({
    onDragOver(event: DragEvent<HTMLDivElement>) {
      if (draggedId === null || disabled || pending) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      const placement: FolderDropPlacement = event.clientY < bounds.top + bounds.height / 2
        ? "before"
        : "after";
      if (folderDropPosition(folders, draggedId, folderId, placement) === null) {
        setDropTarget(null);
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDropTarget({ id: folderId, placement });
    },
    onDragLeave(event: DragEvent<HTMLDivElement>) {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      setDropTarget((current) => current?.id === folderId ? null : current);
    },
    onDrop(event: DragEvent<HTMLDivElement>) {
      if (draggedId === null) return;
      const placement = dropTarget?.id === folderId ? dropTarget.placement : null;
      const position = placement === null
        ? null
        : folderDropPosition(folders, draggedId, folderId, placement);
      clearDrag();
      if (position === null) return;
      event.preventDefault();
      runReorder(draggedId, position);
    },
  }), [clearDrag, disabled, draggedId, dropTarget, folders, pending, runReorder]);

  const dropClassName = useCallback((folderId: number) => {
    if (dropTarget?.id !== folderId) return "";
    return `folder-drop-${dropTarget.placement}`;
  }, [dropTarget]);

  return { dropClassName, selectionProps, rowProps };
}
