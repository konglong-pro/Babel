"use client";

import { type ChangeEvent, useMemo, useRef, useState } from "react";
import { NewContentMenu } from "@babel-apps/platform/canvas/react";

import { BEFORE_NAVIGATE_EVENT } from "@/components/app-header";
import {
  useItemReorder,
  type ItemReorderController,
} from "@babel-apps/platform/items/react";
import { useTreeKeyboardNavigation } from "@babel-apps/platform/navigation/react";
import { useCommandPaletteActions } from "@babel-apps/platform/shortcuts/react";

import {
  noteSelectionPath,
  revealNoteSelection,
  toggleNoteExpansion,
  type NoteExpansionState,
} from "@/components/note-tree-state";
import { folderPath, formatDate, Tags } from "@/components/shared";
import type { FolderDto, NoteSummaryDto } from "@/lib/types";

interface NoteListProps {
  notes: NoteSummaryDto[];
  folders: ReadonlyMap<number, FolderDto>;
  selectedFolderId: number | null;
  selectedNoteId: number | null;
  loading?: boolean;
  referencePanelOpen?: boolean;
  onSelect: (id: number) => void;
  onEdit: (id: number) => void;
  onReorder?: (id: number, position: number) => Promise<void> | void;
  onCreate: (parentId: number | null) => void;
  onImport: (file: File) => Promise<void> | void;
  onImportFolder: (files: File[]) => Promise<void> | void;
  onManageTemplates: () => void;
  onBack: () => void;
}

