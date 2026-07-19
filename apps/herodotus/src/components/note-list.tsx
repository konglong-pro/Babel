"use client";

import { type ChangeEvent, useMemo, useRef, useState } from "react";

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
  onCreate: (parentId: number | null) => void;
  onImport: (file: File) => Promise<void> | void;
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
  onCreate: (parentId: number) => void;
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
  onCreate,
}: NoteBranchProps) {
  const children = grouped.get(parentId) ?? [];
  if (children.length === 0) return null;

  return (
    <ul>
      {children.map((note) => {
        const expanded = expandedIds.has(note.id);
        return (
          <li key={note.id}>
            <div className="note-node-row">
              <button
                type="button"
                className="note-disclosure"
                aria-expanded={expanded}
                aria-label={`${expanded ? "Collapse" : "Expand"} ${note.title}`}
                onClick={() => onToggle(note.id)}
              />
              <button
                type="button"
                className={selectedNoteId === note.id ? "note-card selected" : "note-card"}
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
            {expanded ? (
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
                  onCreate={onCreate}
                />
                <button
                  type="button"
                  className="tree-inline-create"
                  onClick={() => onCreate(note.id)}
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

export function NoteList({
  notes,
  folders,
  selectedFolderId,
  selectedNoteId,
  loading,
  referencePanelOpen = false,
  onSelect,
  onCreate,
  onImport,
  onBack,
}: NoteListProps) {
  const importInputRef = useRef<HTMLInputElement>(null);
  const selectedFolder = selectedFolderId === null ? undefined : folders.get(selectedFolderId);
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

  function chooseMarkdown(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void onImport(file);
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
      aria-label="Notes list"
      aria-hidden={referencePanelOpen}
      inert={referencePanelOpen}
    >
      <button className="mobile-back" type="button" onClick={onBack}>
        <span aria-hidden="true">←</span> Library
      </button>
      <div className="panel-heading note-list-heading">
        <div>
          <div id="babel-detached-reader-trigger-target" className="reader-trigger-slot" />
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
          <button
            type="button"
            disabled={selectedFolderId === null}
            aria-describedby={folderActionHintId}
            title={selectedFolderId === null ? "Select a folder before importing Markdown" : undefined}
            onClick={() => importInputRef.current?.click()}
          >
            Import
          </button>
          <button
            type="button"
            data-babel-command="new"
            className="primary-button"
            disabled={selectedFolderId === null}
            aria-describedby={folderActionHintId}
            title={selectedFolderId === null ? "Select a folder before creating a note" : undefined}
            onClick={() => onCreate(null)}
          >
            New
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

      <nav className="note-tree" aria-label="Page tree">
        <NoteBranch
          parentId={null}
          grouped={grouped}
          folders={folders}
          selectedFolderId={selectedFolderId}
          selectedNoteId={selectedNoteId}
          expandedIds={revealedTreeState.expandedIds}
          onSelect={onSelect}
          onToggle={toggleNote}
          onCreate={onCreate}
        />
      </nav>
    </aside>
  );
}
