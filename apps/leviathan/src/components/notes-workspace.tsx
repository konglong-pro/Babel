"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  BEFORE_NAVIGATE_EVENT,
  type BeforeNavigateDetail,
} from "@/components/app-header";
import { FolderPanel } from "@/components/folder-panel";
import { NoteDetail, type NoteViewMode } from "@/components/note-detail";
import { NoteList } from "@/components/note-list";
import {
  createNote,
  createFolder,
  deleteFolder,
  getErrorMessage,
  getNote,
  listBacklinks,
  listFolders,
  listNotes,
  updateFolder,
} from "@/lib/api-client";
import {
  parseMarkdownImport,
  type MarkdownImportDraft,
} from "@/lib/markdown-import";
import { NOTE_CONTENT_MAX_BYTES } from "@/lib/note-limits";
import type {
  BacklinkDto,
  FolderDto,
  NoteDetailDto,
  NoteSummaryDto,
} from "@/lib/types";

type ResponsiveStage = "library" | "notes" | "note";

const HISTORY_GUARD_KEY = "__leviathanDirtyGuard";

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

interface NotesWorkspaceProps {
  initialFolderId?: number | null;
  initialNoteId?: number | null;
}

function subtreeIds(rootId: number, folders: readonly FolderDto[]): Set<number> {
  const grouped = new Map<number | null, number[]>();
  for (const folder of folders) {
    const children = grouped.get(folder.parentId) ?? [];
    children.push(folder.id);
    grouped.set(folder.parentId, children);
  }

  const ids = new Set([rootId]);
  const stack = [rootId];
  while (stack.length) {
    const current = stack.pop();
    if (current === undefined) continue;
    for (const childId of grouped.get(current) ?? []) {
      if (ids.has(childId)) continue;
      ids.add(childId);
      stack.push(childId);
    }
  }
  return ids;
}

function newestFirst(a: NoteSummaryDto, b: NoteSummaryDto): number {
  const timeDifference = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  return timeDifference || a.title.localeCompare(b.title, "en-US") || a.id - b.id;
}

