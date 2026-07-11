"use client";

import { type FormEvent, useId, useMemo, useRef, useState } from "react";

import type { FolderDto, FolderType } from "@/lib/types";

interface FolderPanelProps {
  type: FolderType;
  folders: FolderDto[];
  selectedId: number | null;
  busy?: boolean;
  onSelect: (id: number | null) => void;
  onCreate: (name: string, parentId: number | null) => Promise<void>;
  onRename: (id: number, name: string) => Promise<void>;
  onMove: (id: number, parentId: number | null) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}

interface FolderBranchProps {
  parentId: number | null;
  grouped: Map<number | null, FolderDto[]>;
  selectedId: number | null;
  onSelect: (id: number) => void;
}

function FolderBranch({ parentId, grouped, selectedId, onSelect }: FolderBranchProps) {
  const children = grouped.get(parentId) ?? [];
  if (children.length === 0) return null;

  return (
    <ul>
      {children.map((folder) => (
        <li key={folder.id}>
          <button
            type="button"
            className={selectedId === folder.id ? "folder-node selected" : "folder-node"}
            aria-current={selectedId === folder.id ? "true" : undefined}
            onClick={() => onSelect(folder.id)}
          >
            <span aria-hidden="true">▱</span>
            <span>{folder.name}</span>
          </button>
          <FolderBranch
            parentId={folder.id}
            grouped={grouped}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        </li>
      ))}
    </ul>
  );
}

function buildPath(folder: FolderDto, map: Map<number, FolderDto>): string {
  const names = [folder.name];
  const seen = new Set([folder.id]);
  let parentId = folder.parentId;
  while (parentId !== null && !seen.has(parentId)) {
    const parent = map.get(parentId);
    if (!parent) break;
    names.unshift(parent.name);
    seen.add(parent.id);
    parentId = parent.parentId;
  }
  return names.join(" / ");
}

function descendantIds(id: number, grouped: Map<number | null, FolderDto[]>): Set<number> {
  const result = new Set<number>();
  const stack = [id];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    for (const child of grouped.get(current) ?? []) {
      if (!result.has(child.id)) {
        result.add(child.id);
        stack.push(child.id);
      }
    }
  }
  return result;
}

export function FolderPanel({
  type,
  folders,
  selectedId,
  busy,
  onSelect,
  onCreate,
  onRename,
  onMove,
  onDelete,
}: FolderPanelProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [dialogMode, setDialogMode] = useState<"create" | "rename" | "move" | "delete">(
    "create",
  );
  const [name, setName] = useState("");
  const [targetId, setTargetId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const dialogTitleId = useId();

  const grouped = useMemo(() => {
    const result = new Map<number | null, FolderDto[]>();
    for (const folder of folders) {
      const siblings = result.get(folder.parentId) ?? [];
      siblings.push(folder);
      result.set(folder.parentId, siblings);
    }
    for (const siblings of result.values()) {
      siblings.sort((a, b) => a.name.localeCompare(b.name, "en-US"));
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
        .map((folder) => ({ id: folder.id, path: buildPath(folder, folderMap) }))
        .sort((a, b) => a.path.localeCompare(b.path, "en-US")),
    [folderMap, folders, selectedId, unavailableTargets],
  );

  function openDialog(mode: typeof dialogMode) {
    setDialogMode(mode);
    setError("");
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
        await onCreate(name.trim(), selectedId);
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

  const spaceName = type === "knowledge" ? "Knowledge" : "Exercise";

  return (
    <aside className="archive-panel folder-panel" aria-label={`${spaceName} folders`}>
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Folders</span>
          <h1>{spaceName}</h1>
        </div>
        <button type="button" className="icon-button" onClick={() => openDialog("create")}>
          ＋<span className="sr-only">{selectedId === null ? "New top-level folder" : "New subfolder"}</span>
        </button>
      </div>

      <div className="folder-toolbar" aria-label="Folder actions">
        <button type="button" onClick={() => openDialog("create")}>
          {selectedId === null ? "New Folder" : "New Subfolder"}
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

      <nav className="folder-tree" aria-label={`${spaceName} folder tree`}>
        <button
          type="button"
          className={selectedId === null ? "folder-node root selected" : "folder-node root"}
          aria-current={selectedId === null ? "true" : undefined}
          onClick={() => onSelect(null)}
        >
          <span aria-hidden="true">⌂</span>
          <span>All Content</span>
        </button>
        {busy ? <p className="panel-status">Loading folders…</p> : null}
        {!busy && folders.length === 0 ? (
          <p className="panel-status">No folders yet. Create one to get started.</p>
        ) : (
          <FolderBranch
            parentId={null}
            grouped={grouped}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        )}
      </nav>

      <dialog ref={dialogRef} className="dialog" aria-labelledby={dialogTitleId}>
        <form className="dialog-body" onSubmit={submit}>
          <h2 id={dialogTitleId}>
            {dialogMode === "create" ? "New Folder" : null}
            {dialogMode === "rename" ? "Rename Folder" : null}
            {dialogMode === "move" ? "Move Folder" : null}
            {dialogMode === "delete" ? "Delete Folder" : null}
          </h2>

          {dialogMode === "create" || dialogMode === "rename" ? (
            <label className="field">
              <span>Folder Name</span>
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
              <span>Destination Folder</span>
              <select
                name="parentId"
                value={targetId}
                onChange={(event) => setTargetId(event.target.value)}
              >
                <option value="">{spaceName} Root</option>
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
              Delete “{selectedFolder?.name}”? To protect your archive, folders that contain subfolders or content cannot be deleted.
            </p>
          ) : null}

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="dialog-actions">
            <button type="button" onClick={() => dialogRef.current?.close()}>
              Cancel
            </button>
            <button
              type="submit"
              className={dialogMode === "delete" ? "danger-button" : "primary-button"}
              disabled={pending || ((dialogMode === "create" || dialogMode === "rename") && !name.trim())}
            >
              {pending ? "Working…" : dialogMode === "delete" ? "Delete Folder" : "Save"}
            </button>
          </div>
        </form>
      </dialog>
    </aside>
  );
}
