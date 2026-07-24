"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PageSessionDescriptor } from "@babel-apps/platform/pages/core";
import {
  PageDeckPage,
  usePageSessionLifecycle,
  usePageSessions,
} from "@babel-apps/platform/pages/react";

import { EntryDetail, type EntryViewMode } from "@/components/entry-detail";
import {
  createEntry,
  getEntry,
  getErrorMessage,
  listEntryBacklinks,
} from "@/lib/api-client";
import { entryUnitLabel, entryWorkspaceHref } from "@/lib/entry-routes";
import type { MarkdownImportDraft } from "@/lib/markdown-import";
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
}

interface EntryPageSessionProps {
  pageKey: string;
  entryId: number | null;
  draft: EntryDraftSession | null;
  kind: EntryKind;
  folders: FolderDto[];
  entries: EntrySummaryDto[];
  onOpenEntry: (
    id: number,
    kind: EntryKind,
    folderId?: number,
    exactFolder?: boolean,
  ) => void;
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
  onOpenEntry,
  onRefreshIndex,
  onShowList,
  onError,
}: EntryPageSessionProps) {
  const { closePage, rekeyPage, setPageStatus, updatePage } = usePageSessions();
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
          window.location.replace(savedEntryPage(nextDetail).href);
          return;
        }
        setDetail(nextDetail);
        setBacklinks(nextBacklinks);
        setMode("view");
        updatePage(pageKey, {
          kind: entryUnitLabel(nextDetail.kind),
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
  }, [entryId, kind, pageKey, reloadVersion, updatePage]);

  const refreshBacklinks = useCallback(async (id: number) => {
    try {
      setBacklinks(await listEntryBacklinks(id));
    } catch (error) {
      onError(getErrorMessage(error));
    }
  }, [onError]);

  async function handleSaved(saved: EntryDetailDto) {
    setDetail(saved);
    setMode("view");
    setDirty(false);
    setLoadError("");
    const nextPage = savedEntryPage(saved);
    if (pageKey !== nextPage.key) rekeyPage(pageKey, nextPage);
    else updatePage(pageKey, nextPage);
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

  function cancelEditing() {
    if (dirty && !window.confirm("Discard your unsaved changes?")) return;
    setDirty(false);
    if (entryId === null) {
      closePage(pageKey);
      onShowList();
      return;
    }
    setMode("view");
  }

  function retryLoading() {
    setLoading(true);
    setLoadError("");
    setReloadVersion((version) => version + 1);
  }

  if (loadError) {
    return (
      <PageDeckPage pageKey={pageKey}>
        <section className="detail-panel error-state" role="alert">
          <button className="content-back" type="button" onClick={onShowList}>← Entries</button>
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
        backlinks={backlinks}
        loading={loading}
        onEdit={() => setMode("edit")}
        onCancel={cancelEditing}
        onSaved={handleSaved}
        onDeleted={handleDeleted}
        onNavigateEntry={onOpenEntry}
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
