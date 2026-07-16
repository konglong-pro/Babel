"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MarkdownWritingGuidePanel,
  TypstReferencePanel,
  type ReferencePanelKind,
} from "@babel-apps/markdown/reference";

import {
  BEFORE_NAVIGATE_EVENT,
  type BeforeNavigateDetail,
} from "@/components/app-header";
import { EntryDetail, type EntryViewMode } from "@/components/entry-detail";
import { EntryList } from "@/components/entry-list";
import { FolderPanel } from "@/components/folder-panel";
import {
  createEntry,
  createFolder,
  deleteFolder,
  getEntry,
  getErrorMessage,
  listEntryBacklinks,
  listEntries,
  listFolders,
  updateFolder,
} from "@/lib/api-client";
import { entryUnitPath, entryWorkspaceHref } from "@/lib/entry-routes";
import { ENTRY_NOTES_MAX_BYTES } from "@/lib/entry-limits";
import {
  parseMarkdownImport,
  type MarkdownImportDraft,
} from "@/lib/markdown-import";
import type {
  EntryBacklinkDto,
  EntryDetailDto,
  EntrySummaryDto,
  EntryKind,
  FolderDto,
} from "@/lib/types";

type ResponsiveStage = "library" | "entries" | "entry";

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
  kind: EntryKind;
  initialFolderId?: number | null;
  initialEntryId?: number | null;
}

