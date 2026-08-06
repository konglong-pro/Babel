"use client";

import { type ChangeEvent, useMemo, useRef, useState } from "react";
import {
  useItemReorder,
  type ItemReorderController,
} from "@babel-apps/platform/items/react";

import {
  type PageExpansionState,
  pageSelectionPath,
  revealPageSelection,
  togglePageExpansion,
} from "@/components/page-tree-state";
import { formatDate, Tags } from "@/components/shared";
import type { ExerciseSummaryDto, FolderType, KnowledgeSummaryDto } from "@/lib/types";

type ArchiveSummary = KnowledgeSummaryDto | ExerciseSummaryDto;

interface ItemListProps {
  type: FolderType;
  items: ArchiveSummary[];
  selectedId: number | null;
  selectedFolderId: number | null;
  loading?: boolean;
  referencePanelOpen?: boolean;
  onSelect: (id: number) => void;
  onReorder?: (id: number, position: number) => Promise<void> | void;
  onCreate: (parentId: number | null) => void;
  onImport?: (file: File) => Promise<void> | void;
}

interface KnowledgeBranchProps {
  parentId: number | null;
  grouped: Map<number | null, KnowledgeSummaryDto[]>;
  selectedId: number | null;
  expandedIds: ReadonlySet<number>;
  onSelect: (id: number) => void;
  onToggle: (id: number) => void;
  reorder: ItemReorderController;
  onCreate: (parentId: number) => void;
}

