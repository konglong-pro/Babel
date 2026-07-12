"use client";

import { useState } from "react";

import { ConfirmButton, entryKindLabel, formatDate, Tags } from "@/components/shared";
import { getErrorMessage } from "@/lib/api-client";
import type { TrashEntryDto } from "@/lib/types";

interface TrashPanelProps {
  items: readonly TrashEntryDto[];
  total: number;
  selectedTrashId: number | null;
  loading: boolean;
  loadingMore: boolean;
  onSelect: (item: TrashEntryDto) => void;
  onLoadMore: () => Promise<void>;
  onRestore: (item: TrashEntryDto) => Promise<void>;
  onPermanentlyDelete: (item: TrashEntryDto) => Promise<void>;
  onBack: () => void;
}

export function TrashList({
  items,
  total,
  selectedTrashId,
  loading,
  loadingMore,
  onSelect,
  onLoadMore,
  onBack,
}: Pick<
  TrashPanelProps,
  | "items"
  | "total"
  | "selectedTrashId"
  | "loading"
  | "loadingMore"
  | "onSelect"
  | "onLoadMore"
  | "onBack"
>) {
  return (
    <aside className="workspace-panel entry-panel" aria-label="Trash entries">
      <button className="mobile-back" type="button" onClick={onBack}>
        <span aria-hidden="true">←</span> Library
      </button>
      <div className="panel-heading entry-list-heading">
        <div>
          <span className="eyebrow">Recovery</span>
          <h2>Trash</h2>
          <p>{total} {total === 1 ? "entry" : "entries"}</p>
        </div>
      </div>
      <p className="panel-hint">Entries remain here until you permanently delete them.</p>
      {loading ? <p className="panel-status">Loading trash…</p> : null}
      {!loading && items.length === 0 ? (
        <div className="empty-state compact-empty">
          <span aria-hidden="true">0</span>
          <h3>Trash is empty</h3>
          <p>Deleted entries will appear here.</p>
        </div>
      ) : null}
      <ul className="entry-list">
        {items.map((item) => (
          <li key={item.trashId}>
            <button
              type="button"
              className={selectedTrashId === item.trashId ? "entry-card selected" : "entry-card"}
              aria-current={selectedTrashId === item.trashId ? "page" : undefined}
              onClick={() => onSelect(item)}
            >
              <span className="entry-kind">{entryKindLabel(item.kind)}</span>
              <strong>{item.title}</strong>
              <Tags tags={item.tags} />
              <time dateTime={item.deletedAt}>Deleted {formatDate(item.deletedAt)}</time>
            </button>
          </li>
        ))}
      </ul>
      {items.length < total ? (
        <div className="panel-status">
          <p>Showing {items.length} of {total} deleted entries.</p>
          <button
            className="primary-button"
            type="button"
            disabled={loadingMore}
            onClick={() => void onLoadMore()}
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      ) : null}
    </aside>
  );
}

export function TrashDetail({
  item,
  onRestore,
  onPermanentlyDelete,
  onBack,
}: {
  item: TrashEntryDto | null;
  onRestore: (item: TrashEntryDto) => Promise<void>;
  onPermanentlyDelete: (item: TrashEntryDto) => Promise<void>;
  onBack: () => void;
}) {
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState("");

  if (!item) {
    return (
      <section className="detail-panel empty-state" aria-label="Trash entry details">
        <button className="content-back" type="button" onClick={onBack}>
          <span aria-hidden="true">←</span> Trash
        </button>
        <span aria-hidden="true">T</span>
        <h2>Recovery area</h2>
        <p>Select an entry to restore it or remove it permanently.</p>
      </section>
    );
  }

  async function restore() {
    setRestoring(true);
    setError("");
    try {
      await onRestore(item!);
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setRestoring(false);
    }
  }

  return (
    <article className="detail-panel document-view">
      <button className="content-back" type="button" onClick={onBack}>
        <span aria-hidden="true">←</span> Trash
      </button>
      <header className="document-header">
        <div>
          <span className="eyebrow">Deleted {entryKindLabel(item.kind)}</span>
          <h1>{item.title}</h1>
          <Tags tags={item.tags} />
          <p className="document-meta">
            Deleted <time dateTime={item.deletedAt}>{formatDate(item.deletedAt)}</time>
          </p>
        </div>
        <div className="document-actions">
          <button className="primary-button" type="button" disabled={restoring} onClick={restore}>
            {restoring ? "Restoring…" : "Restore"}
          </button>
          <ConfirmButton
            className="danger-ghost"
            title="Permanently delete entry"
            description={`Permanently delete “${item.title}” and its managed images? This cannot be undone.`}
            confirmLabel="Delete permanently"
            onConfirm={() => onPermanentlyDelete(item)}
          >
            Delete permanently
          </ConfirmButton>
        </div>
      </header>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <section className="document-content" aria-label="Deleted entry content">
        {item.notesMd ? <pre className="trash-source">{item.notesMd}</pre> : null}
        {item.kind === "snippet" ? (
          <>
            <p className="code-meta">
              <strong>{item.language}</strong>
              {item.filename ? <span>{item.filename}</span> : null}
            </p>
            <pre className="code-block"><code>{item.code}</code></pre>
          </>
        ) : null}
      </section>
    </article>
  );
}
