"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MarkdownWritingGuidePanel,
  TypstReferencePanel,
  type ReferencePanelKind,
} from "@babel-apps/markdown/reference";
import {
  createWorkspaceProcessRouteTargetTracker,
  usePageSessionHistoryGuard,
  usePageSessions,
  useWorkspaceProcessActive,
  workspaceProcessRouteTargetShouldApply,
} from "@babel-apps/platform/pages/react";
import { usePaneFocus } from "@babel-apps/platform/navigation/react";
import { useCommandPaletteItemSource } from "@babel-apps/platform/shortcuts/react";
import { MarkdownFolderImportDialog } from "@babel-apps/platform/imports/react";

import {
  BEFORE_NAVIGATE_EVENT,
  type BeforeNavigateDetail,
} from "@/components/app-header";
import {
  EntryPageSession,
  type EntryDraftSession,
  savedEntryPage,
} from "@/components/entry-page-session";
import { EntryList } from "@/components/entry-list";
import { FolderPanel } from "@/components/folder-panel";
import {
  createFolder,
  deleteFolder,
  getErrorMessage,
  listEntries,
  reorderEntry,
  listFolders,
  updateFolder,
} from "@/lib/api-client";
import { entryUnitLabel, entryUnitPath, entryWorkspaceHref } from "@/lib/entry-routes";
import { ENTRY_NOTES_MAX_BYTES } from "@/lib/entry-limits";
import {
  parseMarkdownImport,
  type MarkdownImportDraft,
} from "@/lib/markdown-import";
import type {
  EntryKind,
  EntrySummaryDto,
  FolderDto,
} from "@/lib/types";
import type { EntrySearchFocus } from "@/lib/search-focus";
import { isNeumWorkspaceDestination } from "@/lib/workspace-process";

type ResponsiveStage = "library" | "entries" | "entry";
const PAGE_LIMIT = 100;
const FOLDERS_CHANGED_EVENT = "babel:neum-folders-changed";

function notifyFoldersChanged(): void {
  window.dispatchEvent(new Event(FOLDERS_CHANGED_EVENT));
}

interface EntriesWorkspaceProps {
  kind: EntryKind;
  initialFolderId?: number | null;
  initialEntryId?: number | null;
  initialSearchFocus?: EntrySearchFocus | null;
  routeTargetKey?: string;
}

