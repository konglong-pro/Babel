"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  BEFORE_NAVIGATE_EVENT,
  type BeforeNavigateDetail,
} from "@/components/app-header";
import { EntryDetail, type EntryViewMode } from "@/components/entry-detail";
import { EntryList } from "@/components/entry-list";
import { FolderPanel } from "@/components/folder-panel";
import { TrashDetail, TrashList } from "@/components/trash-panel";
import {
  ApiError,
  createFolder,
  deleteFolder,
  getEntry,
  getErrorMessage,
  getTrashEntry,
  listEntries,
  listFolders,
  listTrash,
  permanentlyDeleteTrashEntry,
  restoreTrashEntry,
  updateFolder,
} from "@/lib/api-client";
import type { EntryDetailDto, EntrySummaryDto, FolderDto, TrashEntryDto } from "@/lib/types";

type ResponsiveStage = "library" | "entries" | "entry";
type WorkspaceView = "library" | "trash";

const HISTORY_GUARD_KEY = "__neumDirtyGuard";
const PAGE_LIMIT = 100;

function currentRelativeUrl(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function guardedHistoryState(): Record<string, unknown> {
  const current = window.history.state;
  const state = current && typeof current === "object"
    ? (current as Record<string, unknown>)
    : {};
  return { ...state, [HISTORY_GUARD_KEY]: true };
}

function isGuardedHistoryState(value: unknown): boolean {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as Record<string, unknown>)[HISTORY_GUARD_KEY],
  );
}

interface EntriesWorkspaceProps {
  initialFolderId?: number | null;
  initialEntryId?: number | null;
  initialTrash?: boolean;
  initialTrashId?: number | null;
}

