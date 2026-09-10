"use client";

import { FolderMoveProvider } from "@babel-apps/platform/folders/move-react";
import { pageSubtreeIds } from "@/components/page-tree-state";

import { FolderPicker } from "@babel-apps/platform/folders/picker";

import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  useCommandPaletteActions,
  useCommandPaletteItemSource,
} from "@babel-apps/platform/shortcuts/react";
import { MarkdownFolderImportDialog } from "@babel-apps/platform/imports/react";

import {
  ArchivePageSession,
  type ArchiveDraftSession,
  archivePageKind,
  savedArchivePage,
} from "@/components/archive-page-session";
import {
  BEFORE_NAVIGATE_EVENT,
  type BeforeNavigateDetail,
} from "@/components/app-header";
import { FolderPanel } from "@/components/folder-panel";
import { ItemList } from "@/components/item-list";
import {
  createFolder,
  createKnowledge,
  deleteFolder,
  getErrorMessage,
  listExercises,
  listFolders,
  listKnowledge,
  reorderExercise,
  moveExercise,
  moveKnowledge,
  reorderKnowledge,
  updateFolder,
} from "@/lib/api-client";
import {
  parseMarkdownImport,
  type MarkdownImportDraft,
} from "@/lib/markdown-import";
import { NOTE_CONTENT_MAX_BYTES } from "@/lib/note-limits";
import type { ArchiveSearchFocus } from "@/lib/search-focus";
import type {
  ExerciseSummaryDto,
  FolderDto,
  FolderType,
  KnowledgeSummaryDto,
  LinkEntityKind,
} from "@/lib/types";
import { isRetexWorkspaceDestination } from "@/lib/workspace-process";

type ArchiveSummary = KnowledgeSummaryDto | ExerciseSummaryDto;

interface ArchiveWorkspaceProps {
  type: FolderType;
  initialFolderId?: number | null;
  initialItemId?: number | null;
  initialSearchFocus?: ArchiveSearchFocus | null;
  routeTargetKey?: string;
}

interface WikilinkCreationRequest {
  title: string;
}

function savedItemId(pageKey: string | null, type: FolderType): number | null {
  if (pageKey === null || !pageKey.startsWith(`${type}:`)) return null;
  const id = Number(pageKey.slice(type.length + 1));
  return Number.isInteger(id) && id > 0 ? id : null;
}

function entityLocation(
  kind: LinkEntityKind,
  id?: number | null,
  folderId?: number | null,
): string {
  const params = new URLSearchParams();
  if (folderId !== null && folderId !== undefined) params.set("folder", String(folderId));
  if (id !== null && id !== undefined) params.set("item", String(id));
  const query = params.toString();
  return `/${kind}${query ? `?${query}` : ""}`;
}

