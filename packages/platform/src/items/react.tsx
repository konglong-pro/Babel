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
  itemDropPosition,
  itemKeyboardPosition,
  type ItemDropPlacement,
  type OrderedItem,
} from "./reorder";

export interface ItemReorderController {
  dropClassName: (itemId: number) => string;
  selectionProps: (itemId: number) => ItemReorderSelectionProps;
  rowProps: (itemId: number) => HTMLAttributes<HTMLDivElement>;
}

export type ItemReorderSelectionProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  "data-babel-item-drag-source": string;
};

export interface UseItemReorderOptions {
  items: readonly OrderedItem[];
  disabled?: boolean;
  onReorder: (itemId: number, position: number) => void | Promise<void>;
}

export function useItemReorder({
  items,
  disabled = false,
  onReorder,
}: UseItemReorderOptions): ItemReorderController {
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    id: number;
    placement: ItemDropPlacement;
  } | null>(null);
  const [pending, setPending] = useState(false);

  const canMove = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      const key = `${typeof item.scopeId}:${String(item.scopeId)}:${item.parentId ?? "root"}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return new Set(items.filter((item) => {
      const key = `${typeof item.scopeId}:${String(item.scopeId)}:${item.parentId ?? "root"}`;
      return (counts.get(key) ?? 0) > 1;
    }).map(({ id }) => id));
  }, [items]);

  const clearDrag = useCallback(() => {
    setDraggedId(null);
    setDropTarget(null);
  }, []);

  const runReorder = useCallback((itemId: number, position: number) => {
    if (disabled || pending) return;
    setPending(true);
    void Promise.resolve(onReorder(itemId, position))
      .catch(() => undefined)
      .finally(() => setPending(false));
  }, [disabled, onReorder, pending]);

  const selectionProps = useCallback((itemId: number): ItemReorderSelectionProps => {
    const unavailable = disabled || pending || !canMove.has(itemId);
    return {
      draggable: !unavailable,
      "aria-keyshortcuts": "ArrowUp ArrowDown",
      title: unavailable ? undefined : "Drag to reorder · use ↑/↓ with keyboard",
      "data-babel-item-drag-source": "",
      onDragStart(event: DragEvent<HTMLButtonElement>) {
        if (unavailable) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", String(itemId));
        setDraggedId(itemId);
      },
      onDragEnd: clearDrag,
      onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
        const direction = event.key === "ArrowUp"
          ? "up"
          : event.key === "ArrowDown"
            ? "down"
            : null;
        if (!direction || unavailable) return;
        const position = itemKeyboardPosition(items, itemId, direction);
        if (position === null) return;
        event.preventDefault();
        runReorder(itemId, position);
      },
    };
  }, [canMove, clearDrag, disabled, items, pending, runReorder]);

  const rowProps = useCallback((itemId: number): HTMLAttributes<HTMLDivElement> => ({
    onDragOver(event: DragEvent<HTMLDivElement>) {
      if (draggedId === null || disabled || pending) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      const placement: ItemDropPlacement = event.clientY < bounds.top + bounds.height / 2
        ? "before"
        : "after";
      if (itemDropPosition(items, draggedId, itemId, placement) === null) {
        setDropTarget(null);
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDropTarget({ id: itemId, placement });
    },
    onDragLeave(event: DragEvent<HTMLDivElement>) {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      setDropTarget((current) => current?.id === itemId ? null : current);
    },
    onDrop(event: DragEvent<HTMLDivElement>) {
      if (draggedId === null) return;
      const placement = dropTarget?.id === itemId ? dropTarget.placement : null;
      const position = placement === null
        ? null
        : itemDropPosition(items, draggedId, itemId, placement);
      clearDrag();
      if (position === null) return;
      event.preventDefault();
      runReorder(draggedId, position);
    },
  }), [clearDrag, disabled, draggedId, dropTarget, items, pending, runReorder]);

  const dropClassName = useCallback((itemId: number) => {
    if (dropTarget?.id !== itemId) return "";
    return `item-drop-${dropTarget.placement}`;
  }, [dropTarget]);

  return { dropClassName, selectionProps, rowProps };
}
