"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  htmlFolderNameKey, isHtmlProgress, normalizeHtmlAssetPath, HTML_TITLE_MAX_LENGTH,
  type HtmlBundle, type HtmlDocumentSummary, type HtmlFolder,
} from "@babel-apps/platform/html/core";
import { openSearchWindow } from "@babel-apps/platform/search/window";
import { pdfExcerptOwnerId, preparePdfExcerptOwner } from "@babel-apps/pdf/excerpts";
import { HtmlFolderPicker, HtmlFolders, type HtmlFolderScope } from "./folder-controls";
import { htmlFolderEntries, isHtmlFolder } from "./folders";
import { prepareHtmlImport, type HtmlImportEntry, type HtmlImportSelection } from "./imports";

type Mode = "single" | "folder";
interface ImportItem extends HtmlImportEntry { id: string; status: "pending" | "importing" | "imported" | "failed" | "invalid" }
interface ImportChoice {
  selection: HtmlImportSelection | null; items: ImportItem[]; uploadId: string; bundleId: string | null;
  destination: string | null; locked: boolean; title: string;
}
const emptyChoice = (): ImportChoice => ({ selection: null, items: [], uploadId: "", bundleId: null, destination: null, locked: false, title: "" });

export interface HtmlLibraryButtonProps { appId: string; appName: string; notebookHref: string }

function HtmlIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14 3H5v18h14V8l-5-5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><path d="M14 3v5h5M9 12l-2 2 2 2m6-4 2 2-2 2m-3-5-1 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
function errorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "error" in data && data.error && typeof data.error === "object" && "message" in data.error && typeof data.error.message === "string") return data.error.message;
  return fallback;
}
function object(data: unknown): data is Record<string, unknown> { return Boolean(data && typeof data === "object" && !Array.isArray(data)); }
function isSummary(data: unknown): data is HtmlDocumentSummary {
  if (!object(data)) return false;
  return typeof data.id === "string" && /^[0-9a-f-]{36}$/u.test(data.id) && typeof data.title === "string" && typeof data.fileName === "string" &&
    typeof data.bundleId === "string" && typeof data.entryPath === "string" && normalizeHtmlAssetPath(data.entryPath) !== null &&
    (data.folderId === null || typeof data.folderId === "string") && typeof data.size === "number" && Number.isFinite(data.size) && data.size > 0 &&
    typeof data.importedAt === "string" && typeof data.updatedAt === "string" && isHtmlProgress(data.progress);
}
function isBundle(data: unknown): data is HtmlBundle {
  return object(data) && typeof data.id === "string" && /^[0-9a-f-]{36}$/u.test(data.id) && typeof data.importedAt === "string" &&
    typeof data.size === "number" && data.size >= 0 && Array.isArray(data.files) && data.files.every((file) => object(file) && normalizeHtmlAssetPath(file.path) !== null && typeof file.size === "number" && file.size >= 0 && typeof file.mimeType === "string");
}
async function json(response: Response, fallback: string): Promise<Record<string, unknown>> {
  let data: unknown;
  try { data = await response.json(); } catch { /* Use the actionable fallback below. */ }
  if (!response.ok) throw new Error(errorMessage(data, fallback));
  if (!object(data)) throw new Error("The app returned an unexpected response. Reload the library and retry.");
  return data;
}
async function readLibrary(response: Response): Promise<{ documents: HtmlDocumentSummary[]; folders: HtmlFolder[] }> {
  const data = await json(response, "The HTML library could not be loaded. Please retry.");
  if (!Array.isArray(data.documents) || !data.documents.every(isSummary) || !Array.isArray(data.folders) || !data.folders.every(isHtmlFolder)) throw new Error("The app returned an unexpected HTML library response. Please retry.");
  return { documents: data.documents, folders: data.folders };
}
async function readFolder(response: Response): Promise<HtmlFolder> {
  const data = await json(response, "The folder could not be saved. Please retry.");
  if (!isHtmlFolder(data.folder)) throw new Error("The app returned an unexpected folder response. Reload the library.");
  return data.folder;
}
function fileSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
function importDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "Unknown date";
}

