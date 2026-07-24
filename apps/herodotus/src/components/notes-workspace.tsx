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
import { FolderPanel } from "@/components/folder-panel";
import {
  NotePageSession,
  type NoteDraftSession,
  savedNotePage,
} from "@/components/note-page-session";
import { NoteList } from "@/components/note-list";
import { TemplateEditor, TemplateList } from "@/components/template-manager";
import {
  createFolder,
  deleteFolder,
  getErrorMessage,
  listFolders,
  listNotes,
  listNoteTemplates,
  updateFolder,
} from "@/lib/api-client";
import {
  parseMarkdownImport,
  type MarkdownImportDraft,
} from "@/lib/markdown-import";
import { NOTE_CONTENT_MAX_BYTES } from "@/lib/note-limits";
import type {
  FolderDto,
  NoteSummaryDto,
  NoteTemplateDto,
} from "@/lib/types";

type ResponsiveStage = "library" | "notes" | "note";

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
  while (stack.length > 0) {
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

function templateNameOrder(a: NoteTemplateDto, b: NoteTemplateDto): number {
  return a.name.localeCompare(b.name, "en-US", { sensitivity: "base" }) || a.id - b.id;
}

function savedNoteId(pageKey: string | null): number | null {
  if (pageKey === null || !pageKey.startsWith("note:")) return null;
  const id = Number(pageKey.slice("note:".length));
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function NotesWorkspace({
  initialFolderId = null,
  initialNoteId = null,
}: NotesWorkspaceProps) {
  const { pages, activeKey, activatePage, closePage, openPage } = usePageSessions();
  const [folders, setFolders] = useState<FolderDto[]>([]);
  const [notes, setNotes] = useState<NoteSummaryDto[]>([]);
  const [templates, setTemplates] = useState<NoteTemplateDto[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(initialFolderId);
  const [stage, setStage] = useState<ResponsiveStage>(
    initialNoteId !== null ? "note" : initialFolderId !== null ? "notes" : "library",
  );
  const [indexLoading, setIndexLoading] = useState(true);
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<Record<string, NoteDraftSession>>({});
  const [managingTemplates, setManagingTemplates] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [creatingTemplate, setCreatingTemplate] = useState(false);
  const [templateDraftVersion, setTemplateDraftVersion] = useState(0);
  const [templateDirty, setTemplateDirty] = useState(false);
  const [templatePending, setTemplatePending] = useState(false);
  const [activeReferencePanel, setActiveReferencePanel] = useState<ReferencePanelKind | null>(null);
  const referenceTriggerRef = useRef<HTMLElement | null>(null);
  const initialOpenedRef = useRef(false);

  const refreshIndex = useCallback(async () => {
    const [nextFolders, nextNotes, nextTemplates] = await Promise.all([
      listFolders(),
      listNotes(),
      listNoteTemplates(),
    ]);
    setFolders(nextFolders);
    setNotes(nextNotes);
    setTemplates(nextTemplates.sort(templateNameOrder));
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.resolve()
      .then(refreshIndex)
      .catch((caught) => {
        if (active) setError(getErrorMessage(caught));
      })
      .finally(() => {
        if (active) setIndexLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refreshIndex]);

  useEffect(() => {
    if (indexLoading || initialOpenedRef.current) return;
    initialOpenedRef.current = true;
    if (initialNoteId === null) return;
    const note = notes.find((candidate) => candidate.id === initialNoteId);
    openPage(note
      ? savedNotePage(note)
      : {
          key: `note:${initialNoteId}`,
          kind: "Note",
          title: `Note ${initialNoteId}`,
          href: `/notes${initialFolderId === null
            ? `?note=${initialNoteId}`
            : `?folder=${initialFolderId}&note=${initialNoteId}`}`,
        });
  }, [indexLoading, initialFolderId, initialNoteId, notes, openPage]);

  const activePage = pages.find((page) => page.key === activeKey && page.kind === "Note") ?? null;
  useEffect(() => {
    if (activePage === null) return;
    const url = new URL(activePage.href, window.location.origin);
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl !== currentUrl) {
      window.history.replaceState(window.history.state, "", nextUrl);
    }
  }, [activePage]);

  usePageSessionHistoryGuard({
    dirty: templateDirty,
    pending: templatePending,
    onDiscard: () => {
      setTemplateDirty(false);
      setTemplatePending(false);
    },
  });

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!templateDirty && !templatePending) return;
      event.preventDefault();
      event.returnValue = true;
    };
    const beforeNavigate = (event: Event) => {
      const dirtyPages = pages.filter((page) => page.dirty || page.pending);
      if (
        (templateDirty || templatePending || dirtyPages.length > 0) &&
        !window.confirm("Discard your unsaved changes?")
      ) {
        event.preventDefault();
        return;
      }
      for (const page of dirtyPages) closePage(page.key);
      setTemplateDirty(false);
      setTemplatePending(false);
      const navigationEvent = event as CustomEvent<BeforeNavigateDetail>;
      if (navigationEvent.detail?.destination === "/notes") {
        activatePage(null);
        setSelectedFolderId(null);
        setStage("library");
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener(BEFORE_NAVIGATE_EVENT, beforeNavigate);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener(BEFORE_NAVIGATE_EVENT, beforeNavigate);
    };
  }, [activatePage, closePage, pages, templateDirty, templatePending]);

  const folderMap = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder])),
    [folders],
  );
  const activeFolderId = useMemo(() => {
    if (activePage === null) return null;
    const candidate = Number(
      new URL(activePage.href, "http://babel.local").searchParams.get("folder"),
    );
    return Number.isInteger(candidate) && candidate > 0 ? candidate : null;
  }, [activePage]);
  const visibleFolderId = activeFolderId ?? selectedFolderId;
  const visibleNotes = useMemo(() => {
    const scopedFolderIds = visibleFolderId === null
      ? null
      : subtreeIds(visibleFolderId, folders);
    const filtered = scopedFolderIds === null
      ? notes
      : notes.filter((note) => scopedFolderIds.has(note.folderId));
    return [...filtered].sort(newestFirst);
  }, [folders, notes, visibleFolderId]);
  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) ?? null,
    [selectedTemplateId, templates],
  );
  const selectedNoteId = savedNoteId(activeKey);
  const hasUnsavedPages = pages.some((page) => page.dirty || page.pending);
  const showingTemplates = managingTemplates && activePage === null;
  const visibleStage: ResponsiveStage = activePage === null ? stage : "note";

  function showList(folderId = selectedFolderId) {
    activatePage(null);
    setSelectedFolderId(folderId);
    setStage("notes");
    const nextUrl = folderId === null ? "/notes" : `/notes?folder=${folderId}`;
    window.history.replaceState(window.history.state, "", nextUrl);
  }

  function openNote(id: number, folderId?: number) {
    const note = notes.find((candidate) => candidate.id === id);
    const targetFolderId = folderId ?? note?.folderId ?? null;
    openPage(note
      ? savedNotePage(note)
      : {
          key: `note:${id}`,
          kind: "Note",
          title: `Note ${id}`,
          href: `/notes${targetFolderId === null
            ? `?note=${id}`
            : `?folder=${targetFolderId}&note=${id}`}`,
        });
    if (targetFolderId !== null) setSelectedFolderId(targetFolderId);
    setStage("note");
  }

  function openDraft(input: Omit<NoteDraftSession, "title"> & { title?: string }) {
    const key = `note-draft:${crypto.randomUUID()}`;
    const draft: NoteDraftSession = {
      ...input,
      title: input.title?.trim() || "Untitled note",
    };
    setDrafts((current) => ({ ...current, [key]: draft }));
    openPage({
      key,
      kind: "Note",
      title: draft.title,
      href: `/notes?folder=${draft.folderId}`,
      restorable: false,
    });
    setSelectedFolderId(draft.folderId);
    setStage("note");
  }

  function selectFolder(id: number | null) {
    setManagingTemplates(false);
    showList(id);
  }

  async function handleCreateFolder(name: string, parentId: number | null) {
    try {
      const created = await createFolder({ name, parentId });
      await refreshIndex();
      showList(created.id);
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  async function handleRenameFolder(id: number, name: string) {
    try {
      await updateFolder(id, { name });
      await refreshIndex();
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  async function handleMoveFolder(id: number, parentId: number | null) {
    try {
      await updateFolder(id, { parentId });
      await refreshIndex();
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  async function handleDeleteFolder(id: number) {
    try {
      await deleteFolder(id);
      await refreshIndex();
      showList(null);
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  async function handleImportMarkdown(file: File) {
    if (selectedFolderId === null) return;
    if (file.size > NOTE_CONTENT_MAX_BYTES) {
      setError("Markdown files must not exceed 10 MB.");
      return;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const importDraft: MarkdownImportDraft = parseMarkdownImport(file.name, bytes);
      openDraft({
        folderId: selectedFolderId,
        parentId: null,
        importDraft,
        title: importDraft.title,
      });
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  function confirmTemplateDiscard(): boolean {
    return !templateDirty && !templatePending
      ? true
      : window.confirm("Discard your unsaved template changes?");
  }

  function beginManagingTemplates() {
    setActiveReferencePanel(null);
    activatePage(null);
    setManagingTemplates(true);
    setSelectedTemplateId(null);
    setCreatingTemplate(false);
    setTemplateDirty(false);
    setTemplatePending(false);
    setTemplateDraftVersion((version) => version + 1);
    setStage("notes");
  }

  function closeTemplateManager(nextStage: ResponsiveStage = "notes") {
    if (!confirmTemplateDiscard()) return;
    setManagingTemplates(false);
    setSelectedTemplateId(null);
    setCreatingTemplate(false);
    setTemplateDirty(false);
    setTemplatePending(false);
    setTemplateDraftVersion((version) => version + 1);
    setStage(nextStage);
  }

  function selectManagedTemplate(id: number) {
    if (!confirmTemplateDiscard()) return;
    setSelectedTemplateId(id);
    setCreatingTemplate(false);
    setTemplateDirty(false);
    setTemplatePending(false);
    setTemplateDraftVersion((version) => version + 1);
    setStage("note");
  }

  function beginTemplateCreation() {
    if (!confirmTemplateDiscard()) return;
    setSelectedTemplateId(null);
    setCreatingTemplate(true);
    setTemplateDirty(false);
    setTemplatePending(false);
    setTemplateDraftVersion((version) => version + 1);
    setStage("note");
  }

  function cancelTemplateEditing() {
    if (!confirmTemplateDiscard()) return;
    setSelectedTemplateId(null);
    setCreatingTemplate(false);
    setTemplateDirty(false);
    setTemplatePending(false);
    setTemplateDraftVersion((version) => version + 1);
    setStage("notes");
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
    <div
      className={`notes-workspace stage-${visibleStage}${hasUnsavedPages || templateDirty ? " has-unsaved" : ""}${showingTemplates ? " managing-templates" : ""}`}
    >
      {error ? (
        <div className="workspace-alert" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError("")}>Dismiss</button>
        </div>
      ) : null}

      <FolderPanel
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
        onDelete={handleDeleteFolder}
      />

      {showingTemplates ? (
        <TemplateList
          templates={templates}
          selectedId={selectedTemplateId}
          creating={creatingTemplate}
          loading={indexLoading}
          referencePanelOpen={activeReferencePanel !== null}
          onSelect={selectManagedTemplate}
          onCreate={beginTemplateCreation}
          onExit={() => closeTemplateManager("notes")}
          onBack={() => closeTemplateManager("library")}
        />
      ) : (
        <NoteList
          notes={visibleNotes}
          folders={folderMap}
          selectedFolderId={visibleFolderId}
          selectedNoteId={selectedNoteId}
          loading={indexLoading}
          referencePanelOpen={activeReferencePanel !== null}
          onSelect={openNote}
          onImport={handleImportMarkdown}
          onManageTemplates={beginManagingTemplates}
          onCreate={(parentId) => {
            const targetFolderId = parentId === null
              ? selectedFolderId
              : notes.find((note) => note.id === parentId)?.folderId ?? null;
            if (targetFolderId === null) return;
            openDraft({
              folderId: targetFolderId,
              parentId,
              importDraft: null,
              title: parentId === null ? "New note" : "New subnote",
            });
          }}
          onBack={() => {
            activatePage(null);
            setStage("library");
          }}
        />
      )}

      {showingTemplates ? (
        <TemplateEditor
          key={`template-${templateDraftVersion}-${selectedTemplateId ?? "new"}-${creatingTemplate}`}
          template={selectedTemplate}
          creating={creatingTemplate}
          onSaved={(saved) => {
            setTemplateDirty(false);
            setTemplatePending(false);
            setTemplates((current) => [
              ...current.filter((template) => template.id !== saved.id),
              saved,
            ].sort(templateNameOrder));
            setSelectedTemplateId(saved.id);
            setCreatingTemplate(false);
            setTemplateDraftVersion((version) => version + 1);
            setStage("note");
          }}
          onDeleted={(id) => {
            setTemplateDirty(false);
            setTemplatePending(false);
            setTemplates((current) => current.filter((template) => template.id !== id));
            setSelectedTemplateId(null);
            setCreatingTemplate(false);
            setTemplateDraftVersion((version) => version + 1);
            setStage("notes");
          }}
          onCancel={cancelTemplateEditing}
          onDirtyChange={setTemplateDirty}
          onPendingChange={setTemplatePending}
          onRegisterSave={() => undefined}
          onBack={cancelTemplateEditing}
        />
      ) : (
        <>
          {pages
            .filter((page) => page.kind === "Note")
            .map((page) => {
              const noteId = savedNoteId(page.key);
              const draft = drafts[page.key] ?? null;
              if (noteId === null && draft === null) return null;
              return (
                <NotePageSession
                  key={page.key}
                  pageKey={page.key}
                  noteId={noteId}
                  draft={draft}
                  folders={folders}
                  notes={notes}
                  templates={templates}
                  onOpenNote={openNote}
                  onOpenDraft={openDraft}
                  onRefreshIndex={refreshIndex}
                  onShowList={() => showList()}
                  onError={setError}
                />
              );
            })}
          {activePage === null ? (
            <section className="detail-panel empty-state" aria-label="Note details">
              <button className="content-back" type="button" onClick={() => showList()}>
                <span aria-hidden="true">←</span> Notes
              </button>
              <span className="empty-monogram" aria-hidden="true">H</span>
              <h2>Open more than one record</h2>
              <p>Select a note to open it in a persistent page tab.</p>
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
    </div>
  );
}
