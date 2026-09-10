"use client";

import {
  createContext,
  type DragEvent,
  type ReactNode,
  useContext,
  useRef,
  useState,
} from "react";
import { canMoveFolderItem, folderItemMime, parseFolderItemDrag, type FolderItemDrag, type FolderMoveItem } from "./move";

interface FolderMoveContextValue {
  busy: boolean;
  active: boolean;
  targetId: number | null;
  canDrag: (itemId: number) => boolean;
  startDrag: (itemId: number, event: DragEvent) => void;
  clearDrag: () => void;
  dragOver: (folderId: number, event: DragEvent) => void;
  dragLeave: (folderId: number) => void;
  drop: (folderId: number, event: DragEvent) => void;
}

const FolderMoveContext = createContext<FolderMoveContextValue | null>(null);

export interface FolderMoveProviderProps {
  scope: string;
  items: readonly FolderMoveItem[];
  folderIds: readonly number[];
  disabled?: boolean;
  onMove: (itemId: number, targetFolderId: number) => Promise<void>;
  children: ReactNode;
}

export function FolderMoveProvider({ scope, items, folderIds, disabled = false, onMove, children }: FolderMoveProviderProps) {
  const [drag, setDrag] = useState<FolderItemDrag | null>(null);
  const [targetId, setTargetId] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const canDrop = (folderId: number) => !disabled && !pendingRef.current &&
    canMoveFolderItem(drag, scope, items, folderIds, folderId);

  function clearDrag() {
    setDrag(null);
    setTargetId(null);
  }

  const value: FolderMoveContextValue = {
    busy: disabled || pending,
    active: drag !== null,
    targetId,
    canDrag: (itemId) => !disabled && !pending && items.some(({ id }) => id === itemId),
    startDrag(itemId, event) {
      const item = items.find(({ id }) => id === itemId);
      if (disabled || pendingRef.current || !item) return;
      const next = { id: item.id, folderId: item.folderId, scope };
      event.dataTransfer.setData(folderItemMime, JSON.stringify(next));
      setDrag(next);
      setTargetId(null);
      setNotice(null);
    },
    clearDrag,
    dragOver(folderId, event) {
      if (!canDrop(folderId) || !event.dataTransfer.types.includes(folderItemMime)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      setTargetId(folderId);
    },
    dragLeave(folderId) {
      setTargetId((current) => current === folderId ? null : current);
    },
    drop(folderId, event) {
      const transferred = parseFolderItemDrag(event.dataTransfer.getData(folderItemMime));
      const accepted = canDrop(folderId) && transferred?.id === drag?.id &&
        canMoveFolderItem(transferred, scope, items, folderIds, folderId);
      clearDrag();
      if (!accepted || !transferred) return;
      event.preventDefault();
      event.stopPropagation();
      pendingRef.current = true;
      setPending(true);
      setNotice({ error: false, text: "Moving to folder…" });
      void Promise.resolve().then(() => onMove(transferred.id, folderId)).then(() => {
        setNotice({ error: false, text: "Moved to folder." });
      }).catch((error: unknown) => {
        setNotice({ error: true, text: error instanceof Error ? error.message : "Could not move this item. Try again." });
      }).finally(() => {
        pendingRef.current = false;
        setPending(false);
      });
    },
  };

  return (
    <FolderMoveContext.Provider value={value}>
      {children}
      {notice ? (
        <div className={notice.error ? "folder-move-error" : "folder-move-status"} role={notice.error ? "alert" : "status"}>
          <span>{notice.text}</span>
          {!pending ? <button type="button" aria-label="Dismiss move notification" onClick={() => setNotice(null)}>×</button> : null}
        </div>
      ) : null}
    </FolderMoveContext.Provider>
  );
}

export function useFolderMove() {
  return useContext(FolderMoveContext);
}
