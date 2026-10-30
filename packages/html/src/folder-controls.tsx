"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { FolderPicker } from "@babel-apps/platform/folders/picker";
import { HTML_FOLDER_NAME_MAX_LENGTH, type HtmlDocumentSummary, type HtmlFolder } from "@babel-apps/platform/html/core";
import { htmlFolderEntries, htmlFolderSubtreeIds, type HtmlFolderEntry } from "./folders";

export type HtmlFolderScope = "all" | string | null;

/** Adapt UUID storage identities to the notebook picker's numeric UI identities. */
export function HtmlFolderPicker({ folders, value, onChange, label, disabled, excludedIds, rootLabel = "Unfiled" }: {
  folders: readonly HtmlFolder[]; value: string | null; onChange: (value: string | null) => void;
  label: string; disabled?: boolean; excludedIds?: ReadonlySet<string>; rootLabel?: string;
}) {
  const mapping = useMemo(() => {
    const numericIds = new Map(folders.map((folder, index) => [folder.id, index + 1]));
    return { numericIds, folders: folders.map((folder, index) => ({
      id: index + 1, name: folder.name, parentId: folder.parentId === null ? null : numericIds.get(folder.parentId) ?? null,
    })) };
  }, [folders]);
  const missing = value !== null && !mapping.numericIds.has(value);
  return <div className="babel-pdf-folders__picker"><FolderPicker folders={mapping.folders} value={value === null ? null : mapping.numericIds.get(value) ?? -1}
    onChange={(id) => { if (id === null) onChange(null); else if (folders[id - 1]) onChange(folders[id - 1].id); }}
    label={label} disabled={disabled} allowRoot rootLabel={rootLabel}
    excludedIds={excludedIds ? new Set([...excludedIds].flatMap((id) => mapping.numericIds.has(id) ? [mapping.numericIds.get(id)!] : [])) : undefined} />
    {missing && <p className="babel-pdf-folders__error" role="alert">The selected folder is no longer available. Choose another destination.</p>}</div>;
}

