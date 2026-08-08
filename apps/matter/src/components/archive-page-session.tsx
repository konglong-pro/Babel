"use client";

import { useEffect, useRef, useState } from "react";
import type { PageSessionDescriptor } from "@babel-apps/platform/pages/core";
import {
  PageDeckPage,
  usePageSessionLifecycle,
  usePageSessions,
} from "@babel-apps/platform/pages/react";
import { useCommandPaletteActions } from "@babel-apps/platform/shortcuts/react";

import { ExerciseDetail } from "@/components/exercise-detail";
import { KnowledgeDetail } from "@/components/knowledge-detail";
import {
  createKnowledge,
  getErrorMessage,
  getExercise,
  getExerciseBacklinks,
  getKnowledge,
  getKnowledgeBacklinks,
} from "@/lib/api-client";
import { archiveModeAfterSave } from "@/lib/editor-save-mode";
import type { MarkdownImportDraft } from "@/lib/markdown-import";
import type { ArchiveSearchFocus } from "@/lib/search-focus";
import type {
  BacklinksDto,
  ExerciseDetailDto,
  ExerciseSummaryDto,
  FolderType,
  KnowledgeDetailDto,
  KnowledgeSummaryDto,
  LinkEntityKind,
} from "@/lib/types";

type ArchiveSummary = KnowledgeSummaryDto | ExerciseSummaryDto;
type ArchiveDetail = KnowledgeDetailDto | ExerciseDetailDto;
type ViewMode = "view" | "edit" | "create";

export interface ArchiveDraftSession {
  readonly type: FolderType;
  readonly folderId: number;
  readonly parentId: number | null;
  readonly importDraft: MarkdownImportDraft | null;
  readonly title: string;
}

interface ArchivePageSessionProps {
  pageKey: string;
  itemId: number | null;
  draft: ArchiveDraftSession | null;
  type: FolderType;
  items: ArchiveSummary[];
  editRequested: boolean;
  onEditRequestConsumed: () => void;
  searchFocus: ArchiveSearchFocus | null;
  onOpenEntity: (kind: LinkEntityKind, id: number, folderId?: number) => void;
  onOpenDraft: (
    input: Omit<ArchiveDraftSession, "title"> & { title?: string },
  ) => void;
  onRequestKnowledgeCreation: (title: string) => void;
  onRefreshIndex: () => Promise<void>;
  onShowList: () => void;
  onError: (message: string) => void;
}

function emptyBacklinks(): BacklinksDto {
  return { knowledge: [], exercises: [] };
}

export function archivePageKind(type: FolderType): "Knowledge" | "Exercise" {
  return type === "knowledge" ? "Knowledge" : "Exercise";
}

export function savedArchivePage(
  type: FolderType,
  item: Pick<ArchiveSummary, "id" | "folderId" | "title">,
): PageSessionDescriptor {
  return {
    key: `${type}:${item.id}`,
    kind: archivePageKind(type),
    title: item.title,
    href: `/${type}?folder=${item.folderId}&item=${item.id}`,
    scope: type,
  };
}

