"use client";

import { type ChangeEvent, useMemo, useRef, useState } from "react";
import {
  useItemReorder,
  type ItemReorderController,
} from "@babel-apps/platform/items/react";
import { useTreeKeyboardNavigation } from "@babel-apps/platform/navigation/react";
import { useCommandPaletteActions } from "@babel-apps/platform/shortcuts/react";

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
  onEdit?: (id: number) => void;
  onReorder?: (id: number, position: number) => Promise<void> | void;
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
  reorder: ItemReorderController;
  navigation: ReturnType<typeof useTreeKeyboardNavigation<number>>;
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
  reorder,
  navigation,
}: EntryBranchProps) {
  const children = grouped.get(parentId) ?? [];
  if (children.length === 0) return null;

  return (
    <ul role="presentation">
      {children.map((entry) => {
        const hasChildren = (grouped.get(entry.id)?.length ?? 0) > 0;
        const expanded = expandedIds.has(entry.id);
        return (
          <li key={entry.id} role="presentation">
            <div
              className={`entry-node-row ${reorder.dropClassName(entry.id)}`.trim()}
              {...reorder.rowProps(entry.id)}
            >
              {hasChildren ? (
                <span
                  aria-hidden="true"
                  className="entry-disclosure"
                  data-babel-tree-disclosure=""
                  aria-expanded={expanded}
                  title={`${expanded ? "Collapse" : "Expand"} ${entry.title}`}
                  onClick={() => onToggle(entry.id)}
                />
              ) : (
                <span aria-hidden="true" className="entry-disclosure" data-babel-tree-disclosure-spacer="" style={{ visibility: "hidden" }} />
              )}
              <button
                type="button"
                className={selectedEntryId === entry.id ? "entry-card selected" : "entry-card"}
                {...reorder.selectionProps(entry.id)}
                {...navigation.getTreeItemProps(entry.id)}
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
            {expanded && hasChildren ? (
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
                  reorder={reorder}
                  navigation={navigation}
                />
                <span
                  aria-hidden="true"
                  className="entry-inline-create"
                  data-babel-tree-inline-create=""
                  title={`New subnote under ${entry.title}`}
                  onClick={() => onCreateChild(entry.id)}
                >
                  + New subnote
                </span>
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
  onEdit,
  onReorder,
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
  const reorder = useItemReorder({
    items: entries.map((entry) => ({
      id: entry.id,
      parentId: entry.parentId,
      scopeId: `${entry.kind}:${entry.folderId}`,
    })),
    disabled: selectedFolderId === null,
    onReorder: onReorder ?? (() => undefined),
  });
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

  const navigationItems = useMemo(() => {
    const items: Array<{
      id: number;
      label: string;
      parentId: number | null;
      hasChildren: boolean;
      expanded: boolean;
      level: number;
    }> = [];
    const visit = (parentId: number | null, level: number) => {
      for (const entry of grouped.get(parentId) ?? []) {
        const hasChildren = (grouped.get(entry.id)?.length ?? 0) > 0;
        const expanded = visibleExpandedIds.has(entry.id);
        items.push({ id: entry.id, label: entry.title, parentId, hasChildren, expanded, level });
        if (expanded) visit(entry.id, level + 1);
      }
    };
    visit(null, 1);
    return items;
  }, [grouped, visibleExpandedIds]);

  const navigation = useTreeKeyboardNavigation<number>({
    items: navigationItems,
    selectedId: selectedEntryId ?? undefined,
    onActivate: onSelect,
    onEdit: onEdit ?? onSelect,
    onExpandedChange: (id) => handleToggle(id),
    label: "Entry page tree",
  });

  useCommandPaletteActions(`neum.${kind}.entries`, [
    {
      id: "entry.new",
      label: `New ${unitLabel.toLocaleLowerCase()} entry`,
      group: "Entries",
      available: selectedFolderId !== null,
      run: onCreate,
    },
    {
      id: "entry.newSubnote",
      label: "New subnote",
      group: "Entries",
      available: selectedEntryId !== null,
      run: () => {
        if (selectedEntryId !== null) onCreateChild(selectedEntryId);
      },
    },
    {
      id: "entry.import",
      label: "Import Markdown",
      group: "Entries",
      available: kind === "knowledge" && Boolean(onImport) && selectedFolderId !== null,
      run: () => importInputRef.current?.click(),
    },
    ...(entries.length < total ? [{
      id: "entry.loadMore",
      label: "Load more entries",
      group: "Entries",
      available: !loadingMore,
      run: () => void onLoadMore(),
    }] : []),
  ]);

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
      data-babel-pane="items"
      tabIndex={-1}
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
          <button
            type="button"
            data-babel-child-create=""
            disabled={selectedEntryId === null}
            title={selectedEntryId === null ? "Select an entry before creating a subnote" : undefined}
            onClick={() => {
              if (selectedEntryId !== null) onCreateChild(selectedEntryId);
            }}
          >
            New subnote
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

      <nav className="entry-tree" {...navigation.treeProps}>
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
          reorder={reorder}
          navigation={navigation}
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