export function EntriesWorkspace({
  kind,
  initialFolderId = null,
  initialEntryId = null,
}: EntriesWorkspaceProps) {
  const [folders, setFolders] = useState<FolderDto[]>([]);
  const [entries, setEntries] = useState<EntrySummaryDto[]>([]);
  const [entryTotal, setEntryTotal] = useState(0);
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(
    initialFolderId,
  );
  const [selectedEntryId, setSelectedEntryId] = useState<number | null>(
    initialEntryId,
  );
  const [detail, setDetail] = useState<EntryDetailDto | null>(null);
  const [backlinks, setBacklinks] = useState<EntryBacklinkDto[]>([]);
  const [importDraft, setImportDraft] = useState<MarkdownImportDraft | null>(null);
  const [draftParentId, setDraftParentId] = useState<number | null>(null);
  const [draftVersion, setDraftVersion] = useState(0);
  const [mode, setMode] = useState<EntryViewMode>("view");
  const [stage, setStage] = useState<ResponsiveStage>(
    initialEntryId !== null ? "entry" : initialFolderId !== null ? "entries" : "library",
  );
  const [indexLoading, setIndexLoading] = useState(true);
  const [entryPageLoading, setEntryPageLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(initialEntryId !== null);
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
  const selectionVersionRef = useRef(0);
  const wikilinkCreatePendingRef = useRef(false);
  const exactFolderEntryRef = useRef<number | null>(
    initialEntryId !== null && initialFolderId === null ? initialEntryId : null,
  );
  const mountedRef = useRef(false);
  const selectedFolderIdRef = useRef(selectedFolderId);
  const importRequestVersionRef = useRef(0);
  const referenceTriggerRef = useRef<HTMLElement | null>(null);
  const [activeReferencePanel, setActiveReferencePanel] = useState<ReferencePanelKind | null>(null);

  const openReferencePanel = useCallback((panel: ReferencePanelKind) => {
    referenceTriggerRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setActiveReferencePanel(panel);
  }, []);

  const closeReferencePanel = useCallback(() => {
    setActiveReferencePanel(null);
    window.requestAnimationFrame(() => referenceTriggerRef.current?.focus());
  }, []);

  const invalidateImportRequest = useCallback(() => {
    importRequestVersionRef.current += 1;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      importRequestVersionRef.current += 1;
    };
  }, []);

  useEffect(() => {
    selectedFolderIdRef.current = selectedFolderId;
  }, [selectedFolderId]);

  const refreshEntries = useCallback(async (folderId: number | null) => {
    const requestId = ++indexRequestRef.current;
    const page = await listEntries({
      folderId: folderId ?? undefined,
      includeDescendants: true,
      kind,
      completeTree: true,
      limit: PAGE_LIMIT,
    });
    if (requestId !== indexRequestRef.current) return page;
    setEntries(page.items);
    setEntryTotal(page.total);
    return page;
  }, [kind]);

  const refreshIndex = useCallback(async (folderId: number | null) => {
    const requestId = ++indexRequestRef.current;
    const [nextFolders, page] = await Promise.all([
      listFolders(),
      listEntries({
        folderId: folderId ?? undefined,
        includeDescendants: true,
        kind,
        completeTree: true,
        limit: PAGE_LIMIT,
      }),
    ]);
    if (requestId !== indexRequestRef.current) return { folders: nextFolders, page };
    setFolders(nextFolders);
    setEntries(page.items);
    setEntryTotal(page.total);
    return { folders: nextFolders, page };
  }, [kind]);

  const setActiveEntryId = useCallback((
    id: number | null,
    exactFolder = false,
  ): number => {
    selectionVersionRef.current += 1;
    exactFolderEntryRef.current = id !== null && exactFolder ? id : null;
    setSelectedEntryId(id);
    return selectionVersionRef.current;
  }, []);

  const replaceLocation = useCallback((input: {
    folderId?: number | null;
    entryId?: number | null;
  }) => {
    const nextUrl = entryWorkspaceHref(kind, input);
    guardedUrlRef.current = nextUrl;
    window.history.replaceState(window.history.state, "", nextUrl);
  }, [kind]);

  const loadEntryList = useCallback(async (folderId: number | null) => {
    const requestId = ++indexRequestRef.current;
    setIndexLoading(true);
    try {
      const page = await listEntries({
        folderId: folderId ?? undefined,
        includeDescendants: true,
        kind,
        completeTree: true,
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
  }, [kind]);

  useEffect(() => {
    let active = true;
    const requestId = ++indexRequestRef.current;
    async function initialize() {
      try {
        const [nextFolders, entryPage] = await Promise.all([
          listFolders(),
          listEntries({
            folderId: initialFolderId ?? undefined,
            includeDescendants: true,
            kind,
            completeTree: true,
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
  }, [initialEntryId, initialFolderId, kind]);

  const selectedEntryIsListed = selectedEntryId !== null && entries.some(
    (entry) => entry.id === selectedEntryId,
  );
  useEffect(() => {
    if (indexLoading || selectedEntryId === null) return;
    if (detail?.id === selectedEntryId && detailRequestVersion === 0) return;

    let active = true;
    const selectionVersion = selectionVersionRef.current;
    Promise.all([getEntry(selectedEntryId), listEntryBacklinks(selectedEntryId)])
      .then(([nextDetail, nextBacklinks]) => {
        if (!active || selectionVersionRef.current !== selectionVersion) return;
        if (nextDetail.kind !== kind) {
          window.location.replace(entryWorkspaceHref(nextDetail.kind, {
            folderId: nextDetail.folderId,
            entryId: nextDetail.id,
          }));
          return;
        }
        const exactFolder = exactFolderEntryRef.current === selectedEntryId;
        exactFolderEntryRef.current = null;
        setDetail(nextDetail);
        setBacklinks(nextBacklinks);
        setDetailRequestVersion(0);
        setDetailLoading(false);
        if (exactFolder || !selectedEntryIsListed) {
          setSelectedFolderId(nextDetail.folderId);
          replaceLocation({ folderId: nextDetail.folderId, entryId: nextDetail.id });
          void loadEntryList(nextDetail.folderId);
        }
      })
      .catch((caught) => {
        if (!active || selectionVersionRef.current !== selectionVersion) return;
        setDetail(null);
        setBacklinks([]);
        setDetailError(getErrorMessage(caught));
        setDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    detail?.id,
    detailRequestVersion,
    indexLoading,
    kind,
    loadEntryList,
    replaceLocation,
    selectedEntryId,
    selectedEntryIsListed,
  ]);

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
    if (wikilinkCreatePendingRef.current) return false;
    if (!dirtyRef.current) return true;
    return window.confirm("Discard your unsaved changes?");
  }, []);

  const resetToLibraryRoot = useCallback(() => {
    invalidateImportRequest();
    setDirtyState(false);
    setSelectedFolderId(null);
    setActiveEntryId(null);
    setDetail(null);
    setBacklinks([]);
    setImportDraft(null);
    setDraftParentId(null);
    setDetailError("");
    setDetailLoading(false);
    setDetailRequestVersion(0);
    setMode("view");
    setStage("library");
  }, [invalidateImportRequest, setActiveEntryId, setDirtyState]);

  useEffect(() => {
    guardedUrlRef.current = currentRelativeUrl();
    guardEntryPresentRef.current = isGuardedHistoryState(window.history.state);

    function beforeUnload(event: BeforeUnloadEvent) {
      if (
        (!dirtyRef.current && !wikilinkCreatePendingRef.current) ||
        allowUnloadRef.current
      ) return;
      event.preventDefault();
      event.returnValue = true;
    }

    function beforeNavigate(event: Event) {
      if (!confirmDiscard()) {
        event.preventDefault();
        return;
      }

      const navigationEvent = event as CustomEvent<BeforeNavigateDetail>;
      if (navigationEvent.detail?.destination === entryUnitPath(kind)) resetToLibraryRoot();
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

      if (
        (dirtyRef.current || wikilinkCreatePendingRef.current) &&
        !confirmDiscard()
      ) {
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
    window.addEventListener(BEFORE_NAVIGATE_EVENT, beforeNavigate);
    window.addEventListener("popstate", popState, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener(BEFORE_NAVIGATE_EVENT, beforeNavigate);
      window.removeEventListener("popstate", popState, true);
      if (popFallbackTimerRef.current !== null) {
        window.clearTimeout(popFallbackTimerRef.current);
        popFallbackTimerRef.current = null;
      }
    };
  }, [confirmDiscard, kind, resetToLibraryRoot]);

  const folderMap = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder])),
    [folders],
  );

  async function loadMoreEntries() {
    if (entryPageLoading || entries.length >= entryTotal) return;
    const requestId = indexRequestRef.current;
    const folderId = selectedFolderId;
    setEntryPageLoading(true);
    try {
      const page = await listEntries({
        folderId: folderId ?? undefined,
        includeDescendants: true,
        kind,
        limit: PAGE_LIMIT,
        offset: entries.length,
      });
      if (
        requestId !== indexRequestRef.current ||
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

  function selectFolder(id: number | null) {
    if (!confirmDiscard()) return;
    invalidateImportRequest();
    setSelectedFolderId(id);
    setActiveEntryId(null);
    setDetail(null);
    setBacklinks([]);
    setImportDraft(null);
    setDraftParentId(null);
    setDetailError("");
    setDetailLoading(false);
    setDetailRequestVersion(0);
    setMode("view");
    setStage("entries");
    replaceLocation({ folderId: id, entryId: null });
    void loadEntryList(id);
  }

  function selectEntry(id: number, folderId?: number, exactFolder = false) {
    if (!confirmDiscard()) return;
    invalidateImportRequest();
    const folderChanged = folderId !== undefined && folderId !== selectedFolderId;
    if (folderChanged) {
      setSelectedFolderId(folderId);
      void loadEntryList(folderId);
    }
    setActiveEntryId(id, exactFolder && folderId === undefined);
    setDetail(null);
    setBacklinks([]);
    setImportDraft(null);
    setDraftParentId(null);
    setDetailError("");
    setDetailLoading(true);
    setDetailRequestVersion(0);
    setMode("view");
    setStage("entry");
    replaceLocation({ folderId: folderId ?? selectedFolderId, entryId: id });
  }

  function navigateEntry(
    id: number,
    targetKind: EntryKind,
    folderId?: number,
    exactFolder = false,
  ) {
    if (targetKind === kind) {
      selectEntry(id, folderId, exactFolder);
      return;
    }
    if (!confirmDiscard()) return;
    window.location.assign(entryWorkspaceHref(targetKind, {
      folderId,
      entryId: id,
    }));
  }

  async function handleCreateFolder(name: string, parentId: number | null) {
    if (!confirmDiscard()) return;
    const created = await createFolder({ name, parentId });
    await refreshIndex(created.id);
    setSelectedFolderId(created.id);
    setActiveEntryId(null);
    setDetail(null);
    setBacklinks([]);
    setImportDraft(null);
    setDraftParentId(null);
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
    setActiveEntryId(null);
    setDetail(null);
    setBacklinks([]);
    setImportDraft(null);
    setMode("view");
    setDetailLoading(false);
    setDetailRequestVersion(0);
    setStage("library");
    replaceLocation({ folderId: null, entryId: null });
  }

  async function handleSaved(saved: EntryDetailDto) {
    setDetail(saved);
    setBacklinks([]);
    setImportDraft(null);
    setDraftParentId(null);
    const selectionVersion = setActiveEntryId(saved.id);
    setSelectedFolderId(saved.folderId);
    setMode("view");
    setStage("entry");
    setDetailLoading(false);
    setDetailRequestVersion(0);
    setDirtyState(false);
    replaceLocation({ folderId: saved.folderId, entryId: saved.id });
    try {
      const [nextBacklinks] = await Promise.all([
        listEntryBacklinks(saved.id),
        refreshEntries(saved.folderId),
      ]);
      if (selectionVersionRef.current === selectionVersion) {
        setBacklinks(nextBacklinks);
      }
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  async function handleCreateWikilink(title: string, folderId: number) {
    if (wikilinkCreatePendingRef.current) return;
    if (!confirmDiscard()) return;

    wikilinkCreatePendingRef.current = true;
    saveActionRef.current = null;
    if (!guardEntryPresentRef.current) {
      guardedUrlRef.current = currentRelativeUrl();
      window.history.pushState(guardedHistoryState(), "", guardedUrlRef.current);
      guardEntryPresentRef.current = true;
    }
    setMode("view");
    setDraftParentId(null);
    setDirtyState(false);
    setDetailError("");
    setDetailLoading(true);
    setError("");
    try {
      const saved = await createEntry({
        folderId,
        parentId: null,
        kind,
        title,
        notesMd: "",
        code: kind === "snippet" ? "" : null,
        language: kind === "snippet" ? "text" : null,
        filename: null,
        tags: [],
      });
      await handleSaved(saved);
    } catch (caught) {
      setMode("view");
      setDetailLoading(false);
      setError(getErrorMessage(caught));
    } finally {
      wikilinkCreatePendingRef.current = false;
    }
  }

  async function handleDeleted() {
    setActiveEntryId(null);
    setDetail(null);
    setBacklinks([]);
    setDraftParentId(null);
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

  async function handleImportMarkdown(file: File) {
    if (kind !== "knowledge" || selectedFolderId === null) return;
    const requestVersion = importRequestVersionRef.current + 1;
    importRequestVersionRef.current = requestVersion;
    if (file.size > ENTRY_NOTES_MAX_BYTES) {
      setError("Markdown files must not exceed 10 MiB.");
      return;
    }
    if (!confirmDiscard()) return;
    const targetFolderId = selectedFolderId;

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (
        !mountedRef.current ||
        importRequestVersionRef.current !== requestVersion ||
        selectedFolderIdRef.current !== targetFolderId
      ) {
        return;
      }
      const draft = parseMarkdownImport(file.name, bytes);
      if (
        !mountedRef.current ||
        importRequestVersionRef.current !== requestVersion ||
        selectedFolderIdRef.current !== targetFolderId
      ) {
        return;
      }
      setError("");
      setSelectedFolderId(targetFolderId);
      setActiveEntryId(null);
      setDetail(null);
      setBacklinks([]);
      setImportDraft(draft);
      setDraftParentId(null);
      setDetailError("");
      setDetailLoading(false);
      setDetailRequestVersion(0);
      setDraftVersion((version) => version + 1);
      setMode("create");
      setStage("entry");
      replaceLocation({ folderId: targetFolderId, entryId: null });
    } catch (caught) {
      if (
        mountedRef.current &&
        importRequestVersionRef.current === requestVersion &&
        selectedFolderIdRef.current === targetFolderId
      ) {
        setError(getErrorMessage(caught));
      }
    }
  }

  function cancelEditing() {
    if (!confirmDiscard()) return;
    setImportDraft(null);
    setMode("view");
    if (!detail) setStage("entries");
  }

  function backToEntries() {
    if (!confirmDiscard()) return;
    setImportDraft(null);
    setMode("view");
    setStage("entries");
  }

  function beginCreateEntry(parentId: number | null) {
    if (!confirmDiscard()) return;
    invalidateImportRequest();
    const parent = parentId === null
      ? undefined
      : entries.find((entry) => entry.id === parentId);
    const folderId = parent?.folderId ?? selectedFolderId;
    if (
      folderId === null ||
      (parentId !== null && (!parent || parent.kind !== kind))
    ) return;
    setSelectedFolderId(folderId);
    setActiveEntryId(null);
    setDraftParentId(parentId);
    setDetail(null);
    setBacklinks([]);
    setImportDraft(null);
    setDetailError("");
    setDetailLoading(false);
    setDetailRequestVersion(0);
    setMode("create");
    setStage("entry");
    replaceLocation({ folderId, entryId: null });
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
        busy={indexLoading && folders.length === 0}
        activeReferencePanel={activeReferencePanel}
        onOpenMarkdownReference={() => openReferencePanel("markdown")}
        onOpenTypstReference={() => openReferencePanel("typst")}
        onSelect={selectFolder}
        onCreate={handleCreateFolder}
        onRename={handleRenameFolder}
        onMove={handleMoveFolder}
        onDelete={handleDeleteFolder}
      />

      <EntryList
        kind={kind}
        entries={entries}
        total={entryTotal}
        folders={folderMap}
        selectedFolderId={selectedFolderId}
        selectedEntryId={selectedEntryId}
        loading={indexLoading}
        loadingMore={entryPageLoading}
        referencePanelOpen={activeReferencePanel !== null}
        onSelect={selectEntry}
        onLoadMore={loadMoreEntries}
        onImport={kind === "knowledge" ? handleImportMarkdown : undefined}
        onCreate={() => beginCreateEntry(null)}
        onCreateChild={beginCreateEntry}
        onBack={() => setStage("library")}
      />

      {detailError ? (
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
          kind={kind}
          detail={detail}
          importDraft={importDraft}
          draftKey={draftVersion}
          mode={mode}
          folderId={detail?.folderId ?? selectedFolderId}
          parentId={mode === "create" ? draftParentId : detail?.parentId ?? null}
          folders={folders}
          entries={entries}
          backlinks={backlinks}
          loading={detailLoading}
          onEdit={() => setMode("edit")}
          onCancel={cancelEditing}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
          onNavigateEntry={navigateEntry}
          onCreateWikilink={handleCreateWikilink}
          onDirtyChange={setDirtyState}
          onRegisterSave={registerSave}
          onBack={backToEntries}
        />
      )}
      {activeReferencePanel === "markdown" ? (
        <MarkdownWritingGuidePanel onClose={closeReferencePanel} />
      ) : null}
      {activeReferencePanel === "typst" ? (
        <TypstReferencePanel onClose={closeReferencePanel} />
      ) : null}
    </div>
  );
}
