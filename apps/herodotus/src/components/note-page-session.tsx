"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  PageDeckPage,
  usePageSessionLifecycle,
  usePageSessions,
} from "@babel-apps/platform/pages/react";
import { useCommandPaletteActions } from "@babel-apps/platform/shortcuts/react";
import type { SearchFocus } from "@babel-apps/platform/search/focus";
import type { PageSessionDescriptor } from "@babel-apps/platform/pages/core";

import { NoteDetail, type NoteViewMode } from "@/components/note-detail";
import {
  createNote,
  getErrorMessage,
  getNote,
  listBacklinks,
} from "@/lib/api-client";
import type { MarkdownImportDraft } from "@/lib/markdown-import";
import { noteModeAfterSave } from "@/lib/editor-save-mode";
import type {
  BacklinkDto,
  FolderDto,
  NoteDetailDto,
  NoteSearchField,
  NoteSummaryDto,
  NoteTemplateDto,
} from "@/lib/types";

export interface NoteDraftSession {
  readonly folderId: number;
  readonly parentId: number | null;
  readonly importDraft: MarkdownImportDraft | null;
  readonly title: string;
}

interface NotePageSessionProps {
  pageKey: string;
  noteId: number | null;
  draft: NoteDraftSession | null;
  folders: FolderDto[];
  notes: NoteSummaryDto[];
  templates: NoteTemplateDto[];
  editRequested: boolean;
  onEditRequestConsumed: () => void;
  searchFocus: SearchFocus<NoteSearchField> | null;
  onOpenNote: (id: number, folderId?: number) => void;
  onOpenDraft: (input: Omit<NoteDraftSession, "title"> & { title?: string }) => void;
  onRefreshIndex: () => Promise<void>;
  onShowList: () => void;
  onError: (message: string) => void;
}

export function savedNotePage(
  note: Pick<NoteSummaryDto, "id" | "folderId" | "title">,
): PageSessionDescriptor {
  return {
    key: `note:${note.id}`,
    kind: "Note",
    title: note.title,
    href: `/notes?folder=${note.folderId}&note=${note.id}`,
  };
}