export function EntriesWorkspace({
  initialFolderId = null,
  initialEntryId = null,
  initialTrash = false,
  initialTrashId = null,
}: EntriesWorkspaceProps) {
  const [folders, setFolders] = useState<FolderDto[]>([]);
  const [entries, setEntries] = useState<EntrySummaryDto[]>([]);
  const [entryTotal, setEntryTotal] = useState(0);
  const [trashItems, setTrashItems] = useState<TrashEntryDto[]>([]);
  const [trashTotal, setTrashTotal] = useState(0);
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(
    initialTrash ? null : initialFolderId,
  );
  const [selectedEntryId, setSelectedEntryId] = useState<number | null>(
    initialTrash ? null : initialEntryId,
  );
  const [selectedTrash, setSelectedTrash] = useState<TrashEntryDto | null>(null);
  const [detail, setDetail] = useState<EntryDetailDto | null>(null);
  const [mode, setMode] = useState<EntryViewMode>("view");
  const [view, setView] = useState<WorkspaceView>(initialTrash ? "trash" : "library");
  const [stage, setStage] = useState<ResponsiveStage>(
    initialTrash
      ? initialTrashId === null ? "entries" : "entry"
      : initialEntryId !== null ? "entry" : initialFolderId !== null ? "entries" : "library",
  );
  const [indexLoading, setIndexLoading] = useState(true);
  const [entryPageLoading, setEntryPageLoading] = useState(false);
  const [trashPageLoading, setTrashPageLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(!initialTrash && initialEntryId !== null);
  const [detailRequestVersion, setDetailRequestVersion] = useState(0);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const saveActionRef = useRef<(() => void) | null>(null);
  const guardedUrlRef = useRef("");
  const guardEntryPresentRef = useRef(false);
  const allowNextPopRef = useRef(false);
  const allowUnloadRef = useRef(false);
  const popFallbackTimerRef = useRef<number | null>(null);
  const indexRequestRef = useRef(0);

  const refreshEntries = useCallback(async (folderId: number | null) => {
    const requestId = ++indexRequestRef.current;
    const page = await listEntries({
      folderId: folderId ?? undefined,
      includeDescendants: true,
      limit: PAGE_LIMIT,
    });
    if (requestId !== indexRequestRef.current) return page;
    setEntries(page.items);
    setEntryTotal(page.total);
    return page;
  }, []);

  const refreshIndex = useCallback(async (folderId: number | null) => {
    const requestId = ++indexRequestRef.current;
    const [nextFolders, page] = await Promise.all([
      listFolders(),
      listEntries({
        folderId: folderId ?? undefined,
        includeDescendants: true,
        limit: PAGE_LIMIT,
      }),
    ]);
    if (requestId !== indexRequestRef.current) return { folders: nextFolders, page };
    setFolders(nextFolders);
    setEntries(page.items);
    setEntryTotal(page.total);
    return { folders: nextFolders, page };
  }, []);

  const refreshTrash = useCallback(async () => {
    const requestId = ++indexRequestRef.current;
    const page = await listTrash({ limit: PAGE_LIMIT });
    if (requestId !== indexRequestRef.current) return page;
    setTrashItems(page.items);
    setTrashTotal(page.total);
    return page;
  }, []);

  useEffect(() => {
    let active = true;
    const requestId = ++indexRequestRef.current;
    async function initialize() {
      try {
        if (initialTrash) {
          const [nextFolders, trashPage, initialTrashDetail] = await Promise.all([
            listFolders(),
            listTrash({ limit: PAGE_LIMIT }),
            initialTrashId === null
              ? Promise.resolve(null)
              : getTrashEntry(initialTrashId).catch((caught: unknown) => {
                  if (caught instanceof ApiError && caught.status === 404) return null;
                  throw caught;
                }),
          ]);
          if (!active || requestId !== indexRequestRef.current) return;
          setFolders(nextFolders);
          setTrashItems(trashPage.items);
          setTrashTotal(trashPage.total);
          setSelectedTrash(initialTrashDetail);
          if (initialTrashId !== null && initialTrashDetail === null) {
            setStage("entries");
            window.history.replaceState(window.history.state, "", "/entries?view=trash");
          }
        } else {
          const [nextFolders, entryPage] = await Promise.all([
            listFolders(),
            listEntries({
              folderId: initialFolderId ?? undefined,
              includeDescendants: true,
              limit: PAGE_LIMIT,
            }),
          ]);
          if (!active || requestId !== indexRequestRef.current) return;
          setFolders(nextFolders);
          setEntries(entryPage.items);
          setEntryTotal(entryPage.total);
          if (
            initialFolderId !== null &&
            !nextFolders.some((folder) => folder.id === initialFolderId)
          ) {
            setSelectedFolderId(null);
            setStage(initialEntryId !== null ? "entry" : "library");
          }
        }
      } catch (caught) {
        if (active) setError(getErrorMessage(caught));
      } finally {
        if (active) setIndexLoading(false);
      }
    }
    void initialize();
    return () => {
      active = false;
    };
  }, [initialEntryId, initialFolderId, initialTrash, initialTrashId]);

  useEffect(() => {
    if (view !== "library" || selectedEntryId === null) return;
    if (detail?.id === selectedEntryId && detailRequestVersion === 0) return;

    let active = true;
    getEntry(selectedEntryId)
      .then((nextDetail) => {
        if (!active) return;
        setDetail(nextDetail);
        setDetailRequestVersion(0);
      })
      .catch((caught) => {
        if (!active) return;
        setDetail(null);
        setDetailError(getErrorMessage(caught));
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [detail?.id, detailRequestVersion, selectedEntryId, view]);

  const setDirtyState = useCallback((nextDirty: boolean) => {
    dirtyRef.current = nextDirty;
    setDirty(nextDirty);

    if (nextDirty && !guardEntryPresentRef.current) {
      guardedUrlRef.current = currentRelativeUrl();
      window.history.pushState(guardedHistoryState(), "", guardedUrlRef.current);
      guardEntryPresentRef.current = true;
    }
  }, []);

  const registerSave = useCallback((action: (() => void) | null) => {
    saveActionRef.current = action;
  }, []);

  const confirmDiscard = useCallback((): boolean => {
    if (!dirtyRef.current) return true;
    return window.confirm("Discard your unsaved changes?");
  }, []);

  const resetToLibraryRoot = useCallback(() => {
    setDirtyState(false);
    setView("library");
    setSelectedFolderId(null);
    setSelectedEntryId(null);
    setSelectedTrash(null);
    setDetail(null);
    setDetailError("");
    setDetailLoading(false);
    setDetailRequestVersion(0);
    setMode("view");
    setStage("library");
  }, [setDirtyState]);

  useEffect(() => {
    guardedUrlRef.current = currentRelativeUrl();
    guardEntryPresentRef.current = isGuardedHistoryState(window.history.state);

    function beforeUnload(event: BeforeUnloadEvent) {
      if (!dirtyRef.current || allowUnloadRef.current) return;
      event.preventDefault();
      event.returnValue = true;
    }

    function saveShortcut(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLocaleLowerCase() !== "s") return;
      if (!saveActionRef.current) return;
      event.preventDefault();
      saveActionRef.current();
    }

    function beforeNavigate(event: Event) {
      if (!confirmDiscard()) {
        event.preventDefault();
        return;
      }

      const navigationEvent = event as CustomEvent<BeforeNavigateDetail>;
      if (navigationEvent.detail?.destination === "/entries") resetToLibraryRoot();
    }

    function popState(event: PopStateEvent) {
      if (allowNextPopRef.current) {
        allowNextPopRef.current = false;
        allowUnloadRef.current = false;
        if (popFallbackTimerRef.current !== null) {
          window.clearTimeout(popFallbackTimerRef.current);
          popFallbackTimerRef.current = null;
        }
        return;
      }

      if (!guardEntryPresentRef.current) return;
      event.stopImmediatePropagation();

      if (dirtyRef.current && !confirmDiscard()) {
        window.history.pushState(guardedHistoryState(), "", guardedUrlRef.current);
        guardEntryPresentRef.current = true;
        return;
      }

      guardEntryPresentRef.current = false;
      allowNextPopRef.current = true;
      allowUnloadRef.current = dirtyRef.current;
      window.history.back();

      popFallbackTimerRef.current = window.setTimeout(() => {
        if (!allowNextPopRef.current) return;
        allowNextPopRef.current = false;
        allowUnloadRef.current = false;
        window.history.pushState(guardedHistoryState(), "", guardedUrlRef.current);
        guardEntryPresentRef.current = true;
        popFallbackTimerRef.current = null;
      }, 500);
    }

    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("keydown", saveShortcut);
    window.addEventListener(BEFORE_NAVIGATE_EVENT, beforeNavigate);
    window.addEventListener("popstate", popState, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("keydown", saveShortcut);
      window.removeEventListener(BEFORE_NAVIGATE_EVENT, beforeNavigate);
      window.removeEventListener("popstate", popState, true);
      if (popFallbackTimerRef.current !== null) {
        window.clearTimeout(popFallbackTimerRef.current);
        popFallbackTimerRef.current = null;
      }
    };
  }, [confirmDiscard, resetToLibraryRoot]);

  const folderMap = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder])),
    [folders],
  );

  function replaceLocation(input: {
    folderId?: number | null;
    entryId?: number | null;
    trashId?: number | null;
  }) {
    const params = new URLSearchParams();
    if (input.trashId !== undefined) {
      params.set("view", "trash");
      if (input.trashId !== null) params.set("trash", String(input.trashId));
    } else {
      if (input.folderId !== null && input.folderId !== undefined) {
        params.set("folder", String(input.folderId));
      }
      if (input.entryId !== null && input.entryId !== undefined) {
        params.set("entry", String(input.entryId));
      }
    }
    const query = params.toString();
    const nextUrl = query ? `/entries?${query}` : "/entries";
    guardedUrlRef.current = nextUrl;
    window.history.replaceState(window.history.state, "", nextUrl);
  }

  async function loadEntryList(folderId: number | null) {
    const requestId = ++indexRequestRef.current;
    setIndexLoading(true);
    try {
      const page = await listEntries({
        folderId: folderId ?? undefined,
        includeDescendants: true,
        limit: PAGE_LIMIT,
      });
      if (requestId !== indexRequestRef.current) return;
      setEntries(page.items);
      setEntryTotal(page.total);
    } catch (caught) {
      if (requestId === indexRequestRef.current) setError(getErrorMessage(caught));
    } finally {
      if (requestId === indexRequestRef.current) setIndexLoading(false);
    }
  }

  async function loadMoreEntries() {
    if (entryPageLoading || entries.length >= entryTotal) return;
    const requestId = indexRequestRef.current;
    const folderId = selectedFolderId;
    setEntryPageLoading(true);
    try {
      const page = await listEntries({
        folderId: folderId ?? undefined,
        includeDescendants: true,
        limit: PAGE_LIMIT,
        offset: entries.length,
      });
      if (
        requestId !== indexRequestRef.current ||
        view !== "library" ||
        selectedFolderId !== folderId
      ) return;
      setEntries((current) => {
        const existing = new Set(current.map(({ id }) => id));
        return [...current, ...page.items.filter(({ id }) => !existing.has(id))];
      });
      setEntryTotal(page.total);
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setEntryPageLoading(false);
    }
  }

  async function loadMoreTrash() {
    if (trashPageLoading || trashItems.length >= trashTotal) return;
    const requestId = indexRequestRef.current;
    setTrashPageLoading(true);
    try {
      const page = await listTrash({ limit: PAGE_LIMIT, offset: trashItems.length });
      if (requestId !== indexRequestRef.current || view !== "trash") return;
      setTrashItems((current) => {
        const existing = new Set(current.map(({ trashId }) => trashId));
        return [
          ...current,
          ...page.items.filter(({ trashId }) => !existing.has(trashId)),
        ];
      });
      setTrashTotal(page.total);
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setTrashPageLoading(false);
    }
  }

  function selectFolder(id: number | null) {
    if (!confirmDiscard()) return;
    setView("library");
    setSelectedFolderId(id);
    setSelectedEntryId(null);
    setSelectedTrash(null);
    setDetail(null);
    setDetailError("");
    setDetailLoading(false);
    setDetailRequestVersion(0);
    setMode("view");
    setStage("entries");
    replaceLocation({ folderId: id, entryId: null });
    void loadEntryList(id);
  }

  function selectEntry(id: number) {
    if (!confirmDiscard()) return;
    setSelectedEntryId(id);
    setDetail(null);
    setDetailError("");
    setDetailLoading(true);
    setDetailRequestVersion(0);
    setMode("view");
    setStage("entry");
    replaceLocation({ folderId: selectedFolderId, entryId: id });
  }

  async function openTrash() {
    if (!confirmDiscard()) return;
    setView("trash");
    setSelectedFolderId(null);
    setSelectedEntryId(null);
    setSelectedTrash(null);
    setDetail(null);
    setMode("view");
    setStage("entries");
    setIndexLoading(true);
    replaceLocation({ trashId: null });
    try {
      await refreshTrash();
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setIndexLoading(false);
    }
  }

  async function handleCreateFolder(name: string, parentId: number | null) {
    if (!confirmDiscard()) return;
    const created = await createFolder({ name, parentId });
    await refreshIndex(created.id);
    setView("library");
    setSelectedFolderId(created.id);
    setSelectedEntryId(null);
    setSelectedTrash(null);
    setDetail(null);
    setMode("view");
    setDetailLoading(false);
    setDetailRequestVersion(0);
    setStage("entries");
    replaceLocation({ folderId: created.id, entryId: null });
  }

  async function handleRenameFolder(id: number, name: string) {
    await updateFolder(id, { name });
    setFolders(await listFolders());
  }

  async function handleMoveFolder(id: number, parentId: number | null) {
    await updateFolder(id, { parentId });
    setFolders(await listFolders());
  }

  async function handleDeleteFolder(id: number) {
    if (!confirmDiscard()) return;
    await deleteFolder(id);
    await refreshIndex(null);
    setSelectedFolderId(null);
    setSelectedEntryId(null);
    setDetail(null);
    setMode("view");
    setDetailLoading(false);
    setDetailRequestVersion(0);
    setStage("library");
    replaceLocation({ folderId: null, entryId: null });
  }

  async function handleSaved(saved: EntryDetailDto) {
    setDetail(saved);
    setSelectedEntryId(saved.id);
    setSelectedFolderId(saved.folderId);
    setMode("view");
    setStage("entry");
    setDetailLoading(false);
    setDetailRequestVersion(0);
    setDirtyState(false);
    replaceLocation({ folderId: saved.folderId, entryId: saved.id });
    try {
      await refreshEntries(saved.folderId);
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  async function handleDeleted() {
    setSelectedEntryId(null);
    setDetail(null);
    setMode("view");
    setStage("entries");
    setDetailLoading(false);
    setDetailRequestVersion(0);
    replaceLocation({ folderId: selectedFolderId, entryId: null });
    try {
      await refreshEntries(selectedFolderId);
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  function selectTrash(item: TrashEntryDto) {
    setSelectedTrash(item);
    setStage("entry");
    replaceLocation({ trashId: item.trashId });
  }

  async function handleRestore(item: TrashEntryDto) {
    const restored = await restoreTrashEntry(item.trashId);
    setView("library");
    setSelectedTrash(null);
    setSelectedFolderId(restored.folderId);
    setSelectedEntryId(restored.id);
    setDetail(restored);
    setMode("view");
    setStage("entry");
    replaceLocation({ folderId: restored.folderId, entryId: restored.id });
    try {
      await refreshIndex(restored.folderId);
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  async function handlePermanentlyDelete(item: TrashEntryDto) {
    await permanentlyDeleteTrashEntry(item.trashId);
    setSelectedTrash(null);
    setStage("entries");
    replaceLocation({ trashId: null });
    await refreshTrash();
  }

  function cancelEditing() {
    if (!confirmDiscard()) return;
    setMode("view");
    if (!detail) setStage("entries");
  }

  function backToEntries() {
    if (!confirmDiscard()) return;
    setMode("view");
    setStage("entries");
  }

  return (
    <div className={`entries-workspace stage-${stage}${dirty ? " has-unsaved" : ""}`}>
      {error ? (
        <div className="workspace-alert" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError("")}>Dismiss</button>
        </div>
      ) : null}

      <FolderPanel
        folders={folders}
        selectedId={selectedFolderId}
        trashActive={view === "trash"}
        busy={indexLoading && folders.length === 0}
        onSelect={selectFolder}
        onOpenTrash={openTrash}
        onCreate={handleCreateFolder}
        onRename={handleRenameFolder}
        onMove={handleMoveFolder}
        onDelete={handleDeleteFolder}
      />

      {view === "library" ? (
        <EntryList
          entries={entries}
          total={entryTotal}
          folders={folderMap}
          selectedFolderId={selectedFolderId}
          selectedEntryId={selectedEntryId}
          loading={indexLoading}
          loadingMore={entryPageLoading}
          onSelect={selectEntry}
          onLoadMore={loadMoreEntries}
          onCreate={() => {
            if (selectedFolderId === null || !confirmDiscard()) return;
            setSelectedEntryId(null);
            setDetail(null);
            setDetailError("");
            setDetailLoading(false);
            setDetailRequestVersion(0);
            setMode("create");
            setStage("entry");
            replaceLocation({ folderId: selectedFolderId, entryId: null });
          }}
          onBack={() => setStage("library")}
        />
      ) : (
        <TrashList
          items={trashItems}
          total={trashTotal}
          selectedTrashId={selectedTrash?.trashId ?? null}
          loading={indexLoading}
          loadingMore={trashPageLoading}
          onSelect={selectTrash}
          onLoadMore={loadMoreTrash}
          onBack={() => setStage("library")}
        />
      )}

      {view === "trash" ? (
        <TrashDetail
          key={selectedTrash?.trashId ?? "empty"}
          item={selectedTrash}
          onRestore={handleRestore}
          onPermanentlyDelete={handlePermanentlyDelete}
          onBack={backToEntries}
        />
      ) : detailError ? (
        <section className="detail-panel error-state" role="alert">
          <button className="content-back" type="button" onClick={backToEntries}>← Entries</button>
          <span aria-hidden="true">!</span>
          <h2>Could not load this entry</h2>
          <p>{detailError}</p>
          <button
            type="button"
            onClick={() => {
              setDetailError("");
              setDetailLoading(true);
              setDetailRequestVersion((version) => version + 1);
            }}
          >
            Retry
          </button>
        </section>
      ) : (
        <EntryDetail
          detail={detail}
          mode={mode}
          folderId={detail?.folderId ?? selectedFolderId}
          folders={folders}
          loading={detailLoading}
          onEdit={() => setMode("edit")}
          onCancel={cancelEditing}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
          onDirtyChange={setDirtyState}
          onRegisterSave={registerSave}
          onBack={backToEntries}
        />
      )}
    </div>
  );
}