function KnowledgeBranch({
  parentId,
  grouped,
  selectedId,
  expandedIds,
  onSelect,
  onToggle,
  reorder,
  onCreate,
}: KnowledgeBranchProps) {
  const children = grouped.get(parentId) ?? [];
  if (children.length === 0) return null;

  return (
    <ul>
      {children.map((item) => {
        const expanded = expandedIds.has(item.id);
        return (
          <li key={item.id}>
            <div
              className={`item-tree-row ${reorder.dropClassName(item.id)}`.trim()}
              {...reorder.rowProps(item.id)}
            >
              <button
                type="button"
                className="item-disclosure"
                aria-expanded={expanded}
                aria-label={`${expanded ? "Collapse" : "Expand"} ${item.title}`}
                onClick={() => onToggle(item.id)}
              />
              <ItemCard
                item={item}
                selected={selectedId === item.id}
                onSelect={onSelect}
                reorder={reorder}
              />
            </div>
            {expanded ? (
              <div className="item-tree-children">
                <KnowledgeBranch
                  parentId={item.id}
                  grouped={grouped}
                  selectedId={selectedId}
                  expandedIds={expandedIds}
                  onSelect={onSelect}
                  onToggle={onToggle}
                  reorder={reorder}
                  onCreate={onCreate}
                />
                <button
                  type="button"
                  className="inline-tree-create"
                  onClick={() => onCreate(item.id)}
                >
                  New subnote
                </button>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function ItemCard({
  item,
  selected,
  onSelect,
  reorder,
}: {
  item: ArchiveSummary;
  selected: boolean;
  onSelect: (id: number) => void;
  reorder: ItemReorderController;
}) {
  return (
    <button
      type="button"
      className={selected ? "item-card selected" : "item-card"}
      {...reorder.selectionProps(item.id)}
      aria-current={selected ? "true" : undefined}
      onClick={() => onSelect(item.id)}
    >
      <strong>{item.title}</strong>
      <Tags tags={item.tags} />
      <time dateTime={item.updatedAt}>Updated {formatDate(item.updatedAt)}</time>
    </button>
  );
}

export function ItemList({
  type,
  items,
  selectedId,
  selectedFolderId,
  loading,
  referencePanelOpen = false,
  onSelect,
  onReorder,
  onCreate,
  onImport,
}: ItemListProps) {
  const importInputRef = useRef<HTMLInputElement>(null);
  const itemName = type === "knowledge" ? "Knowledge Notes" : "Exercises";
  const reorder = useItemReorder({
    items: items.map((item) => ({
      id: item.id,
      parentId: "parentId" in item ? item.parentId : null,
      scopeId: item.folderId,
    })),
    disabled: selectedFolderId === null,
    onReorder: onReorder ?? (() => undefined),
  });
  const knowledgeItems = useMemo(
    () => (type === "knowledge" ? (items as KnowledgeSummaryDto[]) : []),
    [items, type],
  );
  const [expansionState, setExpansionState] = useState<PageExpansionState>(() => ({
    expandedIds: new Set(),
    revealedPathKey: "",
  }));
  const selectedPath = useMemo(
    () => pageSelectionPath(knowledgeItems, selectedId),
    [knowledgeItems, selectedId],
  );
  const revealedState = revealPageSelection(expansionState, selectedPath);
  if (revealedState !== expansionState) setExpansionState(revealedState);

  const groupedKnowledge = useMemo(() => {
    const grouped = new Map<number | null, KnowledgeSummaryDto[]>();
    for (const item of knowledgeItems) {
      const siblings = grouped.get(item.parentId) ?? [];
      siblings.push(item);
      grouped.set(item.parentId, siblings);
    }
    return grouped;
  }, [knowledgeItems]);

  function toggleKnowledge(id: number) {
    setExpansionState((current) => {
      const revealed = revealPageSelection(current, selectedPath);
      return {
        ...revealed,
        expandedIds: togglePageExpansion(revealed.expandedIds, id),
      };
    });
  }

  function chooseMarkdown(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void onImport?.(file);
  }

  return (
    <aside
      className="archive-panel item-panel"
      aria-label={`${itemName} list`}
      aria-hidden={referencePanelOpen}
      inert={referencePanelOpen}
    >
      <div className="panel-heading compact">
        <div>
          <span className="eyebrow">Content</span>
          <h2>{selectedFolderId === null ? `All ${itemName}` : itemName}</h2>
        </div>
        <div className="item-list-actions content-list-actions">
          {type === "knowledge" && onImport !== undefined ? (
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
                className="small"
                disabled={selectedFolderId === null}
                title={selectedFolderId === null ? "Select a folder first" : undefined}
                onClick={() => importInputRef.current?.click()}
              >
                Import
              </button>
            </>
          ) : null}
          <button
            type="button"
            data-babel-command="new"
            className="primary-button small"
            disabled={selectedFolderId === null}
            title={selectedFolderId === null ? "Select a folder first" : undefined}
            onClick={() => onCreate(null)}
          >
            New
          </button>
        </div>
      </div>

      {selectedFolderId === null ? (
        <p className="panel-hint">The root shows everything. Select a folder before creating content.</p>
      ) : null}
      {loading ? <p className="panel-status">Loading content…</p> : null}
      {!loading && items.length === 0 ? (
        <div className="empty-state compact-empty">
          <span aria-hidden="true">∅</span>
          <p>No {itemName.toLocaleLowerCase()} here yet.</p>
        </div>
      ) : null}

      {type === "knowledge" ? (
        <nav className="item-tree" aria-label="Knowledge page tree">
          <KnowledgeBranch
            parentId={null}
            grouped={groupedKnowledge}
            selectedId={selectedId}
            expandedIds={revealedState.expandedIds}
            onSelect={onSelect}
            onToggle={toggleKnowledge}
            reorder={reorder}
            onCreate={onCreate}
          />
        </nav>
      ) : (
        <ul className="item-list">
          {items.map((item) => (
            <li key={item.id}>
              <div
                className={`item-list-row ${reorder.dropClassName(item.id)}`.trim()}
                {...reorder.rowProps(item.id)}
              >
                <ItemCard
                  item={item}
                  selected={selectedId === item.id}
                  onSelect={onSelect}
                  reorder={reorder}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