export function NotePageSession({
  pageKey,
  noteId,
  draft,
  folders,
  notes,
  templates,
  editRequested,
  onEditRequestConsumed,
  searchFocus,
  onOpenNote,
  onOpenDraft,
  onRefreshIndex,
  onShowList,
  onError,
}: NotePageSessionProps) {
  const { activeKey, closePage, rekeyPage, setPageStatus, updatePage } = usePageSessions();
  const [detail, setDetail] = useState<NoteDetailDto | null>(null);
  const [backlinks, setBacklinks] = useState<BacklinkDto[]>([]);
  const [mode, setMode] = useState<NoteViewMode>(noteId === null ? "create" : "view");
  const [loading, setLoading] = useState(noteId !== null);
  const [loadError, setLoadError] = useState("");
  const [reloadVersion, setReloadVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const saveActionRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    setPageStatus(pageKey, { dirty, pending });
  }, [dirty, pageKey, pending, setPageStatus]);

  usePageSessionLifecycle(pageKey, {
    save: () => {
      if (!dirty && !pending) return true;
      saveActionRef.current?.();
      return false;
    },
    discard: () => {
      setDirty(false);
      setPending(false);
    },
  });

  useEffect(() => {
    if (noteId === null) return;
    let active = true;
    Promise.all([getNote(noteId), listBacklinks(noteId)])
      .then(([nextDetail, nextBacklinks]) => {
        if (!active) return;
        setDetail(nextDetail);
        setBacklinks(nextBacklinks);
        setMode("view");
        updatePage(pageKey, {
          title: nextDetail.title,
          href: savedNotePage(nextDetail).href,
        });
      })
      .catch((error) => {
        if (active) setLoadError(getErrorMessage(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [noteId, pageKey, reloadVersion, updatePage]);

  const refreshBacklinks = useCallback(async (id: number) => {
    try {
      setBacklinks(await listBacklinks(id));
    } catch (error) {
      onError(getErrorMessage(error));
    }
  }, [onError]);

  async function handleSaved(saved: NoteDetailDto) {
    setDetail(saved);
    setMode(noteModeAfterSave(noteId));
    setDirty(false);
    setPending(false);
    setLoadError("");
    const nextPage = savedNotePage(saved);
    if (pageKey !== nextPage.key) rekeyPage(pageKey, nextPage);
    else updatePage(pageKey, nextPage);
    try {
      await Promise.all([onRefreshIndex(), refreshBacklinks(saved.id)]);
    } catch (error) {
      onError(getErrorMessage(error));
    }
  }

  async function handleDeleted() {
    closePage(pageKey);
    try {
      await onRefreshIndex();
    } catch (error) {
      onError(getErrorMessage(error));
    }
  }

  async function handleCreateWikilink(title: string, folderId: number) {
    try {
      const saved = await createNote({
        folderId,
        parentId: null,
        title,
        contentMd: "",
        tags: [],
      });
      await onRefreshIndex();
      onOpenNote(saved.id, saved.folderId);
    } catch (error) {
      onError(getErrorMessage(error));
    }
  }

  function cancelEditing() {
    if (dirty && !window.confirm("Discard your unsaved changes?")) return;
    setDirty(false);
    setPending(false);
    if (noteId === null) {
      closePage(pageKey);
      onShowList();
      return;
    }
    setMode("view");
  }

  useEffect(() => {
    if (!editRequested || noteId === null || loading || detail === null) return;
    const frame = window.requestAnimationFrame(() => {
      setMode("edit");
      onEditRequestConsumed();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [detail, editRequested, loading, noteId, onEditRequestConsumed]);
  function retryLoading() {
    setLoading(true);
    setLoadError("");
    setReloadVersion((version) => version + 1);
  }

  useCommandPaletteActions(`herodotus.note-detail.${pageKey}`, activeKey === pageKey && Boolean(loadError) ? [
    {
      id: "note.retry",
      label: "Retry loading note",
      keywords: ["reload", "error"],
      group: "Notes",
      available: !loading,
      run: retryLoading,
    },
  ] : []);

  if (loadError) {
    return (
      <PageDeckPage pageKey={pageKey}>
        <section className="detail-panel error-state" data-babel-pane="detail" tabIndex={-1} role="alert">
          <button className="content-back" data-babel-escape="list" type="button" onClick={onShowList}>← Notes</button>
          <span aria-hidden="true">!</span>
          <h2>Could not load this note</h2>
          <p>{loadError}</p>
          <button type="button" onClick={retryLoading}>Retry</button>
        </section>
      </PageDeckPage>
    );
  }

  return (
    <PageDeckPage pageKey={pageKey}>
      <NoteDetail
        detail={detail}
        importDraft={noteId === null ? draft?.importDraft ?? null : null}
        draftKey={pageKey}
        mode={mode}
        folderId={detail?.folderId ?? draft?.folderId ?? null}
        parentId={mode === "create" ? draft?.parentId ?? null : detail?.parentId ?? null}
        folders={folders}
        notes={notes}
        templates={templates}
        searchFocus={searchFocus}
        backlinks={backlinks}
        loading={loading}
        onEdit={() => setMode("edit")}
        onCreateSubnote={() => {
          if (!detail) return;
          onOpenDraft({
            folderId: detail.folderId,
            parentId: detail.id,
            importDraft: null,
            title: "New subnote",
          });
        }}
        onCancel={cancelEditing}
        onSaved={handleSaved}
        onDeleted={handleDeleted}
        onNavigateNote={onOpenNote}
        onCreateWikilink={handleCreateWikilink}
        onDirtyChange={setDirty}
        onPendingChange={setPending}
        onRegisterSave={(action) => {
          saveActionRef.current = action;
        }}
        onBack={onShowList}
      />
    </PageDeckPage>
  );
}
