"use client";

import { type ChangeEvent, useMemo, useRef, useState } from "react";

import {
  type EntryExpansionState,
  entrySelectionPath,
  revealEntrySelection,
  toggleEntryExpansion,
} from "@/components/entry-tree-state";
import { entryKindLabel, folderPath, formatDate, Tags } from "@/components/shared";
import { entryUnitLabel } from "@/lib/entry-routes";
import type { EntryKind, EntrySummaryDto, FolderDto } from "@/lib/types";

interface EntryListProps {
  kind: EntryKind;
  entries: readonly EntrySummaryDto[];
  total: number;
  folders: ReadonlyMap<number, FolderDto>;
  selectedFolderId: number | null;
  selectedEntryId: number | null;
  loading?: boolean;
  loadingMore?: boolean;
  referencePanelOpen?: boolean;
  onSelect: (id: number) => void;
  onLoadMore: () => Promise<void>;
  onImport?: (file: File) => Promise<void> | void;
  onCreate: () => void;
  onCreateChild: (parentId: number) => void;
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

interface EntryBranchProps {
  parentId: number | null;
  grouped: ReadonlyMap<number | null, readonly EntrySummaryDto[]>;
  folders: ReadonlyMap<number, FolderDto>;
  selectedFolderId: number | null;
  selectedEntryId: number | null;
  expandedIds: ReadonlySet<number>;
  onSelect: (id: number) => void;
  onToggle: (id: number) => void;
  onCreateChild: (parentId: number) => void;
}

function EntryBranch({
  parentId,
  grouped,
  folders,
  selectedFolderId,
  selectedEntryId,
  expandedIds,
  onSelect,
  onToggle,
  onCreateChild,
}: EntryBranchProps) {
  const children = grouped.get(parentId) ?? [];
  if (children.length === 0) return null;

  return (
    <ul>
      {children.map((entry) => {
        const expanded = expandedIds.has(entry.id);
        return (
          <li key={entry.id}>
            <div className="entry-node-row">
              <button
                type="button"
                className="entry-disclosure"
                aria-expanded={expanded}
                aria-label={`${expanded ? "Collapse" : "Expand"} ${entry.title}`}
                onClick={() => onToggle(entry.id)}
              />
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
            </div>
            {expanded ? (
              <div className="entry-children">
                <EntryBranch
                  parentId={entry.id}
                  grouped={grouped}
                  folders={folders}
                  selectedFolderId={selectedFolderId}
                  selectedEntryId={selectedEntryId}
                  expandedIds={expandedIds}
                  onSelect={onSelect}
                  onToggle={onToggle}
                  onCreateChild={onCreateChild}
                />
                <button
                  type="button"
                  className="entry-inline-create"
                  onClick={() => onCreateChild(entry.id)}
                >
                  + New subnote
                </button>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function EntryList({
  kind,
  entries,
  total,
  folders,
  selectedFolderId,
  selectedEntryId,
  loading,
  loadingMore,
  referencePanelOpen = false,
  onSelect,
  onLoadMore,
  onImport,
  onCreate,
  onCreateChild,
  onBack,
}: EntryListProps) {
  const importInputRef = useRef<HTMLInputElement>(null);
  const unitLabel = entryUnitLabel(kind);
  const selectedFolder = selectedFolderId === null ? undefined : folders.get(selectedFolderId);
  const [expansionState, setExpansionState] = useState<EntryExpansionState>(() => ({
    expandedIds: new Set(),
    revealedPathKey: "",
  }));
  const selectionPath = useMemo(
    () => entrySelectionPath(entries, selectedEntryId),
    [entries, selectedEntryId],
  );
  const revealedExpansionState = revealEntrySelection(expansionState, selectionPath);
  if (revealedExpansionState !== expansionState) {
    setExpansionState(revealedExpansionState);
  }
  const visibleExpandedIds = revealedExpansionState.expandedIds;
  const grouped = useMemo(() => {
    const entryIds = new Set(entries.map(({ id }) => id));
    const result = new Map<number | null, EntrySummaryDto[]>();
    for (const entry of entries) {
      const parentId =
        entry.parentId !== null && entryIds.has(entry.parentId) ? entry.parentId : null;
      const siblings = result.get(parentId) ?? [];
      siblings.push(entry);
      result.set(parentId, siblings);
    }
    return result;
  }, [entries]);

  function handleToggle(entryId: number) {
    setExpansionState((current) => {
      const revealed = revealEntrySelection(current, selectionPath);
      return {
        ...revealed,
        expandedIds: toggleEntryExpansion(revealed.expandedIds, entryId),
      };
    });
  }

  function chooseMarkdown(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file && onImport) void onImport(file);
  }

  return (
    <aside
      className="workspace-panel entry-panel"
      aria-label={`${unitLabel} entries`}
      aria-hidden={referencePanelOpen}
      inert={referencePanelOpen}
    >
      <button className="mobile-back" type="button" onClick={onBack}>
        <span aria-hidden="true">←</span> Library
      </button>
      <div className="panel-heading entry-list-heading">
        <div>
          <span className="eyebrow">{unitLabel}</span>
          <h2>{selectedFolder?.name ?? "All entries"}</h2>
          <p>{total} {total === 1 ? "entry" : "entries"}</p>
        </div>
        <div className="entry-list-actions content-list-actions">
          {kind === "knowledge" && onImport ? (
            <>
              <input
                ref={importInputRef}
                className="sr-only"
                type="file"
                accept=".md,text/markdown,text/plain"
                tabIndex={-1}
                onChange={chooseMarkdown}
              />
              <button
                type="button"
                disabled={selectedFolderId === null}
                title={selectedFolderId === null
                  ? "Select a folder before importing Markdown"
                  : undefined}
                onClick={() => importInputRef.current?.click()}
              >
                Import
              </button>
            </>
          ) : null}
          <button
            type="button"
            data-babel-command="new"
            className="primary-button"
            disabled={selectedFolderId === null}
            title={selectedFolderId === null ? "Select a folder before creating an entry" : undefined}
            onClick={onCreate}
          >
            New
          </button>
        </div>
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
              ? `Your ${unitLabel.toLocaleLowerCase()} unit is waiting for its first entry.`
              : kind === "snippet"
                ? "Capture a code snippet in this folder."
                : "Capture a concept in this folder."}
          </p>
        </div>
      ) : null}

      <nav className="entry-tree" aria-label="Entry page tree">
        <EntryBranch
          parentId={null}
          grouped={grouped}
          folders={folders}
          selectedFolderId={selectedFolderId}
          selectedEntryId={selectedEntryId}
          expandedIds={visibleExpandedIds}
          onSelect={onSelect}
          onToggle={handleToggle}
          onCreateChild={onCreateChild}
        />
      </nav>
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
