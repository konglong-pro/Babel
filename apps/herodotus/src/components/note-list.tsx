"use client";

import { type ChangeEvent, useRef } from "react";

import { folderPath } from "@/components/shared";
import { formatDate, Tags } from "@/components/shared";
import type { FolderDto, NoteSummaryDto } from "@/lib/types";

interface NoteListProps {
  notes: NoteSummaryDto[];
  folders: ReadonlyMap<number, FolderDto>;
  selectedFolderId: number | null;
  selectedNoteId: number | null;
  loading?: boolean;
  onSelect: (id: number) => void;
  onCreate: () => void;
  onImport: (file: File) => Promise<void> | void;
  onBack: () => void;
}

function relativePath(
  folderId: number,
  selectedFolderId: number | null,
  folders: ReadonlyMap<number, FolderDto>,
): string {
  const path = folderPath(folderId, folders);
  if (selectedFolderId === null) return path.map((folder) => folder.name).join(" / ") || "Unknown folder";

  const selectedIndex = path.findIndex((folder) => folder.id === selectedFolderId);
  if (selectedIndex < 0) return path.map((folder) => folder.name).join(" / ") || "Unknown folder";
  const relative = path.slice(selectedIndex + 1).map((folder) => folder.name);
  return relative.length ? relative.join(" / ") : "This folder";
}

export function NoteList({
  notes,
  folders,
  selectedFolderId,
  selectedNoteId,
  loading,
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

  function chooseMarkdown(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void onImport(file);
  }

  return (
    <aside className="workspace-panel note-panel" aria-label="Notes list">
      <button className="mobile-back" type="button" onClick={onBack}>
        <span aria-hidden="true">←</span> Library
      </button>
      <div className="panel-heading note-list-heading">
        <div>
          <span className="eyebrow">Notes</span>
          <h2>{selectedFolder?.name ?? "All Notes"}</h2>
          <p>{notes.length} {notes.length === 1 ? "note" : "notes"}</p>
        </div>
        <div className="note-list-actions">
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
            Import .md
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={selectedFolderId === null}
            aria-describedby={folderActionHintId}
            title={selectedFolderId === null ? "Select a folder before creating a note" : undefined}
            onClick={onCreate}
          >
            New Note
          </button>
        </div>
      </div>

      {selectedFolderId === null ? (
        <p className="panel-hint" id={folderActionHintId}>Select a folder to create a note. All Notes remains a read-only collection view.</p>
      ) : null}
      {loading ? <p className="panel-status">Loading notes…</p> : null}
      {!loading && notes.length === 0 ? (
        <div className="empty-state compact-empty">
          <span aria-hidden="true">N</span>
          <h3>No notes here</h3>
          <p>{selectedFolderId === null ? "Your library is waiting for its first note." : "Create a note in this folder when you are ready."}</p>
        </div>
      ) : null}

      <ul className="note-list">
        {notes.map((note) => (
          <li key={note.id}>
            <button
              type="button"
              className={selectedNoteId === note.id ? "note-card selected" : "note-card"}
              aria-current={selectedNoteId === note.id ? "page" : undefined}
              onClick={() => onSelect(note.id)}
            >
              <span className="note-path">{relativePath(note.folderId, selectedFolderId, folders)}</span>
              <strong>{note.title}</strong>
              <Tags tags={note.tags} />
              <time dateTime={note.updatedAt}>Updated {formatDate(note.updatedAt)}</time>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
