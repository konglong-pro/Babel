"use client";

import { FolderPicker } from "@babel-apps/platform/folders/picker";

import {
  type FormEvent,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ReferencePanelTriggers,
  type ReferencePanelKind,
} from "@babel-apps/markdown/reference";
import {
  type FolderReorderController,
  useFolderReorder,
} from "@babel-apps/platform/folders/react";
import { useTreeKeyboardNavigation } from "@babel-apps/platform/navigation/react";
import { useCommandPaletteActions } from "@babel-apps/platform/shortcuts/react";

import {
  type FolderExpansionState,
  folderSelectionPath,
  revealFolderSelection,
  toggleFolderExpansion,
} from "@/components/folder-tree-state";
import type { FolderDto, FolderType } from "@/lib/types";

interface FolderPanelProps {
  type: FolderType;
  folders: FolderDto[];
  selectedId: number | null;
  busy?: boolean;
  activeReferencePanel: ReferencePanelKind | null;
  onOpenMarkdownReference: () => void;
  onOpenTypstReference: () => void;
  onSelect: (id: number | null) => void;
  onCreate: (name: string, parentId: number | null) => Promise<void>;
  onRename: (id: number, name: string) => Promise<void>;
  onMove: (id: number, parentId: number | null) => Promise<void>;
  onReorder: (id: number, position: number) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}

interface FolderBranchProps {
  parentId: number | null;
  grouped: Map<number | null, FolderDto[]>;
  selectedId: number | null;
  expandedIds: ReadonlySet<number>;
  onSelect: (id: number) => void;
  onToggle: (id: number) => void;
  onCreateChild: (id: number) => void;
  reorder: FolderReorderController;
  navigation: ReturnType<typeof useTreeKeyboardNavigation<number | "all">>;
}

