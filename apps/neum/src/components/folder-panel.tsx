"use client";

import { type FormEvent, useId, useMemo, useRef, useState } from "react";

import { folderPathLabel } from "@/components/shared";
import {
  type FolderExpansionState,
  folderSelectionPath,
  revealFolderSelection,
  toggleFolderExpansion,
} from "@/components/folder-tree-state";
import type { FolderDto } from "@/lib/types";

interface FolderPanelProps {
  folders: FolderDto[];
  selectedId: number | null;
  trashActive: boolean;
  busy?: boolean;
  onSelect: (id: number | null) => void;
  onOpenTrash: () => void;
  onCreate: (name: string, parentId: number | null) => Promise<void>;
  onRename: (id: number, name: string) => Promise<void>;
  onMove: (id: number, parentId: number | null) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}

interface FolderBranchProps {
  parentId: number | null;
  grouped: ReadonlyMap<number | null, FolderDto[]>;
  selectedId: number | null;
  expandedIds: ReadonlySet<number>;
  onSelect: (id: number) => void;
  onToggle: (id: number) => void;
  onCreateChild: (parentId: number) => void;
}

function FolderBranch({
  parentId,
  grouped,
  selectedId,
  expandedIds,
  onSelect,
  onToggle,
  onCreateChild,
}: FolderBranchProps) {
  const children = grouped.get(parentId) ?? [];
  if (children.length === 0) return null;

  return (
    <ul>
      {children.map((folder) => {
        const expanded = expandedIds.has(folder.id);

        return (
          <li key={folder.id}>
            <div className="folder-node-row">
              <button
                type="button"
                className="folder-disclosure"
                aria-expanded={expanded}
                aria-label={`${expanded ? "Collapse" : "Expand"} ${folder.name}`}
                onClick={() => onToggle(folder.id)}
              />
              <button
                type="button"
                className={selectedId === folder.id ? "folder-node selected" : "folder-node"}
                aria-current={selectedId === folder.id ? "page" : undefined}
                onClick={() => onSelect(folder.id)}
              >
                <span className="folder-glyph" aria-hidden="true" />
                <span>{folder.name}</span>
              </button>
            </div>
            {expanded ? (
              <div className="folder-children">
                <FolderBranch
                  parentId={folder.id}
                  grouped={grouped}
                  selectedId={selectedId}
                  expandedIds={expandedIds}
                  onSelect={onSelect}
                  onToggle={onToggle}
                  onCreateChild={onCreateChild}
                />
                <button
                  type="button"
                  className="folder-inline-create"
                  onClick={() => onCreateChild(folder.id)}
                >
                  + New subfolder
                </button>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function descendantIds(id: number, grouped: ReadonlyMap<number | null, FolderDto[]>): Set<number> {
  const result = new Set<number>();
  const stack = [id];
  while (stack.length) {
    const current = stack.pop();
    if (current === undefined) continue;
    for (const child of grouped.get(current) ?? []) {
      if (result.has(child.id)) continue;
      result.add(child.id);
      stack.push(child.id);
    }
  }
  return result;
}

type DialogMode = "create" | "rename" | "move" | "delete";

export function FolderPanel({
  folders,
  selectedId,
  trashActive,
  busy,
  onSelect,
  onOpenTrash,
  onCreate,
  onRename,
  onMove,
  onDelete,
}: FolderPanelProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [dialogMode, setDialogMode] = useState<DialogMode>("create");
  const [name, setName] = useState("");
  const [targetId, setTargetId] = useState("");
  const [createParentId, setCreateParentId] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [expansionState, setExpansionState] = useState<FolderExpansionState>(() => ({
    expandedIds: new Set(),
    revealedPathKey: "",
  }));
  const dialogTitleId = useId();
  const selectedPath = useMemo(
    () => folderSelectionPath(folders, selectedId),
    [folders, selectedId],
  );
  const revealedExpansionState = revealFolderSelection(expansionState, selectedPath);
  if (revealedExpansionState !== expansionState) {
    setExpansionState(revealedExpansionState);
  }
  const visibleExpandedIds = revealedExpansionState.expandedIds;

  const grouped = useMemo(() => {
    const result = new Map<number | null, FolderDto[]>();
    for (const folder of folders) {
      const siblings = result.get(folder.parentId) ?? [];
      siblings.push(folder);
      result.set(folder.parentId, siblings);
    }
    return result;
  }, [folders]);

  const folderMap = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders]);
  const selectedFolder = selectedId === null ? undefined : folderMap.get(selectedId);
  const unavailableTargets = useMemo(
    () => (selectedId === null ? new Set<number>() : descendantIds(selectedId, grouped)),
    [grouped, selectedId],
  );
  const moveTargets = useMemo(
    () =>
      folders
        .filter((folder) => folder.id !== selectedId && !unavailableTargets.has(folder.id))
        .map((folder) => ({ id: folder.id, path: folderPathLabel(folder.id, folderMap) })),
    [folderMap, folders, selectedId, unavailableTargets],
  );

  function handleToggle(folderId: number) {
    setExpansionState((current) => {
      const revealedState = revealFolderSelection(current, selectedPath);
      return {
        ...revealedState,
        expandedIds: toggleFolderExpansion(revealedState.expandedIds, folderId),
      };
    });
  }

  function openDialog(mode: DialogMode, parentId: number | null = selectedId) {
    setDialogMode(mode);
    setError("");
    setCreateParentId(parentId);
    setTargetId(selectedFolder?.parentId?.toString() ?? "");
    setName(mode === "rename" ? selectedFolder?.name ?? "" : "");
    dialogRef.current?.showModal();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      if (dialogMode === "create") {
        await onCreate(name.trim(), createParentId);
      } else if (dialogMode === "rename" && selectedId !== null) {
        await onRename(selectedId, name.trim());
      } else if (dialogMode === "move" && selectedId !== null) {
        await onMove(selectedId, targetId ? Number(targetId) : null);
      } else if (dialogMode === "delete" && selectedId !== null) {
        await onDelete(selectedId);
      }
      dialogRef.current?.close();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <aside className="workspace-panel folder-panel" aria-label="Knowledge folders">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Knowledge base</span>
          <h1>Folders</h1>
        </div>
        <button className="icon-button" type="button" aria-label="Create folder" onClick={() => openDialog("create")}>
          +
        </button>
      </div>

      <div className="folder-toolbar" aria-label="Folder actions">
        <button type="button" onClick={() => openDialog("create")}>
          {selectedId === null ? "New folder" : "New subfolder"}
        </button>
        <button type="button" disabled={selectedId === null} onClick={() => openDialog("rename")}>
          Rename
        </button>
        <button type="button" disabled={selectedId === null} onClick={() => openDialog("move")}>
          Move
        </button>
        <button type="button" disabled={selectedId === null} onClick={() => openDialog("delete")}>
          Delete
        </button>
      </div>

      <nav className="folder-tree" aria-label="Folder tree">
        <button
          type="button"
          className={!trashActive && selectedId === null ? "folder-node root selected" : "folder-node root"}
          aria-current={!trashActive && selectedId === null ? "page" : undefined}
          onClick={() => onSelect(null)}
        >
          <span className="all-entries-glyph" aria-hidden="true">A</span>
          <span>All entries</span>
        </button>
        {busy ? <p className="panel-status">Loading folders…</p> : null}
        {!busy && folders.length === 0 ? (
          <p className="panel-status">No folders yet. Create one to begin.</p>
        ) : (
          <FolderBranch
            parentId={null}
            grouped={grouped}
            selectedId={selectedId}
            expandedIds={visibleExpandedIds}
            onSelect={onSelect}
            onToggle={handleToggle}
            onCreateChild={(parentId) => openDialog("create", parentId)}
          />
        )}
        <button
          type="button"
          className={trashActive ? "folder-node trash-node selected" : "folder-node trash-node"}
          aria-current={trashActive ? "page" : undefined}
          onClick={onOpenTrash}
        >
          <span className="all-entries-glyph" aria-hidden="true">T</span>
          <span>Trash</span>
        </button>
      </nav>

      <dialog ref={dialogRef} className="dialog" aria-labelledby={dialogTitleId}>
        <form className="dialog-body" onSubmit={submit}>
          <p className="eyebrow">Organize your knowledge</p>
          <h2 id={dialogTitleId}>
            {dialogMode === "create" ? "New folder" : null}
            {dialogMode === "rename" ? "Rename folder" : null}
            {dialogMode === "move" ? "Move folder" : null}
            {dialogMode === "delete" ? "Delete folder" : null}
          </h2>

          {dialogMode === "create" || dialogMode === "rename" ? (
            <label className="field">
              <span>Folder name</span>
              <input
                autoFocus
                name="folderName"
                autoComplete="off"
                required
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
          ) : null}

          {dialogMode === "move" ? (
            <label className="field">
              <span>Destination</span>
              <select name="parentId" value={targetId} onChange={(event) => setTargetId(event.target.value)}>
                <option value="">Library root</option>
                {moveTargets.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.path}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {dialogMode === "delete" ? (
            <p>
              Delete “{selectedFolder?.name}”? Folders containing active or trashed entries, or subfolders, cannot be deleted.
            </p>
          ) : null}

          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <div className="dialog-actions">
            <button data-babel-command="cancel" type="button" onClick={() => dialogRef.current?.close()}>
              Cancel
            </button>
            <button
              data-babel-command="confirm"
              type="submit"
              className={dialogMode === "delete" ? "danger-button" : "primary-button"}
              disabled={pending || ((dialogMode === "create" || dialogMode === "rename") && !name.trim())}
            >
              {pending ? "Working…" : dialogMode === "delete" ? "Delete folder" : "Save"}
            </button>
          </div>
        </form>
      </dialog>
    </aside>
  );
}