export function ArchiveWorkspace({
  type,
  initialFolderId = null,
  initialItemId = null,
  initialSearchFocus = null,
  routeTargetKey = "initial",
}: ArchiveWorkspaceProps) {
  const router = useRouter();
  const processActive = useWorkspaceProcessActive();
  const { pages, activeKey, activatePage, closePage, openPage, updatePage } = usePageSessions();
  const { focusPane } = usePaneFocus();
  const pageKind = archivePageKind(type);
  const [folders, setFolders] = useState<FolderDto[]>([]);
  const [items, setItems] = useState<ArchiveSummary[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(initialFolderId);
  const [indexLoading, setIndexLoading] = useState(true);
  const [error, setError] = useState("");
  const [navigationError, setNavigationError] = useState("");
  const [notice, setNotice] = useState("");
  const [folderImportFiles, setFolderImportFiles] = useState<File[] | null>(null);
  const [importTitleUniverse, setImportTitleUniverse] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, ArchiveDraftSession>>({});
  const [movingItemIds, setMovingItemIds] = useState<ReadonlySet<number>>(new Set());
  const [moveRevisions, setMoveRevisions] = useState<Record<number, number>>({});
  const [pendingEditPageKey, setPendingEditPageKey] = useState<string | null>(null);
  const [wikilinkCreation, setWikilinkCreation] = useState<WikilinkCreationRequest | null>(null);
  const [knowledgeFolders, setKnowledgeFolders] = useState<FolderDto[]>([]);
  const [knowledgeFoldersLoading, setKnowledgeFoldersLoading] = useState(false);
  const [knowledgeFoldersError, setKnowledgeFoldersError] = useState("");
  const [activeReferencePanel, setActiveReferencePanel] = useState<ReferencePanelKind | null>(null);
  const referenceTriggerRef = useRef<HTMLElement | null>(null);
  const openedRouteTargetRef = useRef<string | null>(null);
  const routeTargetTrackerRef = useRef(createWorkspaceProcessRouteTargetTracker());

  const loadIndex = useCallback(async () => {
    const [nextFolders, nextItems, otherItems] = await Promise.all([
      listFolders(type),
      type === "knowledge" ? listKnowledge() : listExercises(),
      type === "knowledge" ? listExercises() : Promise.resolve([]),
    ]);
    setFolders(nextFolders);
    setItems(nextItems);
    setImportTitleUniverse([...nextItems, ...otherItems].map(({ title }) => title));
  }, [type]);

  useEffect(() => {
    let active = true;
    void Promise.resolve()
      .then(loadIndex)
      .catch((caught) => {
        if (active) setError(getErrorMessage(caught));
      })
      .finally(() => {
        if (active) setIndexLoading(false);
      });
    return () => {
      active = false;
    };
  }, [loadIndex]);

  useEffect(() => {
    if (!workspaceProcessRouteTargetShouldApply(
      routeTargetTrackerRef.current,
      processActive,
      routeTargetKey,
    )) return;
    if (
      indexLoading ||
      openedRouteTargetRef.current === routeTargetKey
    ) return;
    openedRouteTargetRef.current = routeTargetKey;
    setSelectedFolderId(initialFolderId);
    if (initialItemId === null) return;
    const item = items.find((candidate) => candidate.id === initialItemId);
    openPage(item
      ? savedArchivePage(type, item)
      : {
          key: `${type}:${initialItemId}`,
          kind: pageKind,
          title: `${pageKind} ${initialItemId}`,
          href: entityLocation(type, initialItemId, initialFolderId),
          scope: type,
        });
  }, [
    indexLoading,
    initialFolderId,
    initialItemId,
    items,
    openPage,
    pageKind,
    processActive,
    routeTargetKey,
    type,
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
  }, [activePage, processActive]);

  useEffect(() => {
    if (!processActive) return;
    const beforeNavigate = (event: Event) => {
      const navigationEvent = event as CustomEvent<BeforeNavigateDetail>;
      if (isRetexWorkspaceDestination(navigationEvent.detail?.destination ?? "")) {
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
  }, [closePage, pages, processActive]);

  const visibleItems = useMemo(() => {
    const filtered = visibleFolderId === null
      ? items
      : items.filter((item) => item.folderId === visibleFolderId);
    return filtered;
  }, [items, visibleFolderId]);
  const selectedItemId = savedItemId(activeKey, type);
  const hasUnsavedPages = pages.some((page) => page.dirty || page.pending);

  function showList(folderId = selectedFolderId) {
    activatePage(null);
    setSelectedFolderId(folderId);
    window.history.replaceState(
      window.history.state,
      "",
      entityLocation(type, null, folderId),
    );
    window.requestAnimationFrame(() => focusPane("items"));
  }

  function openItem(id: number, exactFolderId?: number) {
    const item = items.find((candidate) => candidate.id === id);
    const folderId = exactFolderId ?? item?.folderId ?? selectedFolderId;
    openPage(item
      ? savedArchivePage(type, item)
      : {
          key: `${type}:${id}`,
          kind: pageKind,
          title: `${pageKind} ${id}`,
          href: entityLocation(type, id, folderId),
          scope: type,
        });
    if (folderId !== null) setSelectedFolderId(folderId);
    window.requestAnimationFrame(() => focusPane("detail"));
  }

  function openItemForEdit(id: number) {
    const item = items.find((candidate) => candidate.id === id);
    setPendingEditPageKey(item ? savedArchivePage(type, item).key : `${type}:${id}`);
    openItem(id, item?.folderId);
  }

  function openEntity(kind: LinkEntityKind, id: number, folderId?: number) {
    if (kind === type) {
      openItem(id, folderId);
      return;
    }
    const href = entityLocation(kind, id, folderId);
    openPage({
      key: `${kind}:${id}`,
      kind: archivePageKind(kind),
      title: `${archivePageKind(kind)} ${id}`,
      href,
      scope: kind,
    });
    router.push(href);
  }

  function openDraft(
    input: Omit<ArchiveDraftSession, "title"> & { title?: string },
  ) {
    const key = `${type}-draft:${crypto.randomUUID()}`;
    const draft: ArchiveDraftSession = {
      ...input,
      title: input.title?.trim() || (
        type === "knowledge" ? "Untitled knowledge note" : "Untitled exercise"
      ),
    };
    setDrafts((current) => ({ ...current, [key]: draft }));
    openPage({
      key,
      kind: pageKind,
      title: draft.title,
      href: entityLocation(type, null, draft.folderId),
      scope: type,
      restorable: false,
    });
    setSelectedFolderId(draft.folderId);
  }

  function selectFolder(id: number | null) {
    showList(id);
  }

  async function handleCreateFolder(name: string, parentId: number | null) {
    try {
      const created = await createFolder({ type, parentId, name });
      await loadIndex();
      showList(created.id);
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  async function handleRenameFolder(id: number, name: string) {
    try {
      await updateFolder(id, { name });
      await loadIndex();
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  async function handleMoveFolder(id: number, parentId: number | null) {
    try {
      await updateFolder(id, { parentId });
      await loadIndex();
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  async function handleReorderFolder(id: number, position: number) {
    try {
      await updateFolder(id, { position });
      await loadIndex();
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  async function handleDeleteFolder(id: number) {
    try {
      await deleteFolder(id);
      await loadIndex();
      showList(null);
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  async function handleMoveItem(id: number, folderId: number) {
    const item = items.find((candidate) => candidate.id === id);
    if (!item || !folders.some((folder) => folder.id === folderId && folder.type === type)) {
      throw new Error("This item or destination folder is no longer available. Refresh and try again.");
    }
    if (item.folderId === folderId) return;
    const affectedIds = type === "knowledge"
      ? pageSubtreeIds(items as KnowledgeSummaryDto[], id)
      : new Set([id]);
    const blocked = pages.some((page) => {
      const savedId = savedItemId(page.key, type);
      if (savedId !== null && affectedIds.has(savedId) && (page.dirty || page.pending)) return true;
      const draft = drafts[page.key];
      return draft?.parentId !== null && draft?.parentId !== undefined && affectedIds.has(draft.parentId);
    });
    if (blocked) throw new Error("Save or close open drafts in this note and its child notes before moving it.");
    setMovingItemIds(affectedIds);
    try {
      if (type === "knowledge") await moveKnowledge(id, folderId);
      else await moveExercise(id, folderId);
      for (const page of pages) {
        const savedId = savedItemId(page.key, type);
        if (savedId === null || !affectedIds.has(savedId)) continue;
        updatePage(page.key, { href: entityLocation(type, savedId, folderId) });
      }
      setMoveRevisions((current) => {
        const next = { ...current };
        for (const affectedId of affectedIds) next[affectedId] = (next[affectedId] ?? 0) + 1;
        return next;
      });
      await loadIndex();
    } finally {
      setMovingItemIds(new Set());
    }
  }

  async function handleReorderItem(id: number, position: number) {
    try {
      if (type === "knowledge") await reorderKnowledge(id, position);
      else await reorderExercise(id, position);
      await loadIndex();
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  function beginCreate(parentId: number | null) {
    const parent = type === "knowledge" && parentId !== null
      ? (items as KnowledgeSummaryDto[]).find((item) => item.id === parentId)
      : undefined;
    const folderId = parent?.folderId ?? selectedFolderId;
    if (folderId === null) return;
    openDraft({
      type,
      folderId,
      parentId: type === "knowledge" ? parentId : null,
      importDraft: null,
      title: type === "knowledge" && parentId !== null
        ? "New child note"
        : type === "knowledge"
          ? "New knowledge note"
          : "New exercise",
    });
  }

  async function handleImportMarkdown(file: File) {
    if (type !== "knowledge" || selectedFolderId === null) return;
    if (file.size > NOTE_CONTENT_MAX_BYTES) {
      setNavigationError("Markdown files must not exceed 10 MB.");
      return;
    }
    try {
      const draft: MarkdownImportDraft = parseMarkdownImport(
        file.name,
        new Uint8Array(await file.arrayBuffer()),
      );
      openDraft({
        type,
        folderId: selectedFolderId,
        parentId: null,
        importDraft: draft,
        title: draft.title,
      });
    } catch (caught) {
      setNavigationError(getErrorMessage(caught));
    }
  }

  function requestKnowledgeCreation(title: string) {
    setWikilinkCreation({ title });
    setKnowledgeFolders([]);
    setKnowledgeFoldersError("");
    setKnowledgeFoldersLoading(true);
    void listFolders("knowledge").then(
      (nextFolders) => {
        setKnowledgeFolders(nextFolders);
        setKnowledgeFoldersLoading(false);
      },
      (caught) => {
        setKnowledgeFoldersError(getErrorMessage(caught));
        setKnowledgeFoldersLoading(false);
      },
    );
  }

  function cancelKnowledgeCreation() {
    setWikilinkCreation(null);
    setKnowledgeFolders([]);
    setKnowledgeFoldersError("");
    setKnowledgeFoldersLoading(false);
  }

  async function createKnowledgeNote(title: string, folderId: number) {
    const saved = await createKnowledge({
      folderId,
      parentId: null,
      title,
      contentMd: "",
      tags: [],
      exerciseIds: [],
    });
    const page = savedArchivePage("knowledge", saved);
    openPage(page);
    router.push(page.href);
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

  function retryIndexLoading() {
    setError("");
    setIndexLoading(true);
    void loadIndex()
      .catch((caught) => setError(getErrorMessage(caught)))
      .finally(() => setIndexLoading(false));
  }

  useCommandPaletteItemSource({
    id: `retex.${type}.items`,
    label: type === "knowledge" ? "Knowledge notes" : "Exercises",
    items: items.map((item) => ({
      id: String(item.id),
      dedupeKey: `retex:${type}:${item.id}`,
      label: item.title,
      description: folders.find((folder) => folder.id === item.folderId)?.name ?? pageKind,
      keywords: item.tags,
      open: () => openItem(item.id, item.folderId),
      edit: () => openItemForEdit(item.id),
    })),
  });

  useCommandPaletteActions(`retex.${type}.workspace`,
    processActive && Boolean(error) && !indexLoading ? [
      {
        id: "archive.retryIndex",
        label: "Retry loading archive",
        keywords: ["reload", "error"],
        group: pageKind,
        run: retryIndexLoading,
      },
    ] : [],
  );

  return (
    <FolderMoveProvider
      scope={`retex:${type}`}
      items={items}
      folderIds={folders.filter((folder) => folder.type === type).map(({ id }) => id)}
      disabled={indexLoading || movingItemIds.size > 0}
      onMove={handleMoveItem}
    >
      {processActive ? <ActiveArchiveHistoryGuard /> : null}
      {navigationError ? <p className="form-error" role="alert">{navigationError}</p> : null}
      {notice ? (
        <p className="panel-status" role="status">
          {notice} <button type="button" onClick={() => setNotice("")}>Dismiss</button>
        </p>
      ) : null}
      <div className={`archive-workspace${hasUnsavedPages ? " has-unsaved" : ""}`}>
        <FolderPanel
          type={type}
          folders={folders}
          selectedId={visibleFolderId}
          busy={indexLoading}
          activeReferencePanel={activeReferencePanel}
          onOpenMarkdownReference={() => openReferencePanel("markdown")}
          onOpenTypstReference={() => openReferencePanel("typst")}
          onSelect={selectFolder}
          onCreate={handleCreateFolder}
          onRename={handleRenameFolder}
          onMove={handleMoveFolder}
          onReorder={handleReorderFolder}
          onDelete={handleDeleteFolder}
        />
        <ItemList
          type={type}
          items={visibleItems}
          selectedId={selectedItemId}
          selectedFolderId={visibleFolderId}
          loading={indexLoading}
          referencePanelOpen={activeReferencePanel !== null}
          onSelect={openItem}
          onEdit={openItemForEdit}
          onReorder={handleReorderItem}
          onCreate={beginCreate}
          onImport={type === "knowledge" ? handleImportMarkdown : undefined}
          onImportFolder={type === "knowledge" ? (files) => setFolderImportFiles(files) : undefined}
        />

        {error ? (
          <section className="detail-panel error-state" data-babel-pane="detail" tabIndex={-1} role="alert">
            <span aria-hidden="true">!</span>
            <h2>Couldn’t load the archive</h2>
            <p>{error}</p>
            <button
              type="button"
              onClick={retryIndexLoading}
            >
              Retry
            </button>
          </section>
        ) : (
          <>
            {pages
              .filter((page) => page.kind === pageKind)
              .map((page) => {
                const itemId = savedItemId(page.key, type);
                const draft = drafts[page.key] ?? null;
                if (itemId === null && draft === null) return null;
                return (
                  <ArchivePageSession
                    key={`${page.key}:${itemId === null ? 0 : moveRevisions[itemId] ?? 0}`}
                    moving={itemId !== null && movingItemIds.has(itemId)}
                    pageKey={page.key}
                    itemId={itemId}
                    draft={draft}
                    type={type}
                    items={items}
                    searchFocus={itemId === initialItemId ? initialSearchFocus : null}
                    editRequested={pendingEditPageKey === page.key}
                    onEditRequestConsumed={() => {
                      setPendingEditPageKey((current) => current === page.key ? null : current);
                    }}
                    onOpenEntity={openEntity}
                    onOpenDraft={openDraft}
                    onRequestKnowledgeCreation={requestKnowledgeCreation}
                    onRefreshIndex={loadIndex}
                    onShowList={() => showList()}
                    onError={setError}
                  />
                );
              })}
            {activePage === null ? (
              <section className="detail-panel empty-state" data-babel-pane="detail" tabIndex={-1} aria-label={`${pageKind} details`}>
                <span aria-hidden="true">{type === "knowledge" ? "R" : "∫"}</span>
                <h2>Keep several {pageKind.toLowerCase()} pages open</h2>
                <p>Select an item to open it in a persistent page tab.</p>
              </section>
            ) : null}
          </>
        )}

        {activeReferencePanel === "markdown" ? (
          <MarkdownWritingGuidePanel onClose={closeReferencePanel} />
        ) : null}
        {activeReferencePanel === "typst" ? (
          <TypstReferencePanel onClose={closeReferencePanel} />
        ) : null}
        {type === "knowledge" && folderImportFiles && visibleFolderId !== null ? (
          <MarkdownFolderImportDialog
            files={folderImportFiles}
            folders={folders}
            existingTitles={importTitleUniverse}
            parentItems={(items as KnowledgeSummaryDto[]).map(
              ({ id, folderId, title }) => ({ id, folderId, title }),
            )}
            baseFolderId={visibleFolderId}
            itemLabel="knowledge note"
            onCancel={() => setFolderImportFiles(null)}
            onComplete={async (result) => {
              setFolderImportFiles(null);
              await loadIndex();
              const first = result.imported[0];
              setNotice(
                `Imported ${result.imported.length} knowledge ${result.imported.length === 1 ? "note" : "notes"}` +
                `${result.createdFolderCount ? ` and created ${result.createdFolderCount} ${result.createdFolderCount === 1 ? "folder" : "folders"}` : ""}.`,
              );
              if (first) openItem(first.id, first.folderId);
            }}
          />
        ) : null}
      </div>

      {wikilinkCreation === null ? null : (
        <KnowledgeFolderDialog
          request={wikilinkCreation}
          folders={knowledgeFolders}
          loading={knowledgeFoldersLoading}
          loadError={knowledgeFoldersError}
          onCancel={cancelKnowledgeCreation}
          onCreate={createKnowledgeNote}
        />
      )}
    </FolderMoveProvider>
  );
}

function ActiveArchiveHistoryGuard() {
  usePageSessionHistoryGuard({ preserveOnHistoryNavigation: true });
  return null;
}

interface KnowledgeFolderDialogProps {
  request: WikilinkCreationRequest;
  folders: FolderDto[];
  loading: boolean;
  loadError: string;
  onCancel: () => void;
  onCreate: (title: string, folderId: number) => Promise<void>;
}

function KnowledgeFolderDialog({
  request,
  folders,
  loading,
  loadError,
  onCancel,
  onCreate,
}: KnowledgeFolderDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [folderId, setFolderId] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.open) dialog.showModal();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (folderId === null) {
      setError("Choose a Knowledge folder before creating the note.");
      return;
    }
    setPending(true);
    setError("");
    try {
      await onCreate(request.title, folderId);
      dialogRef.current?.close();
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="dialog"
      onCancel={(event) => {
        if (pending) event.preventDefault();
      }}
      onClose={onCancel}
    >
      <form className="dialog-body" onSubmit={submit}>
        <h2>Create Knowledge Note</h2>
        <p>
          Choose where to create “{request.title}”. The new note will open after creation.
        </p>
        {loading ? <p className="muted">Loading Knowledge folders…</p> : null}
        {!loading && !loadError && folders.length === 0 ? (
          <p className="form-error" role="alert">
            No Knowledge folder exists. Cancel and create a Knowledge folder first.
          </p>
        ) : null}
        {loadError ? <p className="form-error" role="alert">{loadError}</p> : null}
        {folders.length > 0 ? (
          <div className="field">
            <span>Knowledge folder</span>
            <FolderPicker
              folders={folders}
              name="knowledgeFolderId"
              label="Knowledge folder"
              required
              value={folderId}
              disabled={pending || loading}
              onChange={setFolderId}
            />
          </div>
        ) : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="dialog-actions">
          <button
            data-babel-command="cancel"
            type="button"
            disabled={pending}
            onClick={() => dialogRef.current?.close()}
          >
            Cancel
          </button>
          <button
            data-babel-command="confirm"
            className="primary-button"
            type="submit"
            disabled={pending || loading || Boolean(loadError) || folders.length === 0}
          >
            {pending ? "Creating…" : "Create and Open"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