export function HtmlLibraryButton({ appId, appName, notebookHref }: HtmlLibraryButtonProps) {
  const router = useRouter();
  const pathname = usePathname();
  const dialog = useRef<HTMLDialogElement>(null);
  const singleInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const deletePanel = useRef<HTMLDivElement>(null);
  const movePanel = useRef<HTMLDivElement>(null);
  const listRequest = useRef<AbortController | null>(null);
  const uploadRequest = useRef<XMLHttpRequest | null>(null);
  const writeBusy = useRef(false);
  const canceled = useRef(false);
  const mounted = useRef(true);
  const [documents, setDocuments] = useState<HtmlDocumentSummary[]>([]);
  const [folders, setFolders] = useState<HtmlFolder[]>([]);
  const [scope, setScope] = useState<HtmlFolderScope>("all");
  const [loading, setLoading] = useState(false);
  const [operation, setOperation] = useState<"import" | "organize" | "delete" | null>(null);
  const [mode, setMode] = useState<Mode>("single");
  const [choices, setChoices] = useState<Record<Mode, ImportChoice>>({ single: emptyChoice(), folder: emptyChoice() });
  const [search, setSearch] = useState("");
  const [listError, setListError] = useState("");
  const [importError, setImportError] = useState("");
  const [notice, setNotice] = useState("");
  const [canceling, setCanceling] = useState(false);
  const [percent, setPercent] = useState<number | null>(null);
  const [importLabel, setImportLabel] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [moveTarget, setMoveTarget] = useState<string | null>(null);
  const [moveDestination, setMoveDestination] = useState<string | null>(null);
  const [moveError, setMoveError] = useState("");
  const choice = choices[mode];
  const busy = loading || operation !== null;
  const importing = operation === "import";
  const folderEntries = useMemo(() => htmlFolderEntries(folders), [folders]);
  const entryById = useMemo(() => new Map(folderEntries.map((entry) => [entry.folder.id, entry])), [folderEntries]);
  const selectedEntry = typeof scope === "string" ? entryById.get(scope) : undefined;
  const path = (id: string | null) => id === null ? "Unfiled" : entryById.get(id)?.path ?? "Unavailable folder";

  useEffect(() => preparePdfExcerptOwner(() => {
    if (pathname !== notebookHref && !pathname.startsWith(`${notebookHref}/`)) router.push(notebookHref);
  }), [notebookHref, pathname, router]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; canceled.current = true; listRequest.current?.abort(); uploadRequest.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!deleteTarget) return;
    deletePanel.current?.scrollIntoView({ block: "nearest" });
    deletePanel.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }, [deleteTarget]);
  useEffect(() => {
    if (!moveTarget) return;
    movePanel.current?.scrollIntoView({ block: "nearest" });
    movePanel.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }, [moveTarget]);

  const reload = useCallback(async () => {
    if (writeBusy.current) return;
    listRequest.current?.abort();
    const request = new AbortController();
    listRequest.current = request; setLoading(true); setListError("");
    try {
      const data = await readLibrary(await fetch("/api/html/documents", { cache: "no-store", signal: request.signal }));
      if (request.signal.aborted || !mounted.current) return;
      setDocuments(data.documents); setFolders(data.folders);
      setScope((id) => id === "all" || id === null || data.folders.some((folder) => folder.id === id) ? id : "all");
    } catch (failure) { if (!request.signal.aborted && mounted.current) setListError(failure instanceof Error ? failure.message : "The HTML library could not be loaded."); }
    finally { if (listRequest.current === request) { listRequest.current = null; if (mounted.current) setLoading(false); } }
  }, []);

  function openLibrary() { if (dialog.current && !dialog.current.open) { dialog.current.showModal(); void reload(); } }
  function cancelImport() { if (importing) { canceled.current = true; setCanceling(true); } }
  function closeLibrary() {
    listRequest.current?.abort(); cancelImport();
    if (operation !== "delete") setDeleteTarget(null);
    if (operation !== "organize") setMoveTarget(null);
    dialog.current?.close();
  }
  function openDocument(document: HtmlDocumentSummary) {
    const owner = pdfExcerptOwnerId();
    const opened = openSearchWindow(window, `/html-reader?id=${encodeURIComponent(document.id)}&owner=${encodeURIComponent(owner)}`, `babel-html-${appId}-${owner}-${document.id}`, {
      sessionStorageKeys: [`babel:${appId}:pages`], features: "popup=yes,width=1280,height=900,resizable=yes,scrollbars=yes",
    });
    if (opened) closeLibrary(); else setListError("The reading window was blocked. Allow pop-ups for this app, then select Open HTML again.");
  }
  function selectShelf(id: HtmlFolderScope) {
    setScope(id); setSearch(""); setDeleteTarget(null); setMoveTarget(null);
    setChoices((previous) => previous[mode].locked ? previous : { ...previous, [mode]: { ...previous[mode], destination: id === "all" ? null : id } });
  }
  function chooseMode(next: Mode) {
    setMode(next); setImportError("");
    setChoices((previous) => previous[next].locked ? previous : { ...previous, [next]: { ...previous[next], destination: scope === "all" ? null : scope } });
  }
  async function releaseBundle(id: string | null) {
    if (!id) return;
    try { await fetch(`/api/html/bundles/${encodeURIComponent(id)}`, { method: "DELETE" }); }
    catch { /* Referenced bundles stay protected; a later cleanup can retry unused bundles. */ }
  }
  function chooseFiles(files: File[], target: Mode) {
    if (writeBusy.current || !files.length) return;
    const selection = prepareHtmlImport(files, target === "folder");
    const previous = choices[target];
    void releaseBundle(previous.bundleId);
    const destination = previous.destination === null || folders.some((folder) => folder.id === previous.destination) ? previous.destination : scope === "all" ? null : scope;
    setChoices((current) => ({ ...current, [target]: {
      selection, items: selection.entries.map((entry) => ({ ...entry, id: crypto.randomUUID(), status: entry.error ? "invalid" : "pending" })),
      uploadId: crypto.randomUUID(), bundleId: null, destination, locked: false, title: selection.entries[0]?.title ?? "",
    } }));
    setImportError(selection.error); setNotice(""); setPercent(null);
  }
  function clearSelection() {
    if (writeBusy.current) return;
    void releaseBundle(choice.bundleId);
    setChoices((previous) => ({ ...previous, [mode]: { ...emptyChoice(), destination: previous[mode].destination } }));
    setImportError(""); setNotice(""); setPercent(null);
  }
  function updateChoice(target: Mode, changes: Partial<ImportChoice>) {
    if (mounted.current) setChoices((previous) => ({ ...previous, [target]: { ...previous[target], ...changes } }));
  }
  function updateItem(target: Mode, id: string, changes: Partial<ImportItem>) {
    if (mounted.current) setChoices((previous) => ({ ...previous, [target]: { ...previous[target], items: previous[target].items.map((item) => item.id === id ? { ...item, ...changes } : item) } }));
  }

  function uploadBundle(selection: HtmlImportSelection, importId: string): Promise<HtmlBundle> {
    return new Promise((resolve, reject) => {
      const body = new FormData();
      body.set("manifest", JSON.stringify({ files: selection.files.map(({ path, field }) => ({ path, field })) }));
      for (const { file, field } of selection.files) body.append(field, file, file.name);
      const request = new XMLHttpRequest(); uploadRequest.current = request;
      const finish = () => { if (uploadRequest.current === request) uploadRequest.current = null; };
      request.upload.onprogress = (event) => { if (mounted.current) setPercent(event.lengthComputable && event.total ? Math.min(99, Math.round(event.loaded / event.total * 100)) : null); };
      request.onload = () => {
        finish(); let data: unknown;
        try { data = JSON.parse(request.responseText); } catch { /* Keep the file selection for an idempotent retry. */ }
        if (request.status < 200 || request.status >= 300) { reject(new Error(errorMessage(data, "The HTML and resources could not be uploaded. Please retry."))); return; }
        if (!object(data) || !isBundle(data.bundle)) { reject(new Error("The app returned an unexpected bundle response. Retry with the same selection.")); return; }
        resolve(data.bundle);
      };
      request.onerror = () => { finish(); reject(new Error("The app could not be reached. Retry this selection to avoid duplicate imports.")); };
      request.onabort = () => { finish(); reject(new Error("The upload was interrupted. Retry the same selection.")); };
      request.open("POST", "/api/html/bundles"); request.setRequestHeader("X-Babel-Html-Import-Id", importId); request.send(body);
    });
  }

  async function importHtml(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (writeBusy.current || loading || !choice.selection || choice.selection.error) return;
    const currentMode = mode;
    const current = choice;
    const selection = current.selection!;
    const queue = current.items.filter((item) => item.status === "pending" || item.status === "failed");
    if (!queue.length) return;
    if (currentMode === "single" && (!current.title.trim() || current.title.trim().length > HTML_TITLE_MAX_LENGTH)) { setImportError("Enter a document title from 1 to 240 characters."); return; }
    writeBusy.current = true; canceled.current = false; listRequest.current?.abort();
    setOperation("import"); setCanceling(false); setImportError(""); setListError(""); setNotice(""); setSearch(""); updateChoice(currentMode, { locked: true });
    let imported = 0; let failed = 0;
    try {
      const snapshot = await readLibrary(await fetch("/api/html/documents", { cache: "no-store" }));
      const knownFolders = [...snapshot.folders];
      const knownDocuments = new Map(snapshot.documents.map((document) => [document.id, document]));
      if (mounted.current) { setFolders(snapshot.folders); setDocuments(snapshot.documents); }
      let bundleId = current.bundleId;
      if (!bundleId && !canceled.current && mounted.current) {
        setImportLabel("Uploading HTML and local resources…"); setPercent(0);
        const bundle = await uploadBundle(selection, current.uploadId);
        bundleId = bundle.id; updateChoice(currentMode, { bundleId });
      }
      async function destinationFor(parts: string[]): Promise<string | null> {
        let parentId = current.destination;
        for (const name of parts) {
          if (canceled.current || !mounted.current) break;
          const existing = knownFolders.find((folder) => folder.parentId === parentId && htmlFolderNameKey(folder.name) === htmlFolderNameKey(name));
          if (existing) { parentId = existing.id; continue; }
          const response = await fetch("/api/html/folders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, parentId }) });
          if (response.status === 409) {
            const latest = await readLibrary(await fetch("/api/html/documents", { cache: "no-store" }));
            knownFolders.splice(0, knownFolders.length, ...latest.folders);
            if (mounted.current) setFolders(latest.folders);
            const sibling = knownFolders.find((folder) => folder.parentId === parentId && htmlFolderNameKey(folder.name) === htmlFolderNameKey(name));
            if (sibling) { parentId = sibling.id; continue; }
          }
          const created = await readFolder(response); knownFolders.push(created); parentId = created.id;
          if (mounted.current) setFolders([...knownFolders]);
        }
        return parentId;
      }
      for (const [index, item] of queue.entries()) {
        if (!bundleId || canceled.current || !mounted.current) break;
        updateItem(currentMode, item.id, { status: "importing", error: "" });
        setImportLabel(`Adding ${index + 1} of ${queue.length} · ${item.path}`); setPercent(Math.round(index / queue.length * 100));
        try {
          const existing = knownDocuments.get(item.id);
          const folderId = existing ? existing.folderId : await destinationFor(item.folderPath);
          if (canceled.current || !mounted.current) { updateItem(currentMode, item.id, { status: "pending" }); break; }
          const response = await fetch("/api/html/documents", { method: "POST", headers: { "Content-Type": "application/json", "X-Babel-Html-Import-Id": item.id },
            body: JSON.stringify({ bundleId, entryPath: item.path, title: currentMode === "single" ? current.title.trim() : item.title, folderId }) });
          const data = await json(response, "This HTML document could not be added. Please retry.");
          if (!isSummary(data.document)) throw new Error("The app returned an unexpected document response. Retry this selection.");
          const document = data.document; knownDocuments.set(document.id, document); imported += 1;
          updateItem(currentMode, item.id, { status: "imported", error: "" });
          if (mounted.current) { setDocuments((previous) => [document, ...previous.filter((entry) => entry.id !== document.id)]); setPercent(Math.round((index + 1) / queue.length * 100)); }
        } catch (failure) {
          failed += 1;
          const message = failure instanceof Error ? failure.message : "This HTML document could not be added.";
          updateItem(currentMode, item.id, { status: "failed", error: message });
          if (currentMode === "single" && mounted.current) setImportError(message);
        }
      }
      if (mounted.current) setNotice(`${imported} HTML ${imported === 1 ? "document" : "documents"} imported${failed ? `; ${failed} failed` : ""}.${canceled.current ? " Import stopped. Remaining documents are ready to resume." : failed ? " Retry remaining documents below." : " Select Open HTML to read in a separate window."}`);
    } catch (failure) { if (mounted.current) setImportError(failure instanceof Error ? failure.message : "The HTML import could not be started. Please retry."); }
    finally { writeBusy.current = false; if (mounted.current) { setOperation(null); setCanceling(false); setPercent(null); setImportLabel(""); } }
  }

  async function organize(action: () => Promise<void>, kind: "organize" | "delete" = "organize") {
    if (writeBusy.current) throw new Error("The library is busy. Wait for the current operation.");
    writeBusy.current = true; listRequest.current?.abort(); setOperation(kind); setNotice("");
    try { await action(); } finally { writeBusy.current = false; if (mounted.current) setOperation(null); }
  }
  async function createFolder(name: string, parentId: string | null) {
    await organize(async () => {
      const folder = await readFolder(await fetch("/api/html/folders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, parentId }) }));
      if (!mounted.current) return;
      setFolders((previous) => [...previous, folder].sort((left, right) => htmlFolderNameKey(left.name).localeCompare(htmlFolderNameKey(right.name), "en-US")));
      selectShelf(folder.id); setNotice(`“${folder.name}” was created.`);
    });
  }
  async function updateFolder(id: string, changes: { name?: string; parentId?: string | null }) {
    await organize(async () => {
      const folder = await readFolder(await fetch(`/api/html/folders/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes) }));
      if (!mounted.current) return;
      setFolders((previous) => previous.map((entry) => entry.id === id ? folder : entry).sort((left, right) => htmlFolderNameKey(left.name).localeCompare(htmlFolderNameKey(right.name), "en-US")));
      setNotice(`“${folder.name}” was ${"name" in changes ? "renamed" : "moved"}.`);
    });
  }
  async function deleteFolder(id: string) {
    await organize(async () => {
      const response = await fetch(`/api/html/folders/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok && response.status !== 404) await json(response, "The empty folder could not be deleted. Please retry.");
      if (mounted.current) { setFolders((previous) => previous.filter((folder) => folder.id !== id)); setScope("all"); setNotice("The empty folder was deleted."); }
    });
  }
  async function moveDocument(document: HtmlDocumentSummary) {
    setMoveError("");
    try { await organize(async () => {
      const data = await json(await fetch(`/api/html/documents/${encodeURIComponent(document.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folderId: moveDestination }) }), "The HTML document could not be moved. Please retry.");
      if (!isSummary(data.document)) throw new Error("The app returned an unexpected document response. Reload the library.");
      const moved = data.document;
      if (mounted.current) { setDocuments((previous) => previous.map((entry) => entry.id === moved.id ? moved : entry)); setMoveTarget(null); setNotice(`“${document.title}” was moved.`); }
    }); } catch (failure) { if (mounted.current) setMoveError(failure instanceof Error ? failure.message : "The HTML document could not be moved."); }
  }
  async function deleteDocument(document: HtmlDocumentSummary) {
    setDeleteError("");
    try { await organize(async () => {
      const response = await fetch(`/api/html/documents/${encodeURIComponent(document.id)}`, { method: "DELETE" });
      if (!response.ok && response.status !== 404) await json(response, "The HTML document could not be deleted. Please retry.");
      if (mounted.current) { setDocuments((previous) => previous.filter((entry) => entry.id !== document.id)); setDeleteTarget(null); setNotice(`“${document.title}” was deleted. Notes created from it are unchanged.`); }
    }, "delete"); } catch (failure) { if (mounted.current) setDeleteError(failure instanceof Error ? failure.message : "The HTML document could not be deleted."); }
  }

  const query = search.trim().toLocaleLowerCase();
  const scoped = documents.filter((document) => scope === "all" || document.folderId === scope);
  const shown = scoped.filter((document) => !query || `${document.title}\n${document.fileName}\n${document.entryPath}`.toLocaleLowerCase().includes(query));
  const pending = choice.items.filter((item) => item.status === "pending" || item.status === "failed").length;
  const ready = Boolean(choice.selection && !choice.selection.error && pending > 0);
  const documentHref = (document: HtmlDocumentSummary) => `/html-reader?id=${encodeURIComponent(document.id)}&owner=${encodeURIComponent(pdfExcerptOwnerId())}`;

  return <>
    <button className="babel-pdf-library-button" type="button" onClick={openLibrary} title={`Open ${appName} HTML library`}><HtmlIcon /><span>HTML</span></button>
    <dialog ref={dialog} className="babel-pdf-library babel-html-library babel-pdf-theme" data-pdf-app={appId} aria-label={`${appName} HTML library`}
      onCancel={(event) => { if (event.target === event.currentTarget) { event.preventDefault(); closeLibrary(); } }}>
      <header className="babel-pdf-library-header"><div className="babel-pdf-library-heading"><span className="babel-pdf-library-mark"><HtmlIcon /></span><div><p>{appName} / READING ROOM</p><h2>HTML library</h2></div></div><button className="babel-pdf-library-close" type="button" aria-label="Close HTML library" onClick={closeLibrary}>×</button></header>
      <div className="babel-pdf-library-body">
        <aside className="babel-pdf-library-import">
          <HtmlFolders folders={folders} documents={documents} selected={scope} onSelect={selectShelf} disabled={busy} onCreate={createFolder} onUpdate={updateFolder} onDelete={deleteFolder} />
          <div className="babel-pdf-library-import-intro"><h3 className="babel-pdf-library-import-heading">Add to your shelf</h3><p>Keep HTML pages and their local resources together.</p></div>
          <form onSubmit={(event) => void importHtml(event)}>
            <div className="babel-pdf-folders__destination"><span>Import into</span><HtmlFolderPicker folders={folders} value={choice.destination} label="Import destination" disabled={busy || choice.locked} onChange={(destination) => updateChoice(mode, { destination })} />{choice.locked && <p className="babel-pdf-folders__hint">The title and destination are kept for retries. Choose files again to change them.</p>}</div>
            <div className="babel-pdf-library-import-mode" role="group" aria-label="HTML import mode"><button type="button" aria-pressed={mode === "single"} disabled={busy} onClick={() => chooseMode("single")}>Single HTML</button><button type="button" aria-pressed={mode === "folder"} disabled={busy} onClick={() => chooseMode("folder")}>Folder batch</button></div>
            {mode === "single" ? <>
              <label className="babel-pdf-library-file-label" htmlFor={`babel-html-file-${appId}`}>Choose HTML <span>.html or .htm</span></label>
              <input ref={singleInput} id={`babel-html-file-${appId}`} type="file" accept=".html,.htm,text/html" hidden tabIndex={-1} disabled={busy} onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; chooseFiles(files, "single"); }} />
              <div className="babel-pdf-library-file-picker"><button className="babel-pdf-library-choose-file" type="button" disabled={busy} onClick={() => singleInput.current?.click()}>Choose file</button><span className="babel-pdf-library-file-status" role="status">{choice.selection ? "HTML selected" : "No file selected"}</span></div>
              {choice.selection && <p className="babel-pdf-library-selected">{choice.selection.files[0]?.file.name}<span>{fileSize(choice.selection.size)}</span></p>}
              <label className="babel-pdf-library-field-label" htmlFor={`babel-html-title-${appId}`}>Document title</label><input id={`babel-html-title-${appId}`} className="babel-pdf-library-title-input" type="text" maxLength={HTML_TITLE_MAX_LENGTH} value={choice.title} disabled={busy || choice.locked} placeholder="Title on your shelf" onChange={(event) => updateChoice(mode, { title: event.currentTarget.value })} />
              <p className="babel-pdf-folders__hint">For pages with separate pictures, styles or scripts, choose Folder batch so those resources are included.</p>
            </> : <>
              <p className="babel-pdf-library-file-label">Choose a folder <span>Up to 512 MiB total</span></p><input ref={(node) => { folderInput.current = node; node?.setAttribute("webkitdirectory", ""); node?.setAttribute("directory", ""); }} type="file" multiple hidden tabIndex={-1} disabled={busy} onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; chooseFiles(files, "folder"); }} />
              <button className="babel-pdf-library-choose-file" type="button" disabled={busy} onClick={() => folderInput.current?.click()}>Choose folder</button>
              <p className="babel-pdf-library-batch-summary" role="status">{choice.selection ? `${choice.selection.folder} · ${choice.items.length} HTML ${choice.items.length === 1 ? "document" : "documents"} · ${choice.selection.files.length - choice.items.length} resource files · ${fileSize(choice.selection.size)}. Folder structure will be preserved.` : "Includes .html and .htm pages plus their local pictures, styles, scripts and other resources. Folder structure is preserved."}</p>
            </>}
            {choice.items.length > 0 && <ul className="babel-pdf-library-batch-results" aria-label="HTML import results">{choice.items.map((item) => <li key={item.id} className={`babel-pdf-library-batch-result${item.status === "failed" || item.status === "invalid" ? " is-error" : ""}`}><span className="babel-pdf-library-batch-label" title={item.path}>{item.path}</span><span className="babel-pdf-library-batch-status">{item.error || ({ pending: "Ready", importing: "Adding…", imported: "Imported", failed: "Failed", invalid: "Invalid file" } as const)[item.status]}</span></li>)}</ul>}
            {importError && <p className="babel-pdf-library-error" role="alert">{importError}</p>}
            {importing && <div className="babel-pdf-library-upload-progress" aria-live="polite"><progress aria-label="HTML import progress" max={100} value={percent ?? undefined}/><span>{importLabel}</span>{percent !== null && <span>{percent}%</span>}</div>}
            <button className="babel-pdf-library-primary" type="submit" disabled={!ready || busy}>{importing ? "Importing…" : choice.items.some((item) => item.status === "failed") ? "Retry remaining documents" : mode === "single" ? "Import HTML" : "Import documents"}<span aria-hidden="true">↗</span></button>
            {importing ? <button className="babel-pdf-library-text-button" type="button" disabled={canceling} onClick={cancelImport}>{canceling ? "Finishing current operation…" : "Cancel import"}</button> : choice.selection && <button className="babel-pdf-library-text-button" type="button" disabled={busy} onClick={clearSelection}>Clear selection</button>}
          </form>
          <p className="babel-pdf-library-local-note">HTML, bundled resources, reading positions and annotations stay in this app’s private data. Interactive pages run separately from the notebook. Internet resources are blocked by default.</p>
        </aside>
        <section className="babel-pdf-library-shelf" aria-label="Imported HTML documents">
          <div className="babel-pdf-library-toolbar"><div><h3>{scope === "all" ? "All HTML" : scope === null ? "Unfiled" : selectedEntry?.folder.name ?? "Your shelf"}</h3><span>{scoped.length} {scoped.length === 1 ? "document" : "documents"}</span></div><button className="babel-pdf-library-reload" type="button" disabled={busy} onClick={() => void reload()}>{loading ? "Loading…" : "Reload"}</button></div>
          <p className="babel-pdf-folders__breadcrumb">{appName} / {scope === "all" ? "All HTML" : path(scope)}</p>
          {selectedEntry && selectedEntry.children.length > 0 && <div className="babel-pdf-folders__children" aria-label="Subfolders">{selectedEntry.children.map((entry) => <button className="babel-pdf-library-reload" type="button" key={entry.folder.id} disabled={busy} onClick={() => selectShelf(entry.folder.id)}>↳ {entry.folder.name}</button>)}</div>}
          <label className="babel-pdf-library-search"><span className="babel-pdf-library-sr-only">Search this app’s HTML documents</span><HtmlIcon /><input type="search" value={search} placeholder="Search titles or filenames" onChange={(event) => setSearch(event.currentTarget.value)} /></label>
          {listError && <div className="babel-pdf-library-list-error" role="alert"><p>{listError}</p><button className="babel-pdf-library-text-button" type="button" disabled={busy} onClick={() => void reload()}>Retry loading</button></div>}
          {notice && <p className="babel-pdf-library-notice" role="status">{notice}</p>}
          <div className="babel-pdf-library-documents" tabIndex={0} role="region" aria-label="HTML shelf" aria-busy={loading}>
            {loading && !documents.length ? <div className="babel-pdf-library-empty" role="status"><HtmlIcon /><h4>Loading your shelf…</h4><p>Retrieving HTML documents from {appName}.</p></div>
              : !shown.length ? <div className="babel-pdf-library-empty"><HtmlIcon /><h4>{query ? "No matching HTML documents" : listError ? "Your shelf is unavailable" : scope === "all" ? "Your reading starts here" : "No HTML documents in this folder"}</h4><p>{query ? "Try another title or filename." : listError ? "Retry loading your library when the app is available." : "Import HTML here, move a document from All HTML, or open a subfolder."}</p></div>
                : <ul>{shown.map((document) => <li className="babel-pdf-library-document" key={document.id}>
                  <div className="babel-pdf-library-document-cover" aria-hidden="true"><HtmlIcon /><span>HTML</span></div>
                  <div className="babel-pdf-library-document-details"><h4 title={document.title}>{document.title}</h4><p className="babel-pdf-library-document-filename" title={document.entryPath}>{document.fileName}</p><button className="babel-pdf-folders__document-path" type="button" disabled={busy} title={path(document.folderId)} onClick={() => selectShelf(document.folderId)}>{path(document.folderId)}</button><p className="babel-pdf-library-document-meta"><span>{fileSize(document.size)}</span><span>{Math.round(document.progress.position * 100)}% read</span><span>Added {importDate(document.importedAt)}</span></p></div>
                  {deleteTarget === document.id ? <div ref={deletePanel} className="babel-pdf-library-delete-confirm" role="group" aria-label={`Confirm deletion: ${document.title}`}><p>Delete this HTML document, its reading position and annotations? This cannot be undone. Notes created from it will stay. Resources shared with other HTML documents are kept until their last document is deleted.</p>{deleteError && <p className="babel-pdf-library-error" role="alert">{deleteError}</p>}<div><button type="button" disabled={busy} onClick={() => setDeleteTarget(null)}>Cancel</button><button className="babel-pdf-library-delete" type="button" disabled={busy} onClick={() => void deleteDocument(document)}>{operation === "delete" ? "Deleting…" : "Delete HTML"}</button></div></div>
                    : <div className="babel-pdf-library-document-actions"><a className="babel-pdf-library-open" href={documentHref(document)} target={`babel-html-${appId}-${document.id}`} aria-label={`Open HTML: ${document.title}`} aria-disabled={busy} onClick={(event) => { event.preventDefault(); if (!busy) openDocument(document); }}>Open HTML <span aria-hidden="true">↗</span></a><button className="babel-pdf-library-reload" type="button" disabled={busy} aria-label={`Move HTML: ${document.title}`} onClick={() => { setMoveTarget(document.id); setDeleteTarget(null); setMoveDestination(document.folderId); setMoveError(""); }}>Move</button><button className="babel-pdf-library-delete" type="button" disabled={busy} aria-label={`Delete HTML: ${document.title}`} onClick={() => { setDeleteTarget(document.id); setMoveTarget(null); setDeleteError(""); }}>Delete</button></div>}
                  {moveTarget === document.id && <div ref={movePanel} className="babel-pdf-folders__move-panel" role="group" aria-label={`Move HTML: ${document.title}`}><HtmlFolderPicker folders={folders} value={moveDestination} onChange={setMoveDestination} label="Move HTML to" disabled={busy}/>{moveError && <p className="babel-pdf-folders__error" role="alert">{moveError}</p>}<div><button type="button" disabled={busy} onClick={() => setMoveTarget(null)}>Cancel</button><button type="button" disabled={busy || moveDestination === document.folderId} onClick={() => void moveDocument(document)}>{operation === "organize" ? "Moving…" : "Move HTML"}</button></div></div>}
                </li>)}</ul>}
          </div>
          <footer className="babel-pdf-library-footer">Read on another screen. Send selections back to a new note or your current draft.</footer>
        </section>
      </div>
    </dialog>
  </>;
}
