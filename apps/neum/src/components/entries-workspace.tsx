"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MarkdownWritingGuidePanel,
  TypstReferencePanel,
  type ReferencePanelKind,
} from "@babel-apps/markdown/reference";
import {
  usePageSessionHistoryGuard,
  usePageSessions,
} from "@babel-apps/platform/pages/react";

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

type ResponsiveStage = "library" | "entries" | "entry";
const PAGE_LIMIT = 100;

interface EntriesWorkspaceProps {
  kind: EntryKind;
  initialFolderId?: number | null;
  initialEntryId?: number | null;
  initialSearchFocus?: EntrySearchFocus | null;
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
}: EntriesWorkspaceProps) {
  const { pages, activeKey, activatePage, closePage, openPage } = usePageSessions();
  const pageKind = entryUnitLabel(kind);
  const [folders, setFolders] = useState<FolderDto[]>([]);
  const [entries, setEntries] = useState<EntrySummaryDto[]>([]);
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
  const [drafts, setDrafts] = useState<Record<string, EntryDraftSession>>({});
  const [activeReferencePanel, setActiveReferencePanel] = useState<ReferencePanelKind | null>(null);
  const referenceTriggerRef = useRef<HTMLElement | null>(null);
  const initialOpenedRef = useRef(false);
  const indexRequestRef = useRef(0);
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

  useEffect(() => {
    let active = true;
    void Promise.resolve()
      .then(() => refreshIndex(initialFolderId))
      .catch((caught) => {
        if (active) setError(getErrorMessage(caught));
      })
      .finally(() => {
        if (active) setIndexLoading(false);
      });
    return () => {
      active = false;
    };
  }, [initialFolderId, refreshIndex]);

  useEffect(() => {
    if (indexLoading || initialOpenedRef.current) return;
    initialOpenedRef.current = true;
    if (initialEntryId === null) return;
    const entry = entries.find((candidate) => candidate.id === initialEntryId);
    openPage(entry
      ? savedEntryPage(entry)
      : {
          key: `entry:${initialEntryId}`,
          kind: pageKind,
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
    kind,
    openPage,
    pageKind,
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
    if (activePage === null) return;
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
  }, [activeFolderId, activePage, refreshEntries]);

  usePageSessionHistoryGuard();

  useEffect(() => {
    const beforeNavigate = (event: Event) => {
      const dirtyPages = pages.filter((page) => page.dirty || page.pending);
      if (
        dirtyPages.length > 0 &&
        !window.confirm("Discard your unsaved changes?")
      ) {
        event.preventDefault();
        return;
      }
      for (const page of dirtyPages) closePage(page.key);
      const navigationEvent = event as CustomEvent<BeforeNavigateDetail>;
      if (navigationEvent.detail?.destination === entryUnitPath(kind)) {
        activatePage(null);
        setSelectedFolderId(null);
        setStage("library");
      }
    };
    window.addEventListener(BEFORE_NAVIGATE_EVENT, beforeNavigate);
    return () => window.removeEventListener(BEFORE_NAVIGATE_EVENT, beforeNavigate);
  }, [activatePage, closePage, kind, pages]);

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
  }

  function openEntry(
    id: number,
    targetKind: EntryKind,
    folderId?: number,
    exactFolder = false,
  ) {
    if (targetKind !== kind) {
      window.location.assign(entryWorkspaceHref(targetKind, {
        folderId,
        entryId: id,
      }));
      return;
    }
    const entry = entries.find((candidate) => candidate.id === id);
    const targetFolderId = folderId ?? entry?.folderId ?? null;
    openPage(entry
      ? savedEntryPage(entry)
      : {
          key: `entry:${id}`,
          kind: pageKind,
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
      showList(created.id);
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  async function handleRenameFolder(id: number, name: string) {
    try {
      await updateFolder(id, { name });
      await refreshFolders();
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  async function handleMoveFolder(id: number, parentId: number | null) {
    try {
      await updateFolder(id, { parentId });
      await refreshFolders();
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  async function handleDeleteFolder(id: number) {
    try {
      await deleteFolder(id);
      await refreshIndex(null);
      showList(null);
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

  return (
    <div className={`entries-workspace stage-${visibleStage}${hasUnsavedPages ? " has-unsaved" : ""}`}>
      {error ? (
        <div className="workspace-alert" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError("")}>Dismiss</button>
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
        onLoadMore={loadMoreEntries}
        onImport={kind === "knowledge" ? handleImportMarkdown : undefined}
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
                onOpenEntry={openEntry}
                onOpenDraft={openDraft}
                onRefreshIndex={refreshIndex}
                onShowList={() => showList()}
                onError={setError}
              />
            );
          })}
        {activePage === null ? (
          <section className="detail-panel empty-state" aria-label="Entry details">
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
    </div>
  );
}
