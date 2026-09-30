"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PageSessionDescriptor } from "@babel-apps/platform/pages/core";
import {
  PageDeckPage,
  usePageSessionLifecycle,
  usePageSessions,
} from "@babel-apps/platform/pages/react";
import { useCommandPaletteActions } from "@babel-apps/platform/shortcuts/react";

import { EntryDetail, type EntryViewMode } from "@/components/entry-detail";
import { attachReaderUnderlineNote } from "@/components/reader-source-underlines";
import {
  createEntry,
  getEntry,
  getErrorMessage,
  listEntryBacklinks,
} from "@/lib/api-client";
import { entryUnitLabel, entryWorkspaceHref } from "@/lib/entry-routes";
import { entryModeAfterSave } from "@/lib/editor-save-mode";
import type { MarkdownImportDraft } from "@/lib/markdown-import";
import type { EntrySearchFocus } from "@/lib/search-focus";
import type {
  EntryBacklinkDto,
  EntryDetailDto,
  EntryKind,
  EntrySummaryDto,
  FolderDto,
} from "@/lib/types";

export interface EntryDraftSession {
  readonly kind: EntryKind;
  readonly folderId: number;
  readonly parentId: number | null;
  readonly importDraft: MarkdownImportDraft | null;
  readonly title: string;
  readonly linkedUnderlineId?: number;
}

interface EntryPageSessionProps {
  pageKey: string;
  entryId: number | null;
  draft: EntryDraftSession | null;
  kind: EntryKind;
  folders: FolderDto[];
  entries: EntrySummaryDto[];
  editRequested: boolean;
  moving?: boolean;
  onEditRequestConsumed: () => void;
  searchFocus: EntrySearchFocus | null;
  onOpenEntry: (
    id: number,
    kind: EntryKind,
    folderId?: number,
    exactFolder?: boolean,
  ) => void;
  onOpenEntryForEdit: (id: number, kind: EntryKind, folderId: number) => void;
  onOpenLinkedKnowledgeDraft: (folderId: number, underlineId: number) => void;
  onOpenDraft: (input: Omit<EntryDraftSession, "title"> & { title?: string }) => void;
  onRefreshIndex: (folderId: number | null) => Promise<void>;
  onShowList: () => void;
  onError: (message: string) => void;
}

export function savedEntryPage(
  entry: Pick<EntrySummaryDto, "id" | "folderId" | "kind" | "title">,
): PageSessionDescriptor {
  return {
    key: `entry:${entry.id}`,
    kind: entryUnitLabel(entry.kind),
    scope: entry.kind,
    title: entry.title,
    href: entryWorkspaceHref(entry.kind, {
      folderId: entry.folderId,
      entryId: entry.id,
    }),
  };
}