function savedEntryId(pageKey: string | null): number | null {
  if (pageKey === null || !pageKey.startsWith("entry:")) return null;
  const id = Number(pageKey.slice("entry:".length));
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function EntriesWorkspace({
  kind,
  initialFolderId = null,
  initialEntryId = null,
  initialSearchFocus = null,
  routeTargetKey = "initial",
}: EntriesWorkspaceProps) {
  const router = useRouter();
  const processActive = useWorkspaceProcessActive();
  const { pages, activeKey, activatePage, closePage, openPage } = usePageSessions();
  const { focusPane } = usePaneFocus();
  const pageKind = entryUnitLabel(kind);
  const [folders, setFolders] = useState<FolderDto[]>([]);
  const [entries, setEntries] = useState<EntrySummaryDto[]>([]);
  const [quickOpenEntries, setQuickOpenEntries] = useState<EntrySummaryDto[]>([]);
  const [entryTotal, setEntryTotal] = useState(0);
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(initialFolderId);
  const [stage, setStage] = useState<ResponsiveStage>(
    initialEntryId !== null ? "entry" : initialFolderId !== null ? "entries" : "library",
  );
  const [indexLoading, setIndexLoading] = useState(true);
  const [folderLoading, setFolderLoading] = useState(true);
  const [folderLoadError, setFolderLoadError] = useState("");
  const [entryPageLoading, setEntryPageLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [folderImportFiles, setFolderImportFiles] = useState<File[] | null>(null);
  const [folderImportTitles, setFolderImportTitles] = useState<string[]>([]);
  const [folderImportParents, setFolderImportParents] = useState<EntrySummaryDto[]>([]);
  const [drafts, setDrafts] = useState<Record<string, EntryDraftSession>>({});
  const [pendingEditPageKey, setPendingEditPageKey] = useState<string | null>(null);
  const [activeReferencePanel, setActiveReferencePanel] = useState<ReferencePanelKind | null>(null);
  const referenceTriggerRef = useRef<HTMLElement | null>(null);
  const openedRouteTargetRef = useRef<string | null>(null);
  const routeTargetTrackerRef = useRef(createWorkspaceProcessRouteTargetTracker());
  const indexRequestRef = useRef(0);
  const quickOpenRequestRef = useRef(0);
  const loadedFolderRef = useRef<number | null | undefined>(undefined);

  const refreshEntries = useCallback(async (folderId: number | null) => {
    const requestId = ++indexRequestRef.current;
    const page = await listEntries({
      folderId: folderId ?? undefined,
      includeDescendants: true,
      kind,
      completeTree: true,
      limit: PAGE_LIMIT,
    });
    if (requestId !== indexRequestRef.current) return;
    loadedFolderRef.current = folderId;
    setEntries(page.items);
    setEntryTotal(page.total);
  }, [kind]);

  const refreshFolders = useCallback(async () => {
    setFolderLoading(true);
    setFolderLoadError("");
    try {
      setFolders(await listFolders());
    } catch (caught) {
      setFolderLoadError(getErrorMessage(caught));
      throw caught;
    } finally {
      setFolderLoading(false);
    }
  }, []);

  const refreshQuickOpenEntries = useCallback(async () => {
    const requestId = ++quickOpenRequestRef.current;
    const page = await listEntries({
      kind,
      completeTree: true,
      limit: PAGE_LIMIT,
    });
    if (requestId !== quickOpenRequestRef.current) return;
    setQuickOpenEntries(page.items);
  }, [kind]);

  useEffect(() => {
    if (!processActive) return;
    void refreshQuickOpenEntries().catch((caught) => setError(getErrorMessage(caught)));
    return () => {
      quickOpenRequestRef.current += 1;
    };
  }, [processActive, refreshQuickOpenEntries]);

  useEffect(() => {
    const refreshHiddenWorkspace = () => {
      if (processActive) return;
      void refreshFolders().catch((caught) => setError(getErrorMessage(caught)));
    };
    window.addEventListener(FOLDERS_CHANGED_EVENT, refreshHiddenWorkspace);
    return () => window.removeEventListener(FOLDERS_CHANGED_EVENT, refreshHiddenWorkspace);
  }, [processActive, refreshFolders]);

  const refreshIndex = useCallback(async (folderId: number | null) => {
    const requestId = ++indexRequestRef.current;
    // Restoring an open page can supersede the entry request below. Commit
    // folders independently so that race never discards a successful folder load.
    const [, pageResult] = await Promise.allSettled([
      refreshFolders(),
      listEntries({
        folderId: folderId ?? undefined,
        includeDescendants: true,
        kind,
        completeTree: true,
        limit: PAGE_LIMIT,
      }),
    ]);
    if (requestId !== indexRequestRef.current) return;
    if (pageResult.status === "rejected") throw pageResult.reason;
    loadedFolderRef.current = folderId;
    setEntries(pageResult.value.items);
    setEntryTotal(pageResult.value.total);
  }, [kind, refreshFolders]);

  const refreshWorkspaceIndex = useCallback(async (folderId: number | null) => {
    await Promise.all([
      refreshIndex(folderId),
      refreshQuickOpenEntries(),
    ]);
  }, [refreshIndex, refreshQuickOpenEntries]);

  useEffect(() => {
    if (!workspaceProcessRouteTargetShouldApply(
      routeTargetTrackerRef.current,
      processActive,
      routeTargetKey,
    )) return;
    let active = true;
    void Promise.resolve()
      .then(() => {
        if (!active) return;
        setSelectedFolderId(initialFolderId);
        if (initialEntryId === null) {
          setStage(initialFolderId === null ? "library" : "entries");
        }
        setIndexLoading(true);
        return refreshIndex(initialFolderId);
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
  }, [initialEntryId, initialFolderId, processActive, refreshIndex, routeTargetKey]);

  useEffect(() => {
    if (!processActive || indexLoading || openedRouteTargetRef.current === routeTargetKey) {
      return;
    }
    openedRouteTargetRef.current = routeTargetKey;
    if (initialEntryId === null) return;
    const entry = entries.find((candidate) => candidate.id === initialEntryId);
    openPage(entry
      ? savedEntryPage(entry)
      : {
          key: `entry:${initialEntryId}`,
          kind: pageKind,
          scope: kind,
          title: `${pageKind} ${initialEntryId}`,
          href: entryWorkspaceHref(kind, {
            folderId: initialFolderId,
            entryId: initialEntryId,
          }),
        });
  }, [
    entries,
    indexLoading,
    initialEntryId,
    initialFolderId,
    processActive,
    kind,
    openPage,
    pageKind,
    routeTargetKey,
  ]);

  const activePage = pages.find(
    (page) => page.key === activeKey && page.kind === pageKind,
  ) ?? null;
  const activeFolderId = useMemo(() => {
    if (activePage === null) return null;
    const candidate = Number(
      new URL(activePage.href, "http://babel.local").searchParams.get("folder"),
    );
    return Number.isInteger(candidate) && candidate > 0 ? candidate : null;
  }, [activePage]);
  const visibleFolderId = activeFolderId ?? selectedFolderId;

  useEffect(() => {
    if (!processActive || activePage === null) return;
    const url = new URL(activePage.href, window.location.origin);
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl !== currentUrl) {
      window.history.replaceState(window.history.state, "", nextUrl);
    }
    if (loadedFolderRef.current !== activeFolderId) {
      void refreshEntries(activeFolderId).catch((caught) => {
        setError(getErrorMessage(caught));
      });
    }
  }, [activeFolderId, activePage, processActive, refreshEntries]);

  useEffect(() => {
    if (!processActive) return;
    const beforeNavigate = (event: Event) => {
      const navigationEvent = event as CustomEvent<BeforeNavigateDetail>;
      const destination = navigationEvent.detail?.destination ?? "";
      if (isNeumWorkspaceDestination(destination)) {
        if (new URL(destination, "http://babel.local").pathname === entryUnitPath(kind)) {
          activatePage(null);
          openedRouteTargetRef.current = "";
          setSelectedFolderId(null);
          setStage("library");
          setIndexLoading(true);
          void refreshIndex(null)
            .catch((caught) => setError(getErrorMessage(caught)))
            .finally(() => setIndexLoading(false));
        }
        return;
      }
      const dirtyPages = pages.filter((page) => page.dirty || page.pending);
      if (
        dirtyPages.length > 0 &&
        !window.confirm("Discard your unsaved changes?")
      ) {
        event.preventDefault();
        return;
      }
      for (const page of dirtyPages) closePage(page.key);
    };
    window.addEventListener(BEFORE_NAVIGATE_EVENT, beforeNavigate);
    return () => window.removeEventListener(BEFORE_NAVIGATE_EVENT, beforeNavigate);
  }, [activatePage, closePage, kind, pages, processActive, refreshIndex]);

  const folderMap = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder])),
    [folders],
  );
  const selectedEntryId = savedEntryId(activeKey);
  const hasUnsavedPages = pages.some((page) => page.dirty || page.pending);
  const visibleStage: ResponsiveStage = activePage === null ? stage : "entry";

  async function loadMoreEntries() {
    if (entryPageLoading || entries.length >= entryTotal) return;
    const requestId = indexRequestRef.current;
    const folderId = visibleFolderId;
    setEntryPageLoading(true);
    try {
      const page = await listEntries({
        folderId: folderId ?? undefined,
        includeDescendants: true,
        kind,
        limit: PAGE_LIMIT,
        offset: entries.length,
      });
      if (requestId !== indexRequestRef.current) return;
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

  function showList(folderId = selectedFolderId) {
    activatePage(null);
    setSelectedFolderId(folderId);
    setStage("entries");
    window.history.replaceState(
      window.history.state,
      "",
      entryWorkspaceHref(kind, { folderId }),
    );
    if (loadedFolderRef.current !== folderId) {
      void refreshEntries(folderId).catch((caught) => setError(getErrorMessage(caught)));
    }
    window.requestAnimationFrame(() => focusPane("items"));
  }

  function openEntry(
    id: number,
    targetKind: EntryKind,
    folderId?: number,
    exactFolder = false,
  ) {
    if (targetKind !== kind) {
      const href = entryWorkspaceHref(targetKind, {
        folderId,
        entryId: id,
      });
      openPage({
        key: `entry:${id}`,
        kind: entryUnitLabel(targetKind),
        scope: targetKind,
        title: `${entryUnitLabel(targetKind)} ${id}`,
        href,
      });
      router.push(href);
      window.requestAnimationFrame(() => focusPane("detail"));
      return;
    }
    const entry = entries.find((candidate) => candidate.id === id);
    const targetFolderId = folderId ?? entry?.folderId ?? null;
    openPage(entry
      ? savedEntryPage(entry)
      : {
          key: `entry:${id}`,
          kind: pageKind,
          scope: kind,
          title: `${pageKind} ${id}`,
          href: entryWorkspaceHref(kind, {
            folderId: targetFolderId,
            entryId: id,
          }),
        });
    if (targetFolderId !== null) setSelectedFolderId(targetFolderId);
    if (exactFolder && targetFolderId === null) {
      void refreshEntries(null).catch((caught) => setError(getErrorMessage(caught)));
    }
    setStage("entry");
    window.requestAnimationFrame(() => focusPane("detail"));
  }

  function openEntryForEdit(id: number) {
    const entry = entries.find((candidate) => candidate.id === id)
      ?? quickOpenEntries.find((candidate) => candidate.id === id);
    setPendingEditPageKey(entry ? savedEntryPage(entry).key : `entry:${id}`);
    openEntry(id, entry?.kind ?? kind, entry?.folderId);
  }

  function openDraft(input: Omit<EntryDraftSession, "title"> & { title?: string }) {
    const key = `entry-draft:${crypto.randomUUID()}`;
    const draft: EntryDraftSession = {
      ...input,
      title: input.title?.trim() || `Untitled ${pageKind.toLowerCase()} entry`,
    };
    setDrafts((current) => ({ ...current, [key]: draft }));
    openPage({
      key,
      kind: pageKind,
      scope: kind,
      title: draft.title,
      href: entryWorkspaceHref(kind, { folderId: draft.folderId }),
      restorable: false,
    });
    setSelectedFolderId(draft.folderId);
    setStage("entry");
  }

  function selectFolder(id: number | null) {
    setSelectedFolderId(id);
    showList(id);
  }

  async function handleCreateFolder(name: string, parentId: number | null) {
    try {
      const created = await createFolder({ name, parentId });
      await refreshIndex(created.id);
      notifyFoldersChanged();
      showList(created.id);
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  async function handleRenameFolder(id: number, name: string) {
    try {
      await updateFolder(id, { name });
      await refreshFolders();
      notifyFoldersChanged();
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  async function handleMoveFolder(id: number, parentId: number | null) {
    try {
      await updateFolder(id, { parentId });
      await refreshFolders();
      notifyFoldersChanged();
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  async function handleReorderFolder(id: number, position: number) {
    try {
      await updateFolder(id, { position });
      await refreshFolders();
      notifyFoldersChanged();
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  async function handleDeleteFolder(id: number) {
    try {
      await deleteFolder(id);
      await refreshIndex(null);
      notifyFoldersChanged();
      showList(null);
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  async function handleReorderEntry(id: number, position: number) {
    const entry = entries.find((candidate) => candidate.id === id);
    if (!entry) return;
    try {
      await reorderEntry(id, entry.version, position);
      await refreshEntries(visibleFolderId);
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  async function handleImportMarkdown(file: File) {
    if (selectedFolderId === null) return;
    if (file.size > ENTRY_NOTES_MAX_BYTES) {
      setError("Markdown files must not exceed 10 MB.");
      return;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const importDraft: MarkdownImportDraft = parseMarkdownImport(file.name, bytes);
      openDraft({
        kind,
        folderId: selectedFolderId,
        parentId: null,
        importDraft,
        title: importDraft.title,
      });
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  async function beginMarkdownFolderImport(files: File[]) {
    setNotice("Loading the complete title and parent index for folder import…");
    try {
      const allEntries = new Map<string, EntrySummaryDto>();
      for (const importKind of ["knowledge", "snippet"] as const) {
        let offset = 0;
        let total = 0;
        do {
          const page = await listEntries({
            kind: importKind,
            completeTree: true,
            limit: PAGE_LIMIT,
            offset,
          });
          page.items.forEach((entry) => allEntries.set(`${entry.kind}:${entry.id}`, entry));
          total = page.total;
          offset += page.limit;
        } while (offset < total);
      }
      const all = [...allEntries.values()];
      setFolderImportTitles(all.map(({ title }) => title));
      setFolderImportParents(all.filter(({ kind: entryKind }) => entryKind === "knowledge"));
      setFolderImportFiles(files);
      setNotice("");
    } catch (caught) {
      setNotice("");
      setError(getErrorMessage(caught));
    }
  }

  function beginCreateEntry(parentId: number | null) {
    const parent = parentId === null
      ? undefined
      : entries.find((entry) => entry.id === parentId);
    const folderId = parent?.folderId ?? selectedFolderId;
    if (
      folderId === null ||
      (parentId !== null && (!parent || parent.kind !== kind))
    ) return;
    openDraft({
      kind,
      folderId,
      parentId,
      importDraft: null,
      title: parentId === null ? `New ${pageKind.toLowerCase()} entry` : "New child entry",
    });
  }

  function openReferencePanel(panel: ReferencePanelKind) {
    referenceTriggerRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setActiveReferencePanel(panel);
  }

  function closeReferencePanel() {
    setActiveReferencePanel(null);
    window.requestAnimationFrame(() => referenceTriggerRef.current?.focus());
  }

  useCommandPaletteItemSource({
    id: `neum.${kind}.entries`,
    label: `${pageKind} entries`,
    items: quickOpenEntries.map((entry) => ({
      id: String(entry.id),
      dedupeKey: `neum:${entry.kind}:${entry.id}`,
      label: entry.title,
      description: folderMap.get(entry.folderId)?.name ?? entryUnitLabel(entry.kind),
      keywords: entry.tags,
      open: () => openEntry(entry.id, entry.kind, entry.folderId),
      edit: () => openEntryForEdit(entry.id),
    })),
  });

  return (
    <div className={`entries-workspace stage-${visibleStage}${hasUnsavedPages ? " has-unsaved" : ""}`}>
      {processActive ? <ActiveWorkspaceHistoryGuard /> : null}
      {error ? (
        <div className="workspace-alert" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError("")}>Dismiss</button>
        </div>
      ) : null}
      {notice ? (
        <div className="workspace-alert" role="status">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice("")}>Dismiss</button>
        </div>
      ) : null}

      <FolderPanel
        folders={folders}
        selectedId={visibleFolderId}
        busy={folderLoading && folders.length === 0}
        loadError={folderLoadError}
        activeReferencePanel={activeReferencePanel}
        onOpenMarkdownReference={() => openReferencePanel("markdown")}
        onOpenTypstReference={() => openReferencePanel("typst")}
        onRetry={() => {
          void refreshFolders().catch(() => undefined);
        }}
        onSelect={selectFolder}
        onCreate={handleCreateFolder}
        onRename={handleRenameFolder}
        onMove={handleMoveFolder}
        onReorder={handleReorderFolder}
        onDelete={handleDeleteFolder}
      />

      <EntryList
        kind={kind}
        entries={entries}
        total={entryTotal}
        folders={folderMap}
        selectedFolderId={visibleFolderId}
        selectedEntryId={selectedEntryId}
        loading={indexLoading}
        loadingMore={entryPageLoading}
        referencePanelOpen={activeReferencePanel !== null}
        onSelect={(id) => openEntry(id, kind)}
        onEdit={openEntryForEdit}
        onReorder={handleReorderEntry}
        onLoadMore={loadMoreEntries}
        onImport={kind === "knowledge" ? handleImportMarkdown : undefined}
        onImportFolder={kind === "knowledge" ? beginMarkdownFolderImport : undefined}
        onCreate={() => beginCreateEntry(null)}
        onCreateChild={beginCreateEntry}
        onBack={() => {
          activatePage(null);
          setStage("library");
        }}
      />

      <>
        {pages
          .filter((page) => page.kind === pageKind)
          .map((page) => {
            const entryId = savedEntryId(page.key);
            const draft = drafts[page.key] ?? null;
            if (entryId === null && draft === null) return null;
            return (
              <EntryPageSession
                key={page.key}
                pageKey={page.key}
                entryId={entryId}
                draft={draft}
                kind={kind}
                folders={folders}
                entries={entries}
                searchFocus={entryId === initialEntryId ? initialSearchFocus : null}
                editRequested={pendingEditPageKey === page.key}
                onEditRequestConsumed={() => {
                  setPendingEditPageKey((current) => current === page.key ? null : current);
                }}
                onOpenEntry={openEntry}
                onOpenDraft={openDraft}
                onRefreshIndex={refreshWorkspaceIndex}
                onShowList={() => showList()}
                onError={setError}
              />
            );
          })}
        {activePage === null ? (
          <section className="detail-panel empty-state" data-babel-pane="detail" tabIndex={-1} aria-label="Entry details">
            <button className="content-back" type="button" onClick={() => showList()}>
              <span aria-hidden="true">←</span> Entries
            </button>
            <span className="empty-monogram" aria-hidden="true">N</span>
            <h2>Keep several entries open</h2>
            <p>Select an entry to open it in a persistent page tab.</p>
          </section>
        ) : null}
      </>

      {activeReferencePanel === "markdown" ? (
        <MarkdownWritingGuidePanel onClose={closeReferencePanel} />
      ) : null}
      {activeReferencePanel === "typst" ? (
        <TypstReferencePanel onClose={closeReferencePanel} />
      ) : null}
      {kind === "knowledge" && folderImportFiles && visibleFolderId !== null ? (
        <MarkdownFolderImportDialog
          files={folderImportFiles}
          folders={folders}
          existingTitles={folderImportTitles}
          parentItems={folderImportParents
            .map(({ id, folderId, title }) => ({ id, folderId, title }))}
          baseFolderId={visibleFolderId}
          itemLabel="knowledge entry"
          onCancel={() => setFolderImportFiles(null)}
          onComplete={async (result) => {
            setFolderImportFiles(null);
            await refreshWorkspaceIndex(visibleFolderId);
            const first = result.imported[0];
            setNotice(
              `Imported ${result.imported.length} knowledge ${result.imported.length === 1 ? "entry" : "entries"}` +
              `${result.createdFolderCount ? ` and created ${result.createdFolderCount} ${result.createdFolderCount === 1 ? "folder" : "folders"}` : ""}.`,
            );
            if (first) openEntry(first.id, "knowledge", first.folderId);
          }}
        />
      ) : null}
    </div>
  );
}

function ActiveWorkspaceHistoryGuard() {
  usePageSessionHistoryGuard({ preserveOnHistoryNavigation: true });
  return null;
}