function FolderBranch({
  parentId,
  grouped,
  selectedId,
  expandedIds,
  onSelect,
  onToggle,
  onCreateChild,
  reorder,
  navigation,
}: FolderBranchProps) {
  const children = grouped.get(parentId) ?? [];
  if (children.length === 0) return null;

  return (
    <ul role="presentation">
      {children.map((folder) => {
        const hasChildren = (grouped.get(folder.id)?.length ?? 0) > 0;
        const expanded = expandedIds.has(folder.id);

        return (
          <li key={folder.id} role="presentation">
            <div
              className={`folder-node-row ${reorder.dropClassName(folder.id)}`.trim()}
              {...reorder.rowProps(folder.id)}
            >
              {hasChildren ? (
                <span
                  aria-hidden="true"
                  className="folder-disclosure"
                  data-babel-folder-disclosure=""
                  aria-expanded={expanded}
                  title={`${expanded ? "Collapse" : "Expand"} ${folder.name}`}
                  onClick={() => onToggle(folder.id)}
                />
              ) : <span aria-hidden="true" className="folder-disclosure-spacer" />}
              <button
                type="button"
                className={selectedId === folder.id ? "folder-node selected" : "folder-node"}
                {...reorder.selectionProps(folder.id)}
                {...navigation.getTreeItemProps(folder.id)}
                aria-current={selectedId === folder.id ? "true" : undefined}
                onClick={() => onSelect(folder.id)}
              >
                <span aria-hidden="true">▱</span>
                <span>{folder.name}</span>
              </button>
            </div>
            {expanded ? (
              <div className="folder-tree-children">
                <FolderBranch
                  parentId={folder.id}
                  grouped={grouped}
                  selectedId={selectedId}
                  expandedIds={expandedIds}
                  onSelect={onSelect}
                  onToggle={onToggle}
                  onCreateChild={onCreateChild}
                  reorder={reorder}
                  navigation={navigation}
                />
                <span
                  aria-hidden="true"
                  className="inline-tree-create"
                  data-babel-tree-inline-create=""
                  title={`New subfolder under ${folder.name}`}
                  onClick={() => onCreateChild(folder.id)}
                >
                  New subfolder
                </span>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
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
  activeReferencePanel,
  onOpenMarkdownReference,
  onOpenTypstReference,
  onSelect,
  onCreate,
  onRename,
  onMove,
  onReorder,
  onDelete,
}: FolderPanelProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [dialogMode, setDialogMode] = useState<"create" | "rename" | "move" | "delete">(
    "create",
  );
  const [name, setName] = useState("");
  const [targetId, setTargetId] = useState("");
  const [createParentId, setCreateParentId] = useState<number | null>(null);
  const [dialogFolderId, setDialogFolderId] = useState<number | null>(null);
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
  const reorder = useFolderReorder({ folders, disabled: busy || pending, onReorder });

  const navigationItems = useMemo(() => {
    const items: Array<{
      id: number | "all";
      label: string;
      parentId: number | "all" | null;
      hasChildren: boolean;
      expanded?: boolean;
      level: number;
    }> = [{ id: "all", label: "All Content", parentId: null, hasChildren: false, level: 1 }];
    const visit = (parentId: number | null, level: number) => {
      for (const folder of grouped.get(parentId) ?? []) {
        const hasChildren = (grouped.get(folder.id)?.length ?? 0) > 0;
        const expanded = visibleExpandedIds.has(folder.id);
        items.push({
          id: folder.id,
          label: folder.name,
          parentId,
          hasChildren,
          expanded,
          level,
        });
        if (expanded) visit(folder.id, level + 1);
      }
    };
    visit(null, 1);
    return items;
  }, [grouped, visibleExpandedIds]);

  const navigation = useTreeKeyboardNavigation<number | "all">({
    items: navigationItems,
    selectedId: selectedId ?? "all",
    onActivate: (id) => onSelect(id === "all" ? null : id),
    onEdit: (id) => {
      if (id !== "all") openDialog("rename", selectedId, id);
    },
    onExpandedChange: (id) => {
      if (id !== "all") handleToggle(id);
    },
    label: `${type === "knowledge" ? "Knowledge" : "Exercise"} folder tree`,
  });

  useCommandPaletteActions(`retex.${type}.folders`, [
    {
      id: "folder.new",
      label: selectedId === null ? "New folder" : "New subfolder",
      group: "Folders",
      available: !busy && !pending,
      run: () => openDialog("create"),
    },
    {
      id: "folder.rename",
      label: "Rename selected folder",
      group: "Folders",
      available: selectedId !== null && !busy && !pending,
      run: () => openDialog("rename"),
    },
    {
      id: "folder.move",
      label: "Move selected folder",
      group: "Folders",
      available: selectedId !== null && !busy && !pending,
      run: () => openDialog("move"),
    },
    {
      id: "folder.delete",
      label: "Delete selected folder",
      group: "Folders",
      available: selectedId !== null && !busy && !pending,
      run: () => openDialog("delete"),
    },
    {
      id: "reference.markdown",
      label: "Open Markdown Guide",
      group: "Reference",
      run: onOpenMarkdownReference,
    },
    {
      id: "reference.typst",
      label: "Open Formula Reference",
      group: "Reference",
      run: onOpenTypstReference,
    },
  ]);

  function handleToggle(folderId: number) {
    setExpansionState((current) => {
      const revealedState = revealFolderSelection(current, selectedPath);
      return {
        ...revealedState,
        expandedIds: toggleFolderExpansion(revealedState.expandedIds, folderId),
      };
    });
  }

  function openDialog(
    mode: typeof dialogMode,
    parentId: number | null = selectedId,
    folderId: number | null = selectedId,
  ) {
    const dialogFolder = folderId === null ? undefined : folderMap.get(folderId);
    setDialogMode(mode);
    setError("");
    setDialogFolderId(folderId);
    if (mode === "create") setCreateParentId(parentId);
    setTargetId(dialogFolder?.parentId?.toString() ?? "");
    setName(mode === "rename" ? dialogFolder?.name ?? "" : "");
    dialogRef.current?.showModal();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      if (dialogMode === "create") {
        await onCreate(name.trim(), createParentId);
      } else if (dialogMode === "rename" && dialogFolderId !== null) {
        await onRename(dialogFolderId, name.trim());
      } else if (dialogMode === "move" && dialogFolderId !== null) {
        await onMove(dialogFolderId, targetId ? Number(targetId) : null);
      } else if (dialogMode === "delete" && dialogFolderId !== null) {
        await onDelete(dialogFolderId);
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
    <aside
      className="archive-panel folder-panel"
      data-babel-pane="tree"
      tabIndex={-1}
      aria-label={`${spaceName} folders`}
      aria-hidden={activeReferencePanel !== null}
      inert={activeReferencePanel !== null}
    >
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

      {busy ? <p className="panel-status">Loading folders…</p> : null}
      {!busy && folders.length === 0 ? (
        <p className="panel-status">No folders yet. Create one to get started.</p>
      ) : null}
      <nav className="folder-tree" {...navigation.treeProps}>
        <button
          type="button"
          className={selectedId === null ? "folder-node root selected" : "folder-node root"}
          {...navigation.getTreeItemProps("all")}
          aria-current={selectedId === null ? "true" : undefined}
          onClick={() => onSelect(null)}
        >
          <span aria-hidden="true">⌂</span>
          <span>All Content</span>
        </button>
        {folders.length > 0 ? (
          <FolderBranch
            parentId={null}
            grouped={grouped}
            selectedId={selectedId}
            expandedIds={visibleExpandedIds}
            onSelect={onSelect}
            onToggle={handleToggle}
            onCreateChild={(id) => openDialog("create", id)}
            reorder={reorder}
            navigation={navigation}
          />
        ) : null}
      </nav>

      <ReferencePanelTriggers
        activePanel={activeReferencePanel}
        onOpenMarkdown={onOpenMarkdownReference}
        onOpenTypst={onOpenTypstReference}
      />

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
            <div className="field">
              <span>Destination Folder</span>
              <FolderPicker
                name="parentId"
                label="Destination folder"
                folders={folders}
                value={targetId ? Number(targetId) : null}
                onChange={(id) => setTargetId(id === null ? "" : String(id))}
                allowRoot
                rootLabel={`${spaceName} Root`}
                excludedIds={new Set([...unavailableTargets, ...(selectedId === null ? [] : [selectedId])])}
                disabled={pending}
              />
            </div>
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
            <button data-babel-command="cancel" data-babel-escape="overlay" type="button" onClick={() => dialogRef.current?.close()}>
              Cancel
            </button>
            <button
              data-babel-command="confirm"
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