interface NoteBranchProps {
  parentId: number | null;
  grouped: ReadonlyMap<number | null, NoteSummaryDto[]>;
  folders: ReadonlyMap<number, FolderDto>;
  selectedFolderId: number | null;
  selectedNoteId: number | null;
  expandedIds: ReadonlySet<number>;
  onSelect: (id: number) => void;
  onToggle: (id: number) => void;
  reorder: ItemReorderController;
  onCreate: (parentId: number) => void;
  navigation: ReturnType<typeof useTreeKeyboardNavigation<number>>;
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

function NoteBranch({
  parentId,
  grouped,
  folders,
  selectedFolderId,
  selectedNoteId,
  expandedIds,
  onSelect,
  onToggle,
  reorder,
  onCreate,
  navigation,
}: NoteBranchProps) {
  const children = grouped.get(parentId) ?? [];
  if (children.length === 0) return null;

  return (
    <ul role="presentation">
      {children.map((note) => {
        const hasChildren = (grouped.get(note.id)?.length ?? 0) > 0;
        const expanded = expandedIds.has(note.id);
        return (
          <li key={note.id} role="presentation">
            <div
              className={`note-node-row ${reorder.dropClassName(note.id)}`.trim()}
              {...reorder.rowProps(note.id)}
            >
              {hasChildren ? (
                <span
                  aria-hidden="true"
                  className="note-disclosure"
                  data-babel-tree-disclosure=""
                  aria-expanded={expanded}
                  title={`${expanded ? "Collapse" : "Expand"} ${note.title}`}
                  onClick={() => onToggle(note.id)}
                />
              ) : (
                <span aria-hidden="true" className="note-disclosure" data-babel-tree-disclosure-spacer="" style={{ visibility: "hidden" }} />
              )}
              <button
                type="button"
                className={selectedNoteId === note.id ? "note-card selected" : "note-card"}
                {...reorder.selectionProps(note.id)}
                {...navigation.getTreeItemProps(note.id)}
                aria-current={selectedNoteId === note.id ? "page" : undefined}
                onClick={() => onSelect(note.id)}
              >
                <span className="note-path">
                  {relativePath(note.folderId, selectedFolderId, folders)}
                </span>
                <strong>{note.title}</strong>
                <Tags tags={note.tags} />
                <time dateTime={note.updatedAt}>Updated {formatDate(note.updatedAt)}</time>
              </button>
            </div>
            {expanded && hasChildren ? (
              <div className="note-children">
                <NoteBranch
                  parentId={note.id}
                  grouped={grouped}
                  folders={folders}
                  selectedFolderId={selectedFolderId}
                  selectedNoteId={selectedNoteId}
                  expandedIds={expandedIds}
                  onSelect={onSelect}
                  onToggle={onToggle}
                  reorder={reorder}
                  onCreate={onCreate}
                  navigation={navigation}
                />
                <span
                  aria-hidden="true"
                  className="tree-inline-create"
                  data-babel-tree-inline-create=""
                  title={`New subnote under ${note.title}`}
                  onClick={() => onCreate(note.id)}
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

export function NoteList({
  notes,
  folders,
  selectedFolderId,
  selectedNoteId,
  loading,
  referencePanelOpen = false,
  onSelect,
  onEdit,
  onReorder,
  onCreate,
  onImport,
  onImportFolder,
  onManageTemplates,
  onBack,
}: NoteListProps) {
  const importInputRef = useRef<HTMLInputElement>(null);
  const folderImportInputRef = useRef<HTMLInputElement>(null);
  const importMenuRef = useRef<HTMLDetailsElement>(null);
  const selectedFolder = selectedFolderId === null ? undefined : folders.get(selectedFolderId);
  const reorder = useItemReorder({
    items: notes.map((note) => ({
      id: note.id,
      parentId: note.parentId,
      scopeId: note.folderId,
    })),
    disabled: selectedFolderId === null,
    onReorder: onReorder ?? (() => undefined),
  });
  const folderActionHintId = selectedFolderId === null
    ? "note-list-folder-action-hint"
    : undefined;
  const grouped = useMemo(() => {
    const result = new Map<number | null, NoteSummaryDto[]>();
    for (const note of notes) {
      const siblings = result.get(note.parentId) ?? [];
      siblings.push(note);
      result.set(note.parentId, siblings);
    }
    return result;
  }, [notes]);
  const selectionPath = useMemo(
    () => noteSelectionPath(notes, selectedNoteId),
    [notes, selectedNoteId],
  );
  const [treeState, setTreeState] = useState<NoteExpansionState>(() => ({
    expandedIds: new Set<number>(),
    revealedPathKey: "root",
  }));
  const revealedTreeState = revealNoteSelection(treeState, selectionPath);
  if (revealedTreeState !== treeState) setTreeState(revealedTreeState);

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
      for (const note of grouped.get(parentId) ?? []) {
        const hasChildren = (grouped.get(note.id)?.length ?? 0) > 0;
        const expanded = revealedTreeState.expandedIds.has(note.id);
        items.push({ id: note.id, label: note.title, parentId, hasChildren, expanded, level });
        if (expanded) visit(note.id, level + 1);
      }
    };
    visit(null, 1);
    return items;
  }, [grouped, revealedTreeState.expandedIds]);

  const navigation = useTreeKeyboardNavigation<number>({
    items: navigationItems,
    selectedId: selectedNoteId ?? undefined,
    onActivate: onSelect,
    onEdit,
    onExpandedChange: (id) => toggleNote(id),
    label: "Page tree",
  });

  useCommandPaletteActions("__APP_ID__.notes", [
    {
      id: "note.new",
      label: "New note",
      keywords: ["create", "page"],
      group: "Notes",
      available: selectedFolderId !== null,
      run: () => onCreate(null),
    },
    {
      id: "note.newSubnote",
      label: "New subnote",
      keywords: ["create", "child", "page"],
      group: "Notes",
      available: selectedNoteId !== null,
      run: () => {
        if (selectedNoteId !== null) onCreate(selectedNoteId);
      },
    },
    {
      id: "note.import",
      label: "Import Markdown file",
      keywords: ["file", "md"],
      group: "Notes",
      available: selectedFolderId !== null,
      run: () => importInputRef.current?.click(),
    },
    {
      id: "note.importFolder",
      label: "Import Markdown folder",
      keywords: ["folder", "directory", "md", "batch"],
      group: "Notes",
      available: selectedFolderId !== null,
      run: () => folderImportInputRef.current?.click(),
    },
    {
      id: "note.templates",
      label: "Edit Templates",
      keywords: ["template", "manage"],
      group: "Notes",
      run: onManageTemplates,
    },
  ]);

  function chooseMarkdown(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void onImport(file);
  }

  function chooseMarkdownFolder(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (importMenuRef.current) importMenuRef.current.open = false;
    if (files.length > 0) void onImportFolder(files);
  }

  function toggleNote(noteId: number) {
    setTreeState((current) => {
      const revealed = revealNoteSelection(current, selectionPath);
      return {
        ...revealed,
        expandedIds: toggleNoteExpansion(revealed.expandedIds, noteId),
      };
    });
  }

  return (
    <aside
      className="workspace-panel note-panel"
      data-babel-pane="items"
      tabIndex={-1}
      aria-label="Notes list"
      aria-hidden={referencePanelOpen}
      inert={referencePanelOpen}
    >
      <button className="mobile-back" type="button" onClick={onBack}>
        <span aria-hidden="true">←</span> Library
      </button>
      <div className="panel-heading note-list-heading">
        <div>
          <span className="eyebrow">Notes</span>
          <h2>{selectedFolder?.name ?? "All Notes"}</h2>
          <p>{notes.length} {notes.length === 1 ? "note" : "notes"}</p>
        </div>
        <div className="note-list-actions content-list-actions">
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
              aria-describedby={folderActionHintId}
              title={selectedFolderId === null ? "Select a folder before importing Markdown" : undefined}
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
          <NewContentMenu
            beforeNavigateEvent={BEFORE_NAVIGATE_EVENT}
            contentLabel="New note"
            contentAvailable={selectedFolderId !== null}
            className="primary-button"
            unavailableTitle="Select a folder before creating a note"
            onCreateContent={() => onCreate(null)}
          />
          <button
            type="button"
            data-babel-child-create=""
            disabled={selectedNoteId === null}
            title={selectedNoteId === null ? "Select a note before creating a subnote" : undefined}
            onClick={() => {
              if (selectedNoteId !== null) onCreate(selectedNoteId);
            }}
          >
            New subnote
          </button>
        </div>
      </div>

      {selectedFolderId === null ? (
        <p className="panel-hint" id={folderActionHintId}>
          Select a folder to create a note. All Notes remains a read-only collection view.
        </p>
      ) : null}
      {loading ? <p className="panel-status">Loading notes…</p> : null}
      {!loading && notes.length === 0 ? (
        <div className="empty-state compact-empty">
          <span aria-hidden="true">N</span>
          <h3>No notes here</h3>
          <p>{selectedFolderId === null ? "Your library is waiting for its first note." : "Create a note in this folder when you are ready."}</p>
        </div>
      ) : null}

      <nav className="note-tree" {...navigation.treeProps}>
        <NoteBranch
          parentId={null}
          grouped={grouped}
          folders={folders}
          selectedFolderId={selectedFolderId}
          selectedNoteId={selectedNoteId}
          expandedIds={revealedTreeState.expandedIds}
          onSelect={onSelect}
          onToggle={toggleNote}
          reorder={reorder}
          onCreate={onCreate}
          navigation={navigation}
        />
      </nav>
      <div className="note-panel-footer">
        <button type="button" onClick={onManageTemplates}>Edit Templates</button>
      </div>
    </aside>
  );
}
