"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createFolder,
  deleteFolder,
  getErrorMessage,
  getExercise,
  getKnowledge,
  listExercises,
  listFolders,
  listKnowledge,
  updateFolder,
} from "@/lib/api-client";
import type {
  ExerciseDetailDto,
  ExerciseSummaryDto,
  FolderDto,
  FolderType,
  KnowledgeDetailDto,
  KnowledgeSummaryDto,
} from "@/lib/types";
import { ExerciseDetail } from "@/components/exercise-detail";
import { FolderPanel } from "@/components/folder-panel";
import { ItemList } from "@/components/item-list";
import { KnowledgeDetail } from "@/components/knowledge-detail";

type ArchiveSummary = KnowledgeSummaryDto | ExerciseSummaryDto;
type ArchiveDetail = KnowledgeDetailDto | ExerciseDetailDto;
type ViewMode = "view" | "edit" | "create";

interface ArchiveWorkspaceProps {
  type: FolderType;
  initialFolderId?: number | null;
  initialItemId?: number | null;
}

export function ArchiveWorkspace({
  type,
  initialFolderId = null,
  initialItemId = null,
}: ArchiveWorkspaceProps) {
  const [folders, setFolders] = useState<FolderDto[]>([]);
  const [items, setItems] = useState<ArchiveSummary[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(initialFolderId);
  const [selectedItemId, setSelectedItemId] = useState<number | null>(initialItemId);
  const [detail, setDetail] = useState<ArchiveDetail | null>(null);
  const [mode, setMode] = useState<ViewMode>("view");
  const [createParentId, setCreateParentId] = useState<number | null>(null);
  const [indexLoading, setIndexLoading] = useState(true);
  const [error, setError] = useState("");

  const basePath = type === "knowledge" ? "/knowledge" : "/exercise";

  const loadIndex = useCallback(async () => {
    const [nextFolders, nextItems] = await Promise.all([
      listFolders(type),
      type === "knowledge" ? listKnowledge() : listExercises(),
    ]);
    setFolders(nextFolders);
    setItems(nextItems);
  }, [type]);

  useEffect(() => {
    let active = true;
    Promise.all([
      listFolders(type),
      type === "knowledge" ? listKnowledge() : listExercises(),
    ])
      .then(([nextFolders, nextItems]) => {
        if (!active) return;
        setFolders(nextFolders);
        setItems(nextItems);
      })
      .catch((caught) => {
        if (active) setError(getErrorMessage(caught));
      })
      .finally(() => {
        if (active) setIndexLoading(false);
      });
    return () => {
      active = false;
    };
  }, [type]);

  useEffect(() => {
    if (selectedItemId === null) {
      return;
    }
    let active = true;
    const promise =
      type === "knowledge" ? getKnowledge(selectedItemId) : getExercise(selectedItemId);
    promise
      .then((nextDetail) => {
        if (active) setDetail(nextDetail);
      })
      .catch((caught) => {
        if (!active) return;
        setDetail(null);
        setError(getErrorMessage(caught));
      });
    return () => {
      active = false;
    };
  }, [selectedItemId, type]);

  const visibleItems = useMemo(() => {
    const filtered =
      selectedFolderId === null
        ? items
        : items.filter((item) => item.folderId === selectedFolderId);
    return [...filtered].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }, [items, selectedFolderId]);

  function replaceLocation(folderId: number | null, itemId: number | null) {
    const params = new URLSearchParams();
    if (folderId !== null) params.set("folder", String(folderId));
    if (itemId !== null) params.set("item", String(itemId));
    const query = params.toString();
    window.history.replaceState(null, "", query ? `${basePath}?${query}` : basePath);
  }

  function selectFolder(id: number | null) {
    setSelectedFolderId(id);
    setSelectedItemId(null);
    setDetail(null);
    setMode("view");
    setCreateParentId(null);
    replaceLocation(id, null);
  }

  function selectItem(id: number) {
    setSelectedItemId(id);
    setDetail(null);
    setError("");
    setMode("view");
    setCreateParentId(null);
    replaceLocation(selectedFolderId, id);
  }

  async function handleCreateFolder(name: string, parentId: number | null) {
    const created = await createFolder({ type, parentId, name });
    await loadIndex();
    setSelectedFolderId(created.id);
    setSelectedItemId(null);
    replaceLocation(created.id, null);
  }

  async function handleRenameFolder(id: number, name: string) {
    await updateFolder(id, { name });
    await loadIndex();
  }

  async function handleMoveFolder(id: number, parentId: number | null) {
    await updateFolder(id, { parentId });
    await loadIndex();
  }

  async function handleDeleteFolder(id: number) {
    await deleteFolder(id);
    setSelectedFolderId(null);
    setSelectedItemId(null);
    setDetail(null);
    await loadIndex();
    replaceLocation(null, null);
  }

  async function handleSaved(saved: ArchiveDetail) {
    setDetail(saved);
    setSelectedItemId(saved.id);
    setSelectedFolderId(saved.folderId);
    setMode("view");
    setCreateParentId(null);
    await loadIndex();
    replaceLocation(saved.folderId, saved.id);
  }

  async function handleDeleted() {
    setSelectedItemId(null);
    setDetail(null);
    setMode("view");
    setCreateParentId(null);
    await loadIndex();
    replaceLocation(selectedFolderId, null);
  }

  const effectiveFolderId = detail?.folderId ?? selectedFolderId;
  const detailLoading = selectedItemId !== null && detail?.id !== selectedItemId && !error;

  function beginCreate(parentId: number | null) {
    if (type === "knowledge" && parentId !== null) {
      const parent = (items as KnowledgeSummaryDto[]).find((item) => item.id === parentId);
      if (parent) {
        setSelectedFolderId(parent.folderId);
        replaceLocation(parent.folderId, null);
      }
    }
    setCreateParentId(type === "knowledge" ? parentId : null);
    setSelectedItemId(null);
    setDetail(null);
    setMode("create");
  }

  return (
    <div className="archive-workspace">
      <FolderPanel
        type={type}
        folders={folders}
        selectedId={selectedFolderId}
        busy={indexLoading}
        onSelect={selectFolder}
        onCreate={handleCreateFolder}
        onRename={handleRenameFolder}
        onMove={handleMoveFolder}
        onDelete={handleDeleteFolder}
      />
      <ItemList
        type={type}
        items={visibleItems}
        selectedId={selectedItemId}
        selectedFolderId={selectedFolderId}
        loading={indexLoading}
        onSelect={selectItem}
        onCreate={beginCreate}
      />

      {error ? (
        <section className="detail-panel error-state" role="alert">
          <span aria-hidden="true">!</span>
          <h2>Couldn’t Load the Archive</h2>
          <p>{error}</p>
          <button
            type="button"
            onClick={() => {
              setError("");
              setIndexLoading(true);
              loadIndex()
                .catch((caught) => setError(getErrorMessage(caught)))
                .finally(() => setIndexLoading(false));
            }}
          >
            Retry
          </button>
        </section>
      ) : type === "knowledge" ? (
        <KnowledgeDetail
          detail={detail as KnowledgeDetailDto | null}
          mode={mode}
          folderId={effectiveFolderId}
          pages={items as KnowledgeSummaryDto[]}
          createParentId={createParentId}
          loading={detailLoading}
          onEdit={() => setMode("edit")}
          onCreateChild={() => beginCreate(detail?.id ?? null)}
          onCancel={() => setMode("view")}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
        />
      ) : (
        <ExerciseDetail
          detail={detail as ExerciseDetailDto | null}
          mode={mode}
          folderId={effectiveFolderId}
          loading={detailLoading}
          onEdit={() => setMode("edit")}
          onCancel={() => setMode("view")}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  );
}