export function HtmlFolders({ folders, documents, selected, onSelect, disabled, onCreate, onUpdate, onDelete }: {
  folders: readonly HtmlFolder[]; documents: readonly HtmlDocumentSummary[]; selected: HtmlFolderScope;
  onSelect: (id: HtmlFolderScope) => void; disabled: boolean;
  onCreate: (name: string, parentId: string | null) => Promise<void>;
  onUpdate: (id: string, changes: { name?: string; parentId?: string | null }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editor, setEditor] = useState<{ mode: "create" | "rename" | "move" | "delete"; id: string | null } | null>(null);
  const [name, setName] = useState("");
  const [parent, setParent] = useState<string | null>(null);
  const [error, setError] = useState("");
  const editorRef = useRef<HTMLDivElement>(null);
  const entries = useMemo(() => htmlFolderEntries(folders), [folders]);
  const current = folders.find((folder) => folder.id === selected);
  const edited = folders.find((folder) => folder.id === editor?.id);
  const counts = new Map<string | null, number>();
  for (const document of documents) counts.set(document.folderId, (counts.get(document.folderId) ?? 0) + 1);
  const empty = current && !folders.some((folder) => folder.parentId === current.id) && !counts.get(current.id);

  useEffect(() => {
    if (!editor) return;
    editorRef.current?.scrollIntoView({ block: "nearest" });
    editorRef.current?.querySelector<HTMLInputElement | HTMLButtonElement>("input, button")?.focus({ preventScroll: true });
  }, [editor]);

  function start(mode: "create" | "rename" | "move" | "delete") {
    setError("");
    setName(mode === "rename" ? current?.name ?? "" : "");
    setParent(mode === "create" ? current?.id ?? null : current?.parentId ?? null);
    setEditor({ mode, id: mode === "create" ? null : current?.id ?? null });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editor || disabled) return;
    setError("");
    try {
      if (editor.mode === "create") await onCreate(name.trim(), parent);
      else if (!edited) throw new Error("This folder no longer exists. Reload the library.");
      else if (editor.mode === "rename") await onUpdate(edited.id, { name: name.trim() });
      else if (editor.mode === "move") await onUpdate(edited.id, { parentId: parent });
      else await onDelete(edited.id);
      setEditor(null);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The folder could not be updated. Please retry."); }
  }

  function branch(nodes: HtmlFolderEntry[]) {
    return <ul>{nodes.map((entry) => <li key={entry.folder.id}>
      <div className="babel-pdf-folders__row">
        <button className="babel-pdf-folders__disclosure" type="button" disabled={disabled || !entry.children.length}
          aria-label={`${collapsed.has(entry.folder.id) ? "Expand" : "Collapse"} ${entry.folder.name}`}
          aria-expanded={entry.children.length ? !collapsed.has(entry.folder.id) : undefined}
          onClick={() => setCollapsed((previous) => { const next = new Set(previous); if (next.has(entry.folder.id)) next.delete(entry.folder.id); else next.add(entry.folder.id); return next; })}>
          <span aria-hidden="true">{entry.children.length ? collapsed.has(entry.folder.id) ? "▸" : "▾" : "·"}</span>
        </button>
        <button className="babel-pdf-folders__select" type="button" disabled={disabled} title={entry.path}
          aria-current={selected === entry.folder.id ? "page" : undefined}
          onClick={() => { onSelect(entry.folder.id); setEditor(null); }}>
          <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M2 5h6l2 2h8v10H2V5Z" stroke="currentColor" strokeWidth="1.4" /></svg>
          <span>{entry.folder.name}</span><small className="babel-pdf-folders__count">{counts.get(entry.folder.id) ?? 0}</small>
        </button>
      </div>
      {!collapsed.has(entry.folder.id) && entry.children.length > 0 && branch(entry.children)}
    </li>)}</ul>;
  }

  return <section className="babel-pdf-folders" aria-label="HTML folders">
    <div className="babel-pdf-folders__heading"><h3>Folders</h3><button type="button" disabled={disabled} onClick={() => start("create")}>New folder</button></div>
    <nav className="babel-pdf-folders__tree" aria-label="Browse HTML folders">
      <div className="babel-pdf-folders__special">
        <button type="button" disabled={disabled} aria-current={selected === "all" ? "page" : undefined} onClick={() => { onSelect("all"); setEditor(null); }}>All HTML <small>{documents.length}</small></button>
        <button type="button" disabled={disabled} aria-current={selected === null ? "page" : undefined} onClick={() => { onSelect(null); setEditor(null); }}>Unfiled <small>{counts.get(null) ?? 0}</small></button>
      </div>
      {branch(entries.filter((entry) => entry.depth === 0))}
    </nav>
    {current && <div className="babel-pdf-folders__actions" role="group" aria-label={`Manage folder: ${current.name}`}>
      <button type="button" disabled={disabled} onClick={() => start("rename")}>Rename</button>
      <button type="button" disabled={disabled} onClick={() => start("move")}>Move</button>
      <button type="button" disabled={disabled || !empty} title={empty ? "Delete empty folder" : "Move its HTML documents and subfolders out before deleting"} onClick={() => start("delete")}>Delete</button>
    </div>}
    {editor && <div ref={editorRef} className="babel-pdf-folders__editor">
      <form onSubmit={(event) => void save(event)}>
        <strong>{editor.mode === "create" ? "New folder" : editor.mode === "rename" ? "Rename folder" : editor.mode === "move" ? "Move folder" : "Delete folder"}</strong>
        {editor.mode === "create" || editor.mode === "rename" ? <label>Folder name<input type="text" value={name} maxLength={HTML_FOLDER_NAME_MAX_LENGTH} required disabled={disabled} onChange={(event) => setName(event.currentTarget.value)} placeholder="Folder name" /></label> : null}
        {editor.mode === "create" || editor.mode === "move" ? <HtmlFolderPicker folders={folders} value={parent} onChange={setParent} label="Parent folder" rootLabel="Top level" disabled={disabled}
          excludedIds={editor.mode === "move" && editor.id ? htmlFolderSubtreeIds(folders, editor.id) : undefined} /> : null}
        {editor.mode === "delete" && <p>Delete “{edited?.name}”? Only empty folders can be deleted.</p>}
        {error && <p className="babel-pdf-folders__error" role="alert">{error}</p>}
        <div><button type="button" disabled={disabled} onClick={() => setEditor(null)}>Cancel</button><button type="submit" disabled={disabled || ((editor.mode === "create" || editor.mode === "rename") && !name.trim())}>{disabled ? "Saving…" : editor.mode === "delete" ? "Delete folder" : editor.mode === "move" ? "Move folder" : "Save folder"}</button></div>
      </form>
    </div>}
    <p className="babel-pdf-folders__hint">Folders belong to this app’s HTML library.</p>
  </section>;
}
