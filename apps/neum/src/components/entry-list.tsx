"use client";

import { entryKindLabel, folderPath, formatDate, Tags } from "@/components/shared";
import type { EntrySummaryDto, FolderDto } from "@/lib/types";

interface EntryListProps {
  entries: readonly EntrySummaryDto[];
  total: number;
  folders: ReadonlyMap<number, FolderDto>;
  selectedFolderId: number | null;
  selectedEntryId: number | null;
  loading?: boolean;
  loadingMore?: boolean;
  onSelect: (id: number) => void;
  onLoadMore: () => Promise<void>;
  onCreate: () => void;
  onBack: () => void;
}

function relativePath(
  folderId: number,
  selectedFolderId: number | null,
  folders: ReadonlyMap<number, FolderDto>,
): string {
  const path = folderPath(folderId, folders);
  if (selectedFolderId === null) {
    return path.map((folder) => folder.name).join(" / ") || "Unknown folder";
  }

  const selectedIndex = path.findIndex((folder) => folder.id === selectedFolderId);
  if (selectedIndex < 0) {
    return path.map((folder) => folder.name).join(" / ") || "Unknown folder";
  }
  const relative = path.slice(selectedIndex + 1).map((folder) => folder.name);
  return relative.length ? relative.join(" / ") : "This folder";
}

export function EntryList({
  entries,
  total,
  folders,
  selectedFolderId,
  selectedEntryId,
  loading,
  loadingMore,
  onSelect,
  onLoadMore,
  onCreate,
  onBack,
}: EntryListProps) {
  const selectedFolder = selectedFolderId === null ? undefined : folders.get(selectedFolderId);

  return (
    <aside className="workspace-panel entry-panel" aria-label="Entries list">
      <button className="mobile-back" type="button" onClick={onBack}>
        <span aria-hidden="true">←</span> Library
      </button>
      <div className="panel-heading entry-list-heading">
        <div>
          <span className="eyebrow">Entries</span>
          <h2>{selectedFolder?.name ?? "All entries"}</h2>
          <p>{total} {total === 1 ? "entry" : "entries"}</p>
        </div>
        <button
          type="button"
          className="primary-button"
          disabled={selectedFolderId === null}
          title={selectedFolderId === null ? "Select a folder before creating an entry" : undefined}
          onClick={onCreate}
        >
          New entry
        </button>
      </div>

      {selectedFolderId === null ? (
        <p className="panel-hint">
          Select a folder to create an entry. All entries is a read-only collection view.
        </p>
      ) : null}
      {loading ? <p className="panel-status">Loading entries…</p> : null}
      {!loading && entries.length === 0 ? (
        <div className="empty-state compact-empty">
          <span aria-hidden="true">N</span>
          <h3>No entries here</h3>
          <p>
            {selectedFolderId === null
              ? "Your knowledge base is waiting for its first entry."
              : "Capture a concept or code snippet in this folder."}
          </p>
        </div>
      ) : null}

      <ul className="entry-list">
        {entries.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              className={selectedEntryId === entry.id ? "entry-card selected" : "entry-card"}
              aria-current={selectedEntryId === entry.id ? "page" : undefined}
              onClick={() => onSelect(entry.id)}
            >
              <span className="entry-path">
                {relativePath(entry.folderId, selectedFolderId, folders)}
              </span>
              <span className="entry-kind">{entryKindLabel(entry.kind)}</span>
              <strong>{entry.title}</strong>
              <Tags tags={entry.tags} />
              <time dateTime={entry.updatedAt}>Updated {formatDate(entry.updatedAt)}</time>
            </button>
          </li>
        ))}
      </ul>
      {entries.length < total ? (
        <div className="panel-status">
          <p>Showing the latest {entries.length} entries.</p>
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
