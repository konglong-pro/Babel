"use client";

import { type ChangeEvent, useMemo, useRef, useState } from "react";
import { NewContentMenu } from "@babel-apps/platform/canvas/react";

import { BEFORE_NAVIGATE_EVENT } from "@/components/app-header";
import {
  useItemReorder,
  type ItemReorderController,
} from "@babel-apps/platform/items/react";
import {
  useListKeyboardNavigation,
  useTreeKeyboardNavigation,
  type ListNavigationElementProps,
  type TreeNavigationElementProps,
} from "@babel-apps/platform/navigation/react";
import { useCommandPaletteActions } from "@babel-apps/platform/shortcuts/react";

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
  onEdit?: (id: number) => void;
  onReorder?: (id: number, position: number) => Promise<void> | void;
  onCreate: (parentId: number | null) => void;
  onImport?: (file: File) => Promise<void> | void;
  onImportFolder?: (files: File[]) => Promise<void> | void;
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
  navigation: ReturnType<typeof useTreeKeyboardNavigation<number>>;
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
  navigation,
}: KnowledgeBranchProps) {
  const children = grouped.get(parentId) ?? [];
  if (children.length === 0) return null;

  return (
    <ul role="presentation">
      {children.map((item) => {
        const hasChildren = (grouped.get(item.id)?.length ?? 0) > 0;
        const expanded = expandedIds.has(item.id);
        return (
          <li key={item.id} role="presentation">
            <div
              className={`item-tree-row ${reorder.dropClassName(item.id)}`.trim()}
              {...reorder.rowProps(item.id)}
            >
              {hasChildren ? (
                <span
                  aria-hidden="true"
                  className="item-disclosure"
                  data-babel-tree-disclosure=""
                  aria-expanded={expanded}
                  title={`${expanded ? "Collapse" : "Expand"} ${item.title}`}
                  onClick={() => onToggle(item.id)}
                />
              ) : (
                <span aria-hidden="true" className="item-disclosure" data-babel-tree-disclosure-spacer="" style={{ visibility: "hidden" }} />
              )}
              <ItemCard
                item={item}
                selected={selectedId === item.id}
                onSelect={onSelect}
                reorder={reorder}
                keyboardProps={navigation.getTreeItemProps(item.id)}
              />
            </div>
            {expanded && hasChildren ? (
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
                  navigation={navigation}
                />
                <span
                  aria-hidden="true"
                  className="inline-tree-create"
                  data-babel-tree-inline-create=""
                  title={`New subnote under ${item.title}`}
                  onClick={() => onCreate(item.id)}
                >
                  New subnote
                </span>
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
  keyboardProps,
}: {
  item: ArchiveSummary;
  selected: boolean;
  onSelect: (id: number) => void;
  reorder: ItemReorderController;
  keyboardProps: TreeNavigationElementProps | ListNavigationElementProps;
}) {
  return (
    <button
      type="button"
      className={selected ? "item-card selected" : "item-card"}
      {...reorder.selectionProps(item.id)}
      {...keyboardProps}
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
  onEdit,
  onReorder,
  onCreate,
  onImport,
  onImportFolder,
}: ItemListProps) {
  const importInputRef = useRef<HTMLInputElement>(null);
  const folderImportInputRef = useRef<HTMLInputElement>(null);
  const importMenuRef = useRef<HTMLDetailsElement>(null);
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

  const knowledgeNavigationItems = useMemo(() => {
    const navigationItems: Array<{
      id: number;
      label: string;
      parentId: number | null;
      hasChildren: boolean;
      expanded: boolean;
      level: number;
    }> = [];
    const visit = (parentId: number | null, level: number) => {
      for (const item of groupedKnowledge.get(parentId) ?? []) {
        const hasChildren = (groupedKnowledge.get(item.id)?.length ?? 0) > 0;
        const expanded = revealedState.expandedIds.has(item.id);
        navigationItems.push({
          id: item.id,
          label: item.title,
          parentId,
          hasChildren,
          expanded,
          level,
        });
        if (expanded) visit(item.id, level + 1);
      }
    };
    visit(null, 1);
    return navigationItems;
  }, [groupedKnowledge, revealedState.expandedIds]);

  const treeNavigation = useTreeKeyboardNavigation<number>({
    items: knowledgeNavigationItems,
    selectedId: selectedId ?? undefined,
    onActivate: onSelect,
    onEdit: onEdit ?? onSelect,
    onExpandedChange: (id) => toggleKnowledge(id),
    label: "Knowledge page tree",
  });
  const listNavigation = useListKeyboardNavigation<number>({
    items: type === "exercise" ? items.map((item) => ({ id: item.id, label: item.title })) : [],
    selectedId: selectedId ?? undefined,
    onActivate: onSelect,
    onEdit: onEdit ?? onSelect,
    label: "Exercise list",
  });

  useCommandPaletteActions(`matter.${type}.items`, [
    {
      id: "item.new",
      label: type === "knowledge" ? "New knowledge note" : "New exercise",
      group: "Content",
      available: selectedFolderId !== null,
      run: () => onCreate(null),
    },
    {
      id: "item.newSubnote",
      label: "New subnote",
      group: "Content",
      available: type === "knowledge" && selectedId !== null,
      run: () => {
        if (selectedId !== null) onCreate(selectedId);
      },
    },
    {
      id: "item.import",
      label: "Import Markdown file",
      group: "Content",
      available: type === "knowledge" && Boolean(onImport) && selectedFolderId !== null,
      run: () => importInputRef.current?.click(),
    },
    {
      id: "item.importFolder",
      label: "Import Markdown folder",
      group: "Content",
      available: type === "knowledge" && Boolean(onImportFolder) && selectedFolderId !== null,
      run: () => folderImportInputRef.current?.click(),
    },
  ]);

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

  function chooseMarkdownFolder(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (importMenuRef.current) importMenuRef.current.open = false;
    if (files.length > 0) void onImportFolder?.(files);
  }

  return (
    <aside
      className="archive-panel item-panel"
      data-babel-pane="items"
      tabIndex={-1}
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
              <input
                ref={(node) => {
                  folderImportInputRef.current = node;
                  node?.setAttribute("webkitdirectory", "");
                  node?.setAttribute("directory", "");
                }}
                className="sr-only"
                type="file"
                accept=".md,text/markdown,image/png,image/jpeg,image/webp,image/gif"
                multiple
                tabIndex={-1}
                onChange={chooseMarkdownFolder}
              />
              <details ref={importMenuRef} className="babel-import-menu">
                <summary
                  aria-disabled={selectedFolderId === null}
                  title={selectedFolderId === null ? "Select a folder first" : undefined}
                  onClick={(event) => {
                    if (selectedFolderId === null) event.preventDefault();
                  }}
                >
                  Import
                </summary>
                <div>
                  <button
                    type="button"
                    onClick={() => {
                      if (importMenuRef.current) importMenuRef.current.open = false;
                      importInputRef.current?.click();
                    }}
                  >
                    Import Markdown file
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (importMenuRef.current) importMenuRef.current.open = false;
                      folderImportInputRef.current?.click();
                    }}
                  >
                    Import Markdown folder
                  </button>
                </div>
              </details>
            </>
          ) : null}
          <NewContentMenu
            beforeNavigateEvent={BEFORE_NAVIGATE_EVENT}
            contentLabel={type === "knowledge" ? "New knowledge note" : "New exercise"}
            contentAvailable={selectedFolderId !== null}
            className="primary-button small"
            unavailableTitle="Select a folder first"
            onCreateContent={() => onCreate(null)}
          />
          {type === "knowledge" ? (
            <button
              type="button"
              data-babel-child-create=""
              disabled={selectedId === null}
              title={selectedId === null ? "Select an item before creating a subnote" : undefined}
              onClick={() => {
                if (selectedId !== null) onCreate(selectedId);
              }}
            >
              New subnote
            </button>
          ) : null}
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
        <nav className="item-tree" {...treeNavigation.treeProps}>
          <KnowledgeBranch
            parentId={null}
            grouped={groupedKnowledge}
            selectedId={selectedId}
            expandedIds={revealedState.expandedIds}
            onSelect={onSelect}
            onToggle={toggleKnowledge}
            reorder={reorder}
            onCreate={onCreate}
            navigation={treeNavigation}
          />
        </nav>
      ) : (
        <ul className="item-list" {...listNavigation.listboxProps}>
          {items.map((item) => (
            <li key={item.id} role="presentation">
              <div
                className={`item-list-row ${reorder.dropClassName(item.id)}`.trim()}
                {...reorder.rowProps(item.id)}
              >
                <ItemCard
                  item={item}
                  selected={selectedId === item.id}
                  onSelect={onSelect}
                  reorder={reorder}
                  keyboardProps={listNavigation.getOptionProps(item.id)}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