export function ArchivePageSession({
  pageKey,
  itemId,
  draft,
  type,
  items,
  editRequested,
  onEditRequestConsumed,
  searchFocus,
  onOpenEntity,
  onOpenDraft,
  onRequestKnowledgeCreation,
  onRefreshIndex,
  onShowList,
  onError,
}: ArchivePageSessionProps) {
  const { activeKey, closePage, rekeyPage, setPageStatus, updatePage } = usePageSessions();
  const [detail, setDetail] = useState<ArchiveDetail | null>(null);
  const [backlinks, setBacklinks] = useState<BacklinksDto>(emptyBacklinks);
  const [mode, setMode] = useState<ViewMode>(itemId === null ? "create" : "view");
  const [loading, setLoading] = useState(itemId !== null);
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
    if (itemId === null) return;
    let active = true;
    const detailRequest = type === "knowledge"
      ? getKnowledge(itemId)
      : getExercise(itemId);
    const backlinksRequest = type === "knowledge"
      ? getKnowledgeBacklinks(itemId)
      : getExerciseBacklinks(itemId);
    Promise.all([detailRequest, backlinksRequest])
      .then(([nextDetail, nextBacklinks]) => {
        if (!active) return;
        setDetail(nextDetail);
        setBacklinks(nextBacklinks);
        setMode("view");
        updatePage(pageKey, {
          title: nextDetail.title,
          href: savedArchivePage(type, nextDetail).href,
          scope: type,
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
  }, [itemId, pageKey, reloadVersion, type, updatePage]);

  async function handleSaved(saved: ArchiveDetail) {
    setDetail(saved);
    setBacklinks(emptyBacklinks());
    setMode(archiveModeAfterSave(itemId));
    setDirty(false);
    setLoadError("");
    const nextPage = savedArchivePage(type, saved);
    if (pageKey !== nextPage.key) rekeyPage(pageKey, nextPage);
    else updatePage(pageKey, nextPage);
    try {
      await onRefreshIndex();
      const nextBacklinks = type === "knowledge"
        ? await getKnowledgeBacklinks(saved.id)
        : await getExerciseBacklinks(saved.id);
      setBacklinks(nextBacklinks);
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

  async function createKnowledgeWikilink(title: string, folderId: number) {
    try {
      const saved = await createKnowledge({
        folderId,
        parentId: null,
        title,
        contentMd: "",
        tags: [],
        exerciseIds: [],
      });
      await onRefreshIndex();
      onOpenEntity("knowledge", saved.id, saved.folderId);
    } catch (error) {
      onError(getErrorMessage(error));
    }
  }

  function cancelEditing() {
    if (dirty && !window.confirm("Discard your unsaved changes?")) return;
    setDirty(false);
    if (itemId === null) {
      closePage(pageKey);
      onShowList();
      return;
    }
    setMode("view");
  }

  useEffect(() => {
    if (!editRequested || itemId === null || loading || detail === null) return;
    const frame = window.requestAnimationFrame(() => {
      setMode("edit");
      onEditRequestConsumed();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [detail, editRequested, itemId, loading, onEditRequestConsumed]);

  function retryLoading() {
    setLoading(true);
    setLoadError("");
    setReloadVersion((version) => version + 1);
  }

  useCommandPaletteActions(`matter.archive-detail.${pageKey}`, activeKey === pageKey && Boolean(loadError) ? [
    {
      id: "archive.retry",
      label: `Retry loading ${type === "knowledge" ? "note" : "exercise"}`,
      keywords: ["reload", "error"],
      group: archivePageKind(type),
      available: !loading,
      run: retryLoading,
    },
  ] : []);

  if (loadError) {
    return (
      <PageDeckPage pageKey={pageKey}>
        <section className="detail-panel error-state" data-babel-pane="detail" tabIndex={-1} role="alert">
          <span aria-hidden="true">!</span>
          <h2>Could not load this {type === "knowledge" ? "note" : "exercise"}</h2>
          <p>{loadError}</p>
          <button type="button" onClick={retryLoading}>Retry</button>
        </section>
      </PageDeckPage>
    );
  }

  return (
    <PageDeckPage pageKey={pageKey}>
      {type === "knowledge" ? (
        <KnowledgeDetail
          detail={detail as KnowledgeDetailDto | null}
          importDraft={itemId === null ? draft?.importDraft ?? null : null}
          draftKey={pageKey}
          mode={mode}
          folderId={detail?.folderId ?? draft?.folderId ?? null}
          pages={items as KnowledgeSummaryDto[]}
          searchFocus={searchFocus}
          createParentId={mode === "create" ? draft?.parentId ?? null : null}
          backlinks={backlinks}
          loading={loading}
          onEdit={() => setMode("edit")}
          onCreateChild={() => {
            if (!detail) return;
            onOpenDraft({
              type,
              folderId: detail.folderId,
              parentId: detail.id,
              importDraft: null,
              title: "New child note",
            });
          }}
          onCancel={cancelEditing}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
          onNavigateEntity={onOpenEntity}
          onCreateWikilink={createKnowledgeWikilink}
          onDirtyChange={setDirty}
          onRegisterSave={(action) => {
            saveActionRef.current = action;
          }}
        />
      ) : (
        <ExerciseDetail
          draftKey={pageKey}
          detail={detail as ExerciseDetailDto | null}
          mode={mode}
          folderId={detail?.folderId ?? draft?.folderId ?? null}
          backlinks={backlinks}
          searchFocus={searchFocus}
          loading={loading}
          onEdit={() => setMode("edit")}
          onCancel={cancelEditing}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
          onNavigateEntity={onOpenEntity}
          onCreateKnowledgeWikilink={onRequestKnowledgeCreation}
          onDirtyChange={setDirty}
          onRegisterSave={(action) => {
            saveActionRef.current = action;
          }}
        />
      )}
    </PageDeckPage>
  );
}