export function NotesWorkspace({
  initialFolderId = null,
  initialNoteId = null,
}: NotesWorkspaceProps) {
  const [folders, setFolders] = useState<FolderDto[]>([]);
  const [notes, setNotes] = useState<NoteSummaryDto[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(initialFolderId);
  const [selectedNoteId, setSelectedNoteId] = useState<number | null>(initialNoteId);
  const [detail, setDetail] = useState<NoteDetailDto | null>(null);
  const [backlinks, setBacklinks] = useState<BacklinkDto[]>([]);
  const [importDraft, setImportDraft] = useState<MarkdownImportDraft | null>(null);
  const [draftParentId, setDraftParentId] = useState<number | null>(null);
  const [draftVersion, setDraftVersion] = useState(0);
  const [mode, setMode] = useState<NoteViewMode>("view");
  const [stage, setStage] = useState<ResponsiveStage>(
    initialNoteId !== null ? "note" : initialFolderId !== null ? "notes" : "library",
  );
  const [indexLoading, setIndexLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(initialNoteId !== null);
  const [detailRequestVersion, setDetailRequestVersion] = useState(0);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [dirty, setDirty] = useState(false);
  const selectionVersionRef = useRef(0);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const mountedRef = useRef(false);
  const selectedFolderIdRef = useRef(selectedFolderId);
  const importRequestVersionRef = useRef(0);
  const wikilinkCreateGenerationRef = useRef(0);
  const wikilinkCreatePendingRef = useRef(false);
  const saveActionRef = useRef<(() => void) | null>(null);
  const guardedUrlRef = useRef("");
  const guardEntryPresentRef = useRef(false);
  const allowNextPopRef = useRef(false);
  const allowUnloadRef = useRef(false);
  const popFallbackTimerRef = useRef<number | null>(null);

  const invalidateImportRequest = useCallback(() => {
    importRequestVersionRef.current += 1;
  }, []);

  const invalidateWikilinkCreate = useCallback(() => {
    wikilinkCreateGenerationRef.current += 1;
  }, []);

  const setSavingState = useCallback((saving: boolean) => {
    savingRef.current = saving;
    if (saving && !guardEntryPresentRef.current) {
      guardedUrlRef.current = currentRelativeUrl();
      window.history.pushState(
        guardedHistoryState(),
        "",
        guardedUrlRef.current,
      );
      guardEntryPresentRef.current = true;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      importRequestVersionRef.current += 1;
      invalidateWikilinkCreate();
      selectionVersionRef.current += 1;
    };
  }, [invalidateWikilinkCreate]);

  useEffect(() => {
    selectedFolderIdRef.current = selectedFolderId;
  }, [selectedFolderId]);

  const refreshIndex = useCallback(async () => {
    const [nextFolders, nextNotes] = await Promise.all([listFolders(), listNotes()]);
    setFolders(nextFolders);
    setNotes(nextNotes);
    return { folders: nextFolders, notes: nextNotes };
  }, []);

  const setActiveNoteId = useCallback((id: number | null): number => {
    invalidateWikilinkCreate();
    selectionVersionRef.current += 1;
    setSelectedNoteId(id);
    return selectionVersionRef.current;
  }, [invalidateWikilinkCreate]);

  useEffect(() => {
    let active = true;
    Promise.all([listFolders(), listNotes()])
      .then(([nextFolders, nextNotes]) => {
        if (!active) return;
        setFolders(nextFolders);
        setNotes(nextNotes);
        if (
          initialFolderId !== null &&
          !nextFolders.some((folder) => folder.id === initialFolderId)
        ) {
          invalidateImportRequest();
          invalidateWikilinkCreate();
          selectedFolderIdRef.current = null;
          setSelectedFolderId(null);
          setStage(initialNoteId !== null ? "note" : "library");
        }
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
  }, [
    initialFolderId,
    initialNoteId,
    invalidateImportRequest,
    invalidateWikilinkCreate,
  ]);

  useEffect(() => {
    if (selectedNoteId === null) return;
    if (detail?.id === selectedNoteId && detailRequestVersion === 0) return;

    let active = true;
    Promise.all([getNote(selectedNoteId), listBacklinks(selectedNoteId)])
      .then(([nextDetail, nextBacklinks]) => {
        if (!active) return;
        setDetail(nextDetail);
        setBacklinks(nextBacklinks);
        setDetailRequestVersion(0);
      })
      .catch((caught) => {
        if (!active) return;
        setDetail(null);
        setBacklinks([]);
        setDetailError(getErrorMessage(caught));
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [detail?.id, detailRequestVersion, selectedNoteId]);

  const setDirtyState = useCallback((nextDirty: boolean) => {
    dirtyRef.current = nextDirty;
    setDirty(nextDirty);

    if (nextDirty && !guardEntryPresentRef.current) {
      guardedUrlRef.current = currentRelativeUrl();
      window.history.pushState(
        guardedHistoryState(),
        "",
        guardedUrlRef.current,
      );
      guardEntryPresentRef.current = true;
    }
  }, []);

  const registerSave = useCallback((action: (() => void) | null) => {
    saveActionRef.current = action;
  }, []);

  const confirmDiscard = useCallback((): boolean => {
    if (savingRef.current || wikilinkCreatePendingRef.current) {
      window.alert("Please wait for the note to finish saving.");
      return false;
    }
    if (!dirtyRef.current) return true;
    return window.confirm("Discard your unsaved changes?");
  }, []);

  const resetToLibraryRoot = useCallback(() => {
    invalidateImportRequest();
    selectedFolderIdRef.current = null;
    setDirtyState(false);
    setSelectedFolderId(null);
    setActiveNoteId(null);
    setDetail(null);
    setBacklinks([]);
    setImportDraft(null);
    setDraftParentId(null);
    setDetailError("");
    setDetailLoading(false);
    setDetailRequestVersion(0);
    setMode("view");
    setStage("library");
  }, [invalidateImportRequest, setActiveNoteId, setDirtyState]);

  useEffect(() => {
    guardedUrlRef.current = currentRelativeUrl();
    guardEntryPresentRef.current = isGuardedHistoryState(window.history.state);

    function beforeUnload(event: BeforeUnloadEvent) {
      if (
        (!dirtyRef.current &&
          !savingRef.current &&
          !wikilinkCreatePendingRef.current) ||
        allowUnloadRef.current
      ) return;
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

      invalidateImportRequest();
      invalidateWikilinkCreate();
      const navigationEvent = event as CustomEvent<BeforeNavigateDetail>;
      if (navigationEvent.detail?.destination === "/notes") resetToLibraryRoot();
    }

    function popState(event: PopStateEvent) {
      invalidateImportRequest();
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

      // The first Back only leaves our same-URL sentinel. Keep Next from
      // observing that intermediate entry while we decide whether to leave.
      event.stopImmediatePropagation();

      if (
        (dirtyRef.current ||
          savingRef.current ||
          wikilinkCreatePendingRef.current) &&
        !confirmDiscard()
      ) {
        window.history.pushState(
          guardedHistoryState(),
          "",
          guardedUrlRef.current,
        );
        guardEntryPresentRef.current = true;
        return;
      }

      guardEntryPresentRef.current = false;
      allowNextPopRef.current = true;
      allowUnloadRef.current = dirtyRef.current;
      window.history.back();

      // A sentinel can be the first usable entry in a fresh tab. If there is
      // nowhere else to go, re-arm it so a later edit is still protected.
      popFallbackTimerRef.current = window.setTimeout(() => {
        if (!allowNextPopRef.current) return;
        allowNextPopRef.current = false;
        allowUnloadRef.current = false;
        window.history.pushState(
          guardedHistoryState(),
          "",
          guardedUrlRef.current,
        );
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
  }, [
    confirmDiscard,
    invalidateImportRequest,
    invalidateWikilinkCreate,
    resetToLibraryRoot,
  ]);

  const folderMap = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders]);
  const visibleNotes = useMemo(() => {
    const scopedFolderIds = selectedFolderId === null ? null : subtreeIds(selectedFolderId, folders);
    const filtered = scopedFolderIds === null
      ? notes
      : notes.filter((note) => scopedFolderIds.has(note.folderId));
    return [...filtered].sort(newestFirst);
  }, [folders, notes, selectedFolderId]);

  function replaceLocation(folderId: number | null, noteId: number | null) {
    const params = new URLSearchParams();
    if (folderId !== null) params.set("folder", String(folderId));
    if (noteId !== null) params.set("note", String(noteId));
    const query = params.toString();
    const nextUrl = query ? `/notes?${query}` : "/notes";
    guardedUrlRef.current = nextUrl;
    window.history.replaceState(window.history.state, "", nextUrl);
  }

  function selectFolder(id: number | null) {
    if (!confirmDiscard()) return;
    invalidateImportRequest();
    selectedFolderIdRef.current = id;
    setSelectedFolderId(id);
    setActiveNoteId(null);
    setDetail(null);
    setBacklinks([]);
    setImportDraft(null);
    setDraftParentId(null);
    setDetailError("");
    setDetailLoading(false);
    setDetailRequestVersion(0);
    setMode("view");
    setStage("notes");
    replaceLocation(id, null);
  }

  function openNote(id: number, folderId?: number) {
    if (!confirmDiscard()) return;
    invalidateImportRequest();
    const targetFolderId = folderId ?? notes.find((note) => note.id === id)?.folderId ?? null;
    selectedFolderIdRef.current = targetFolderId;
    setSelectedFolderId(targetFolderId);
    setActiveNoteId(id);
    setDetail(null);
    setBacklinks([]);
    setImportDraft(null);
    setDraftParentId(null);
    setDetailError("");
    setDetailLoading(true);
    setDetailRequestVersion(0);
    setMode("view");
    setStage("note");
    replaceLocation(targetFolderId, id);
  }

  async function handleCreateFolder(name: string, parentId: number | null) {
    if (!confirmDiscard()) return;
    invalidateImportRequest();
    invalidateWikilinkCreate();
    const created = await createFolder({ name, parentId });
    await refreshIndex();
    selectedFolderIdRef.current = created.id;
    setSelectedFolderId(created.id);
    setActiveNoteId(null);
    setDetail(null);
    setBacklinks([]);
    setImportDraft(null);
    setDraftParentId(null);
    setMode("view");
    setDetailLoading(false);
    setDetailRequestVersion(0);
    setStage("notes");
    replaceLocation(created.id, null);
  }

  async function handleRenameFolder(id: number, name: string) {
    await updateFolder(id, { name });
    await refreshIndex();
  }

  async function handleMoveFolder(id: number, parentId: number | null) {
    await updateFolder(id, { parentId });
    await refreshIndex();
  }

  async function handleDeleteFolder(id: number) {
    if (!confirmDiscard()) return;
    invalidateImportRequest();
    invalidateWikilinkCreate();
    await deleteFolder(id);
    await refreshIndex();
    selectedFolderIdRef.current = null;
    setSelectedFolderId(null);
    setActiveNoteId(null);
    setDetail(null);
    setBacklinks([]);
    setImportDraft(null);
    setDraftParentId(null);
    setMode("view");
    setDetailLoading(false);
    setDetailRequestVersion(0);
    setStage("library");
    replaceLocation(null, null);
  }

  async function handleSaved(saved: NoteDetailDto) {
    invalidateImportRequest();
    const folderChanged = detail !== null && saved.folderId !== detail.folderId;
    const nextFolderId = detail === null || folderChanged ? saved.folderId : selectedFolderId;
    selectedFolderIdRef.current = nextFolderId;
    setDetail(saved);
    setBacklinks([]);
    setImportDraft(null);
    setDraftParentId(null);
    const selectionVersion = setActiveNoteId(saved.id);
    setSelectedFolderId(nextFolderId);
    setMode("view");
    setStage("note");
    setDetailLoading(false);
    setDetailRequestVersion(0);
    setDirtyState(false);
    replaceLocation(nextFolderId, saved.id);
    try {
      const [nextBacklinks] = await Promise.all([
        listBacklinks(saved.id),
        refreshIndex(),
      ]);
      if (selectionVersionRef.current === selectionVersion) {
        setBacklinks(nextBacklinks);
      }
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  async function handleCreateWikilink(title: string, folderId: number) {
    if (wikilinkCreatePendingRef.current || !confirmDiscard()) return;
    wikilinkCreatePendingRef.current = true;
    invalidateImportRequest();
    const requestGeneration = wikilinkCreateGenerationRef.current + 1;
    wikilinkCreateGenerationRef.current = requestGeneration;
    const startingSelectionVersion = selectionVersionRef.current;
    setSavingState(true);
    setError("");
    try {
      const saved = await createNote({
        folderId,
        parentId: null,
        title,
        contentMd: "",
        tags: [],
      });
      if (
        !mountedRef.current ||
        requestGeneration !== wikilinkCreateGenerationRef.current ||
        startingSelectionVersion !== selectionVersionRef.current
      ) {
        return;
      }
      await handleSaved(saved);
    } catch (caught) {
      if (
        mountedRef.current &&
        requestGeneration === wikilinkCreateGenerationRef.current &&
        startingSelectionVersion === selectionVersionRef.current
      ) {
        setError(getErrorMessage(caught));
      }
    } finally {
      wikilinkCreatePendingRef.current = false;
      setSavingState(false);
    }
  }

  async function handleDeleted() {
    invalidateImportRequest();
    setActiveNoteId(null);
    setDetail(null);
    setBacklinks([]);
    setImportDraft(null);
    setMode("view");
    setStage("notes");
    setDetailLoading(false);
    setDetailRequestVersion(0);
    replaceLocation(selectedFolderId, null);
    try {
      await refreshIndex();
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  function cancelEditing() {
    if (!confirmDiscard()) return;
    invalidateImportRequest();
    invalidateWikilinkCreate();
    setImportDraft(null);
    setMode("view");
    if (!detail) setStage("notes");
  }

  function backToNotes() {
    if (!confirmDiscard()) return;
    invalidateImportRequest();
    invalidateWikilinkCreate();
    setImportDraft(null);
    setMode("view");
    setStage("notes");
  }

  async function handleImportMarkdown(file: File) {
    if (selectedFolderId === null) return;
    const requestVersion = importRequestVersionRef.current + 1;
    importRequestVersionRef.current = requestVersion;
    if (savingRef.current || wikilinkCreatePendingRef.current) {
      confirmDiscard();
      return;
    }
    if (file.size > NOTE_CONTENT_MAX_BYTES) {
      setError("Markdown files must not exceed 10 MB.");
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
      setActiveNoteId(null);
      setDetail(null);
      setBacklinks([]);
      setImportDraft(draft);
      setDraftParentId(null);
      setDetailError("");
      setDetailLoading(false);
      setDetailRequestVersion(0);
      setDraftVersion((version) => version + 1);
      setMode("create");
      setStage("note");
      replaceLocation(targetFolderId, null);
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

  function backToLibrary() {
    if (!confirmDiscard()) return;
    invalidateImportRequest();
    invalidateWikilinkCreate();
    setStage("library");
  }

  return (
    <div className={`notes-workspace stage-${stage}${dirty ? " has-unsaved" : ""}`}>
      {error ? (
        <div className="workspace-alert" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError("")}>Dismiss</button>
        </div>
      ) : null}

      <FolderPanel
        folders={folders}
        selectedId={selectedFolderId}
        busy={indexLoading}
        onSelect={selectFolder}
        onCreate={handleCreateFolder}
        onRename={handleRenameFolder}
        onMove={handleMoveFolder}
        onDelete={handleDeleteFolder}
      />
      <NoteList
        notes={visibleNotes}
        folders={folderMap}
        selectedFolderId={selectedFolderId}
        selectedNoteId={selectedNoteId}
        loading={indexLoading}
        onSelect={openNote}
        onImport={handleImportMarkdown}
        onCreate={(parentId) => {
          if ((selectedFolderId === null && parentId === null) || !confirmDiscard()) return;
          const targetFolderId = parentId === null
            ? selectedFolderId!
            : notes.find((note) => note.id === parentId)?.folderId;
          if (targetFolderId === undefined) return;
          invalidateImportRequest();
          selectedFolderIdRef.current = targetFolderId;
          setSelectedFolderId(targetFolderId);
          setActiveNoteId(null);
          setDetail(null);
          setBacklinks([]);
          setImportDraft(null);
          setDraftParentId(parentId);
          setDetailError("");
          setDetailLoading(false);
          setDetailRequestVersion(0);
          setDraftVersion((version) => version + 1);
          setMode("create");
          setStage("note");
          replaceLocation(targetFolderId, null);
        }}
        onBack={backToLibrary}
      />

      {detailError ? (
        <section className="detail-panel error-state" role="alert">
          <button className="content-back" type="button" onClick={backToNotes}>← Notes</button>
          <span aria-hidden="true">!</span>
          <h2>Could not load this note</h2>
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
        <NoteDetail
          detail={detail}
          importDraft={importDraft}
          draftKey={draftVersion}
          mode={mode}
          folderId={detail?.folderId ?? selectedFolderId}
          parentId={mode === "create" ? draftParentId : detail?.parentId ?? null}
          folders={folders}
          notes={notes}
          backlinks={backlinks}
          loading={detailLoading}
          onEdit={() => {
            if (!confirmDiscard()) return;
            invalidateImportRequest();
            invalidateWikilinkCreate();
            setImportDraft(null);
            setMode("edit");
          }}
          onCreateSubnote={() => {
            if (!detail || !confirmDiscard()) return;
            invalidateImportRequest();
            setSelectedFolderId(detail.folderId);
            selectedFolderIdRef.current = detail.folderId;
            setActiveNoteId(null);
            setDetail(null);
            setBacklinks([]);
            setImportDraft(null);
            setDraftParentId(detail.id);
            setDetailError("");
            setDetailLoading(false);
            setDetailRequestVersion(0);
            setDraftVersion((version) => version + 1);
            setMode("create");
            setStage("note");
            replaceLocation(detail.folderId, null);
          }}
          onCancel={cancelEditing}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
          onNavigateNote={openNote}
          onCreateWikilink={handleCreateWikilink}
          onDirtyChange={setDirtyState}
          onPendingChange={setSavingState}
          onRegisterSave={registerSave}
          onBack={backToNotes}
        />
      )}
    </div>
  );
}