export function EntryPageSession({
  pageKey,
  entryId,
  draft,
  kind,
  folders,
  entries,
  editRequested,
  moving = false,
  onEditRequestConsumed,
  searchFocus,
  onOpenEntry,
  onOpenEntryForEdit,
  onOpenLinkedKnowledgeDraft,
  onOpenDraft,
  onRefreshIndex,
  onShowList,
  onError,
}: EntryPageSessionProps) {
  const router = useRouter();
  const { activeKey, closePage, rekeyPage, setPageStatus, updatePage } = usePageSessions();
  const [detail, setDetail] = useState<EntryDetailDto | null>(null);
  const [backlinks, setBacklinks] = useState<EntryBacklinkDto[]>([]);
  const [mode, setMode] = useState<EntryViewMode>(entryId === null ? "create" : "view");
  const [loading, setLoading] = useState(entryId !== null);
  const [loadError, setLoadError] = useState("");
  const [reloadVersion, setReloadVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const saveActionRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    setPageStatus(pageKey, { dirty, pending: false });
  }, [dirty, pageKey, setPageStatus]);

  usePageSessionLifecycle(pageKey, {
    save: () => {
      if (!dirty) return true;
      saveActionRef.current?.();
      return false;
    },
    discard: () => setDirty(false),
  });

  useEffect(() => {
    if (entryId === null) return;
    let active = true;
    Promise.all([getEntry(entryId), listEntryBacklinks(entryId)])
      .then(([nextDetail, nextBacklinks]) => {
        if (!active) return;
        if (nextDetail.kind !== kind) {
          const nextPage = savedEntryPage(nextDetail);
          updatePage(pageKey, nextPage);
          router.replace(nextPage.href);
          return;
        }
        setDetail(nextDetail);
        setBacklinks(nextBacklinks);
        setMode("view");
        updatePage(pageKey, {
          kind: entryUnitLabel(nextDetail.kind),
          scope: nextDetail.kind,
          title: nextDetail.title,
          href: savedEntryPage(nextDetail).href,
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
  }, [entryId, kind, pageKey, reloadVersion, router, updatePage]);

  const refreshBacklinks = useCallback(async (id: number) => {
    try {
      setBacklinks(await listEntryBacklinks(id));
    } catch (error) {
      onError(getErrorMessage(error));
    }
  }, [onError]);

  async function handleSaved(saved: EntryDetailDto, readAfterSave = false) {
    setDetail(saved);
    setMode(readAfterSave ? "view" : entryModeAfterSave(entryId));
    setDirty(false);
    setLoadError("");
    const nextPage = savedEntryPage(saved);
    if (pageKey !== nextPage.key) rekeyPage(pageKey, nextPage);
    else updatePage(pageKey, nextPage);
    if (draft?.linkedUnderlineId !== undefined) {
      try {
        await attachReaderUnderlineNote(draft.linkedUnderlineId, saved.id);
      } catch (error) {
        onError(`The entry was saved, but its reader underline could not be linked: ${getErrorMessage(error)}`);
      }
    }
    try {
      await Promise.all([
        onRefreshIndex(saved.folderId),
        refreshBacklinks(saved.id),
      ]);
    } catch (error) {
      onError(getErrorMessage(error));
    }
  }

  async function handleDeleted() {
    closePage(pageKey);
    try {
      await onRefreshIndex(detail?.folderId ?? draft?.folderId ?? null);
    } catch (error) {
      onError(getErrorMessage(error));
    }
  }

  async function handleCreateWikilink(title: string, folderId: number) {
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
      await onRefreshIndex(saved.folderId);
      onOpenEntry(saved.id, saved.kind, saved.folderId);
    } catch (error) {
      onError(getErrorMessage(error));
    }
  }

  function cancelEditing(discardConfirmed = false) {
    if (!discardConfirmed && dirty && !window.confirm("Discard your unsaved changes?")) return;
    setDirty(false);
    if (entryId === null) {
      closePage(pageKey);
      onShowList();
      return;
    }
    setMode("view");
  }

  useEffect(() => {
    if (!editRequested || entryId === null || loading || detail === null) return;
    const frame = window.requestAnimationFrame(() => {
      setMode("edit");
      onEditRequestConsumed();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [detail, editRequested, entryId, loading, onEditRequestConsumed]);

  function retryLoading() {
    setLoading(true);
    setLoadError("");
    setReloadVersion((version) => version + 1);
  }

  useCommandPaletteActions(`neum.entry-detail.${pageKey}`, activeKey === pageKey && Boolean(loadError) ? [
    {
      id: "entry.retry",
      label: "Retry loading entry",
      keywords: ["reload", "error"],
      group: "Entries",
      available: !loading,
      run: retryLoading,
    },
  ] : []);

  if (loadError) {
    return (
      <PageDeckPage pageKey={pageKey}>
        <section className="detail-panel error-state" data-babel-pane="detail" tabIndex={-1} role="alert">
          <button className="content-back" data-babel-escape="list" type="button" onClick={onShowList}>← Entries</button>
          <span aria-hidden="true">!</span>
          <h2>Could not load this entry</h2>
          <p>{loadError}</p>
          <button type="button" onClick={retryLoading}>Retry</button>
        </section>
      </PageDeckPage>
    );
  }

  return (
    <PageDeckPage pageKey={pageKey}>
      <EntryDetail
        kind={kind}
        detail={detail}
        importDraft={entryId === null ? draft?.importDraft ?? null : null}
        draftKey={pageKey}
        mode={mode}
        folderId={detail?.folderId ?? draft?.folderId ?? null}
        parentId={mode === "create" ? draft?.parentId ?? null : detail?.parentId ?? null}
        folders={folders}
        entries={entries}
        searchFocus={searchFocus}
        backlinks={backlinks}
        loading={loading || moving}
        onEdit={() => setMode("edit")}
        onCreateSubnote={() => {
          if (!detail) return;
          onOpenDraft({
            kind: detail.kind,
            folderId: detail.folderId,
            parentId: detail.id,
            importDraft: null,
            title: "New subnote",
          });
        }}
        onCancel={cancelEditing}
        onSaved={handleSaved}
        onDeleted={handleDeleted}
        onNavigateEntry={onOpenEntry}
        onCreateLinkedEntry={(underlineId) => {
          if (detail === null) return;
          if (detail.kind === "snippet") {
            onOpenLinkedKnowledgeDraft(detail.folderId, underlineId);
            return;
          }
          onOpenDraft({
            kind: "knowledge",
            folderId: detail.folderId,
            parentId: null,
            importDraft: null,
            title: "New linked entry",
            linkedUnderlineId: underlineId,
          });
        }}
        onEditLinkedEntry={(targetId) => {
          void getEntry(targetId)
            .then((target) => onOpenEntryForEdit(target.id, target.kind, target.folderId))
            .catch((error) => onError(getErrorMessage(error)));
        }}
        onCreateWikilink={handleCreateWikilink}
        onDirtyChange={setDirty}
        onRegisterSave={(action) => {
          saveActionRef.current = action;
        }}
        onBack={onShowList}
      />
    </PageDeckPage>
  );
}
