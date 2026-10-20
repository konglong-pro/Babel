"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { usePathname, useRouter } from "next/navigation";

import { isPdfProgress, pdfFolderNameKey, type PdfDocumentSummary, type PdfFolder } from "@babel-apps/platform/pdf/core";
import { openSearchWindow } from "@babel-apps/platform/search/window";

import { pdfExcerptOwnerId, preparePdfExcerptOwner } from "./excerpts";
import { pdfImportError, preparePdfFolder, type FolderPdf } from "./imports";
import { PdfFolderPicker, PdfFolders, type PdfFolderScope } from "./folder-controls";
import { isPdfFolder, pdfFolderEntries } from "./folders";

interface ImportItem extends FolderPdf {
  importId: string;
  status: "pending" | "importing" | "imported" | "failed" | "invalid";
}

export interface PdfLibraryButtonProps {
  appId: string;
  appName: string;
  notebookHref: string;
}

function LibraryIcon({ className }: { className?: string }) {
  return <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 4.5h6a3 3 0 0 1 3 3V21a4 4 0 0 0-3-1.5H4V4.5Zm16 0h-4a3 3 0 0 0-3 3V21a4 4 0 0 1 3-1.5h4V4.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M7 9h3m-3 4h3m6-4h1m-1 4h1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>;
}

function errorMessage(value: unknown, fallback: string): string {
  if (value && typeof value === "object" && "error" in value) {
    const error = value.error;
    if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  }
  return fallback;
}

function isSummary(value: unknown): value is PdfDocumentSummary {
  if (!value || typeof value !== "object") return false;
  const document = value as Partial<PdfDocumentSummary>;
  return typeof document.id === "string" && /^[0-9a-f-]{36}$/u.test(document.id) &&
    (document.folderId === null || typeof document.folderId === "string") &&
    typeof document.title === "string" && typeof document.fileName === "string" &&
    typeof document.size === "number" && Number.isFinite(document.size) && document.size > 0 &&
    typeof document.importedAt === "string" && typeof document.updatedAt === "string" && isPdfProgress(document.progress);
}

async function libraryResponse(response: Response): Promise<{ documents: PdfDocumentSummary[]; folders: PdfFolder[] }> {
  const data: unknown = await response.json();
  if (!response.ok) throw new Error(errorMessage(data, "The PDF library could not be loaded. Please retry."));
  if (!data || typeof data !== "object" || !("documents" in data) || !Array.isArray(data.documents) || !data.documents.every(isSummary) ||
    !("folders" in data) || !Array.isArray(data.folders) || !data.folders.every(isPdfFolder)) {
    throw new Error("The app returned an unexpected PDF library response. Please retry.");
  }
  return { documents: data.documents, folders: data.folders };
}

async function folderResponse(response: Response): Promise<PdfFolder> {
  const data: unknown = await response.json();
  if (!response.ok) throw new Error(errorMessage(data, "The folder could not be saved. Please retry."));
  if (!data || typeof data !== "object" || !("folder" in data) || !isPdfFolder(data.folder)) throw new Error("The app returned an unexpected folder response. Reload the library.");
  return data.folder;
}

function fileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function importDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "Unknown date";
}

export function PdfLibraryButton({ appId, appName, notebookHref }: PdfLibraryButtonProps) {
  const router = useRouter();
  const pathname = usePathname();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const deleteConfirmRef = useRef<HTMLDivElement>(null);
  const listRequest = useRef<AbortController | null>(null);
  const uploadRequest = useRef<XMLHttpRequest | null>(null);
  const canceled = useRef(false);
  const importBusy = useRef(false);
  const deleteBusy = useRef(false);
  const importDestinationSnapshot = useRef<Record<"single" | "folder", { folderId: string | null } | null>>({ single: null, folder: null });
  const selectedImportId = useRef("");
  const mounted = useRef(true);
  const [documents, setDocuments] = useState<PdfDocumentSummary[]>([]);
  const [folders, setFolders] = useState<PdfFolder[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<PdfFolderScope>("all");
  const [importDestinations, setImportDestinations] = useState<Record<"single" | "folder", string | null>>({ single: null, folder: null });
  const [importLocks, setImportLocks] = useState({ single: false, folder: false });
  const [organizing, setOrganizing] = useState(false);
  const [moveTarget, setMoveTarget] = useState<string | null>(null);
  const [moveDestination, setMoveDestination] = useState<string | null>(null);
  const [moveError, setMoveError] = useState("");
  const movePanelRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [percent, setPercent] = useState<number | null>(null);
  const [importMode, setImportMode] = useState<"single" | "folder">("single");
  const importDestination = importDestinations[importMode];
  const importDestinationLocked = importLocks[importMode];
  const [folder, setFolder] = useState("");
  const [skipped, setSkipped] = useState(0);
  const [batch, setBatch] = useState<ImportItem[]>([]);
  const [importLabel, setImportLabel] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    const confirmation = deleteConfirmRef.current;
    if (!deleteTarget || !confirmation) return;
    confirmation.scrollIntoView({ block: "nearest" });
    confirmation.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }, [deleteTarget]);

  useEffect(() => {
    if (!moveTarget) return;
    movePanelRef.current?.scrollIntoView({ block: "nearest" });
    movePanelRef.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }, [moveTarget]);

  useEffect(() => preparePdfExcerptOwner(() => {
    if (pathname !== notebookHref && !pathname.startsWith(`${notebookHref}/`)) router.push(notebookHref);
  }), [notebookHref, pathname, router]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      canceled.current = true;
      listRequest.current?.abort();
      uploadRequest.current?.abort();
    };
  }, []);

  const reload = useCallback(async () => {
    if (importBusy.current || deleteBusy.current) return;
    listRequest.current?.abort();
    const request = new AbortController();
    listRequest.current = request;
    setLoading(true);
    setListError("");
    try {
      const response = await fetch("/api/pdf/documents", { cache: "no-store", signal: request.signal });
      const data = await libraryResponse(response);
      if (!request.signal.aborted) {
        setDocuments(data.documents); setFolders(data.folders);
        setSelectedFolder((id) => id === "all" || id === null || data.folders.some((folder) => folder.id === id) ? id : "all");
      }
    } catch (error) {
      if (!request.signal.aborted) setListError(error instanceof Error ? error.message : "The PDF library could not be loaded.");
    } finally {
      if (listRequest.current === request) { listRequest.current = null; setLoading(false); }
    }
  }, []);

  function openLibrary() {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    void reload();
  }

  function closeLibrary() {
    listRequest.current?.abort();
    cancelImport();
    if (!deleting) setDeleteTarget(null);
    if (!organizing) setMoveTarget(null);
    dialogRef.current?.close();
  }

  function cancelImport() {
    if (!importBusy.current) return;
    canceled.current = true;
    setCanceling(true);
  }

  function openDocument(document: PdfDocumentSummary) {
    const owner = pdfExcerptOwnerId();
    const destination = `/pdf-reader?id=${encodeURIComponent(document.id)}&owner=${encodeURIComponent(owner)}`;
    const opened = openSearchWindow(window, destination, `babel-pdf-${appId}-${owner}-${document.id}`, {
      sessionStorageKeys: [`babel:${appId}:pages`],
      features: "popup=yes,width=1280,height=900,resizable=yes,scrollbars=yes",
    });
    if (opened) closeLibrary();
    else setListError("The reading window was blocked. Allow pop-ups for this app, then select Open PDF again.");
  }

  function selectFile(file: File | undefined) {
    importDestinationSnapshot.current.single = null; setImportLocks((previous) => ({ ...previous, single: false }));
    selectedImportId.current = crypto.randomUUID();
    setSelectedFile(file ?? null);
    setUploadError("");
    setNotice("");
    setPercent(null);
    setTitle(file?.name.replace(/\.pdf$/iu, "").slice(0, 240) ?? "");
    if (file) setUploadError(pdfImportError(file));
  }

  function selectFolder(files: FileList | null) {
    importDestinationSnapshot.current.folder = null; setImportLocks((previous) => ({ ...previous, folder: false }));
    const selection = preparePdfFolder(Array.from(files ?? []));
    setFolder(selection.folder);
    setSkipped(selection.skipped);
    setBatch(selection.files.map((file) => ({ ...file, importId: crypto.randomUUID(), status: file.error ? "invalid" : "pending" })));
    setUploadError(selection.files.length ? "" : "No PDF files were found in this folder. Choose another folder.");
    setNotice("");
    setPercent(null);
    if (folderInputRef.current) folderInputRef.current.value = "";
  }

  function uploadPdf(file: File, bookTitle: string, importId: string, folderId: string | null, onProgress: (percent: number | null) => void): Promise<PdfDocumentSummary> {
    return new Promise((resolve, reject) => {
      const body = new FormData();
      body.set("file", file, file.name);
      body.set("title", bookTitle);
      const request = new XMLHttpRequest();
      uploadRequest.current = request;
      const finish = () => { if (uploadRequest.current === request) uploadRequest.current = null; };
      request.upload.onprogress = (progress) => onProgress(progress.lengthComputable && progress.total > 0 ? Math.min(99, Math.round(progress.loaded / progress.total * 100)) : null);
      request.onload = () => {
        finish();
        let data: unknown;
        try { data = JSON.parse(request.responseText); } catch { /* Report the response without clearing the selection. */ }
        if (request.status < 200 || request.status >= 300) { reject(new Error(errorMessage(data, "The PDF could not be imported. Retry this file."))); return; }
        const document = data && typeof data === "object" && "document" in data ? data.document : undefined;
        if (!isSummary(document)) { reject(new Error("The server returned an unexpected response. Reload the library before trying again.")); return; }
        resolve(document);
      };
      request.onerror = () => { finish(); reject(new Error("The app could not be reached. Retry this file.")); };
      request.onabort = () => { finish(); reject(new Error("Import canceled. Remaining files are ready to resume.")); };
      request.open("POST", "/api/pdf/documents");
      request.setRequestHeader("X-Babel-Pdf-Import-Id", importId);
      if (folderId !== null) request.setRequestHeader("X-Babel-Pdf-Folder-Id", folderId);
      request.send(body);
    });
  }

  async function importPdf(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (importBusy.current || deleteBusy.current || loading) return;
    if (importMode === "single") {
      if (!selectedFile) return;
      const invalid = pdfImportError(selectedFile);
      if (invalid) { setUploadError(invalid); return; }
      if (!title.trim() || title.trim().length > 240) { setUploadError("Enter a book title from 1 to 240 characters."); return; }
    }
    const queue = importMode === "folder"
      ? batch.map((item, index) => ({ ...item, index })).filter((item) => item.status === "pending" || item.status === "failed")
      : [{ file: selectedFile!, title: title.trim(), label: selectedFile!.name, folderPath: [], importId: selectedImportId.current || (selectedImportId.current = crypto.randomUUID()), index: -1 }];
    if (!queue.length) return;
    importBusy.current = true;
    canceled.current = false;
    const destination = importDestinationSnapshot.current[importMode] ?? { folderId: importDestination };
    importDestinationSnapshot.current[importMode] = destination; setImportLocks((previous) => ({ ...previous, [importMode]: true }));
    setCanceling(false);
    listRequest.current?.abort();
    setUploading(true); setUploadError(""); setNotice(""); setListError(""); setSearch("");
    let imported = 0;
    let failed = 0;
    const update = (index: number, changes: Partial<ImportItem>) => {
      if (mounted.current && index >= 0) setBatch((previous) => previous.map((item, current) => current === index ? { ...item, ...changes } : item));
    };
    try {
      const snapshot = await libraryResponse(await fetch("/api/pdf/documents", { cache: "no-store" }));
      const knownFolders = [...snapshot.folders];
      if (mounted.current) { setFolders(snapshot.folders); setDocuments(snapshot.documents); }
      async function destinationFor(path: string[]): Promise<string | null> {
        let parentId = destination.folderId;
        for (const name of path) {
          if (canceled.current || !mounted.current) break;
          const existing = knownFolders.find((folder) => folder.parentId === parentId && pdfFolderNameKey(folder.name) === pdfFolderNameKey(name));
          if (existing) { parentId = existing.id; continue; }
          const response = await fetch("/api/pdf/folders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, parentId }) });
          if (response.status === 409) {
            // Another window may have created this sibling after the snapshot.
            const latest = await libraryResponse(await fetch("/api/pdf/documents", { cache: "no-store" }));
            knownFolders.splice(0, knownFolders.length, ...latest.folders);
            if (mounted.current) setFolders(latest.folders);
            const sibling = knownFolders.find((folder) => folder.parentId === parentId && pdfFolderNameKey(folder.name) === pdfFolderNameKey(name));
            if (sibling) { parentId = sibling.id; continue; }
          }
          const created = await folderResponse(response);
          knownFolders.push(created); parentId = created.id;
          if (mounted.current) setFolders([...knownFolders]);
        }
        return parentId;
      }
      for (const [position, item] of queue.entries()) {
        if (canceled.current || !mounted.current) break;
        update(item.index, { status: "importing", error: "" });
        setImportLabel(queue.length > 1 ? `${position + 1} of ${queue.length} · ${item.file.name}` : item.file.name);
        setPercent(Math.round(position / queue.length * 100));
        try {
          const folderId = await destinationFor(item.folderPath);
          if (canceled.current || !mounted.current) { update(item.index, { status: "pending" }); break; }
          const document = await uploadPdf(item.file, item.title, item.importId, folderId, (value) => {
            if (mounted.current) setPercent(value === null ? null : Math.round((position * 100 + value) / queue.length));
          });
          imported += 1;
          update(item.index, { status: "imported", error: "" });
          if (!mounted.current) break;
          setDocuments((previous) => [document, ...previous.filter((entry) => entry.id !== document.id)]);
          if (importMode === "single") {
            setSelectedFile(null); setTitle("");
            if (inputRef.current) inputRef.current.value = "";
          }
        } catch (failure) {
          const message = failure instanceof Error ? failure.message : "This PDF could not be imported.";
          update(item.index, { status: canceled.current ? "pending" : "failed", error: canceled.current ? "" : message });
          if (canceled.current) break;
          failed += 1;
          if (importMode === "single" && mounted.current) setUploadError(message);
        }
      }
      if (mounted.current) {
        const result = `${imported} ${imported === 1 ? "PDF" : "PDFs"} imported${failed ? `; ${failed} failed` : ""}.`;
        setNotice(canceled.current ? `${result} Import stopped. Remaining files are ready to resume.` : `${result}${failed ? " Retry remaining files below." : " Select Open PDF to read in a separate window."}`);
      }
    } catch (failure) {
      if (mounted.current) setUploadError(failure instanceof Error ? failure.message : "The import could not be started. Please retry.");
    } finally {
      importBusy.current = false;
      if (mounted.current) { setUploading(false); setCanceling(false); setPercent(null); setImportLabel(""); }
    }
  }

  function selectShelf(id: PdfFolderScope) {
    setSelectedFolder(id); setSearch(""); setDeleteTarget(null); setMoveTarget(null);
    if (!importDestinationLocked) setImportDestination(id === "all" ? null : id);
  }

  function setImportDestination(id: string | null) {
    setImportDestinations((previous) => ({ ...previous, [importMode]: id }));
  }

  function chooseImportMode(mode: "single" | "folder") {
    setImportMode(mode); setUploadError("");
    if (!importLocks[mode]) setImportDestinations((previous) => ({ ...previous, [mode]: selectedFolder === "all" ? null : selectedFolder }));
  }

  async function organize(operation: () => Promise<void>) {
    if (deleteBusy.current || importBusy.current) throw new Error("The library is busy. Please wait for the current operation.");
    deleteBusy.current = true; setOrganizing(true); setNotice("");
    listRequest.current?.abort();
    try { await operation(); } finally { deleteBusy.current = false; if (mounted.current) setOrganizing(false); }
  }

  async function createFolder(name: string, parentId: string | null) {
    await organize(async () => {
      const folder = await folderResponse(await fetch("/api/pdf/folders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, parentId }) }));
      if (!mounted.current) return;
      setFolders((previous) => [...previous, folder].sort((a, b) => pdfFolderNameKey(a.name).localeCompare(pdfFolderNameKey(b.name), "en-US")));
      selectShelf(folder.id); setNotice(`“${folder.name}” was created.`);
    });
  }

  async function updateFolder(id: string, changes: { name?: string; parentId?: string | null }) {
    await organize(async () => {
      const folder = await folderResponse(await fetch(`/api/pdf/folders/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes) }));
      if (!mounted.current) return;
      setFolders((previous) => previous.map((entry) => entry.id === id ? folder : entry).sort((a, b) => pdfFolderNameKey(a.name).localeCompare(pdfFolderNameKey(b.name), "en-US")));
      setNotice(`“${folder.name}” was ${"name" in changes ? "renamed" : "moved"}.`);
    });
  }

  async function deleteFolder(id: string) {
    await organize(async () => {
      const response = await fetch(`/api/pdf/folders/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok && response.status !== 404) throw new Error(errorMessage(await response.json(), "The folder could not be deleted. Please retry."));
      if (!mounted.current) return;
      setFolders((previous) => previous.filter((folder) => folder.id !== id));
      if (importDestination === id && !importDestinationLocked) setImportDestination(null);
      setSelectedFolder("all"); setNotice("The empty folder was deleted.");
    });
  }

  async function moveDocument(document: PdfDocumentSummary) {
    setMoveError("");
    try {
      await organize(async () => {
        const response = await fetch(`/api/pdf/documents/${encodeURIComponent(document.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folderId: moveDestination }) });
        const data: unknown = await response.json();
        if (!response.ok) throw new Error(errorMessage(data, "The PDF could not be moved. Please retry."));
        if (!data || typeof data !== "object" || !("document" in data) || !isSummary(data.document)) throw new Error("The app returned an unexpected PDF response. Reload the library.");
        const moved = data.document;
        if (!mounted.current) return;
        setDocuments((previous) => previous.map((entry) => entry.id === moved.id ? moved : entry));
        setMoveTarget(null); setNotice(`“${document.title}” was moved.`);
      });
    } catch (failure) { if (mounted.current) setMoveError(failure instanceof Error ? failure.message : "The PDF could not be moved."); }
  }

  async function deleteDocument(document: PdfDocumentSummary) {
    if (deleteBusy.current || importBusy.current) return;
    deleteBusy.current = true;
    setDeleting(document.id); setDeleteError(""); setNotice("");
    listRequest.current?.abort();
    try {
      const response = await fetch(`/api/pdf/documents/${encodeURIComponent(document.id)}`, { method: "DELETE" });
      if (!response.ok && response.status !== 404) {
        let data: unknown;
        try { data = await response.json(); } catch { /* Use the actionable fallback. */ }
        throw new Error(errorMessage(data, "The PDF could not be deleted. Please retry."));
      }
      if (!mounted.current) return;
      setDocuments((previous) => previous.filter((item) => item.id !== document.id));
      setDeleteTarget(null);
      setNotice(`“${document.title}” was deleted. Notes created from this PDF are unchanged.`);
    } catch (failure) {
      if (mounted.current) setDeleteError(failure instanceof Error ? failure.message : "The PDF could not be deleted.");
    } finally { deleteBusy.current = false; if (mounted.current) setDeleting(null); }
  }

  const query = search.trim().toLocaleLowerCase();
  const documentHref = (document: PdfDocumentSummary) => `/pdf-reader?id=${encodeURIComponent(document.id)}&owner=${encodeURIComponent(pdfExcerptOwnerId())}`;
  const folderEntries = pdfFolderEntries(folders);
  const selectedEntry = folderEntries.find((entry) => entry.folder.id === selectedFolder);
  const folderPath = (id: string | null) => folderEntries.find((entry) => entry.folder.id === id)?.path ?? "Unfiled";
  const scoped = documents.filter((document) => selectedFolder === "all" || document.folderId === selectedFolder);
  const shown = scoped.filter((document) => !query || `${document.title}\n${document.fileName}`.toLocaleLowerCase().includes(query));
  const busy = loading || uploading || Boolean(deleting) || organizing;
  const pendingCount = batch.filter((item) => item.status === "pending" || item.status === "failed").length;
  const readyToImport = importMode === "single" ? Boolean(selectedFile && !pdfImportError(selectedFile)) : pendingCount > 0;

  return <>
    <button className="babel-pdf-library-button" type="button" onClick={openLibrary} title={`Open ${appName} PDF library`}><LibraryIcon /><span>PDFs</span></button>
    <dialog ref={dialogRef} className="babel-pdf-library babel-pdf-theme" data-pdf-app={appId} aria-label={`${appName} PDF library`}
      onCancel={(event) => { if (event.target === event.currentTarget) { event.preventDefault(); closeLibrary(); } }}>
      <header className="babel-pdf-library-header">
        <div className="babel-pdf-library-heading"><span className="babel-pdf-library-mark"><LibraryIcon /></span><div><p>{appName} / READING ROOM</p><h2>PDF library</h2></div></div>
        <button className="babel-pdf-library-close" type="button" onClick={closeLibrary} aria-label="Close PDF library">×</button>
      </header>
      <div className="babel-pdf-library-body">
        <aside className="babel-pdf-library-import">
          <PdfFolders folders={folders} documents={documents} selected={selectedFolder} onSelect={selectShelf} disabled={busy}
            onCreate={createFolder} onUpdate={updateFolder} onDelete={deleteFolder} />
          <div className="babel-pdf-library-import-intro"><h3 className="babel-pdf-library-import-heading">Add to your shelf</h3><p>Import sources into {appName}.</p></div>
          <form onSubmit={importPdf}>
            <div className="babel-pdf-folders__destination"><span>Import into</span><PdfFolderPicker folders={folders} value={importDestination} onChange={setImportDestination} label="Import destination" disabled={busy || importDestinationLocked} />
              {importDestinationLocked && <p className="babel-pdf-folders__hint">This destination is kept for retries. Choose files again to change it.</p>}</div>
            <div className="babel-pdf-library-import-mode" role="group" aria-label="PDF import mode">
              <button type="button" aria-pressed={importMode === "single"} disabled={busy} onClick={() => chooseImportMode("single")}>Single PDF</button>
              <button type="button" aria-pressed={importMode === "folder"} disabled={busy} onClick={() => chooseImportMode("folder")}>Folder batch</button>
            </div>
            {importMode === "single" ? <>
              <label className="babel-pdf-library-file-label" htmlFor={`babel-pdf-file-${appId}`}>Choose a PDF <span>Up to 512 MiB</span></label>
              <input ref={inputRef} id={`babel-pdf-file-${appId}`} type="file" accept=".pdf,application/pdf" hidden tabIndex={-1} disabled={busy} onChange={(event) => selectFile(event.currentTarget.files?.[0])} />
              <div className="babel-pdf-library-file-picker">
                <button className="babel-pdf-library-choose-file" type="button" disabled={busy} onClick={() => inputRef.current?.click()}>Choose file</button>
                <span className="babel-pdf-library-file-status" role="status">{selectedFile ? "PDF selected" : "No file selected"}</span>
              </div>
              {selectedFile && <p className="babel-pdf-library-selected" title={selectedFile.name}>{selectedFile.name}<span>{fileSize(selectedFile.size)}</span></p>}
              <label className="babel-pdf-library-field-label" htmlFor={`babel-pdf-title-${appId}`}>Book title</label>
              <input id={`babel-pdf-title-${appId}`} className="babel-pdf-library-title-input" type="text" value={title} maxLength={240} placeholder="Title on your shelf" disabled={busy} onChange={(event) => setTitle(event.currentTarget.value)} />
            </> : <>
              <p className="babel-pdf-library-file-label">Choose a folder <span>512 MiB per PDF</span></p>
              <input ref={(node) => { folderInputRef.current = node; node?.setAttribute("webkitdirectory", ""); node?.setAttribute("directory", ""); }} type="file" hidden tabIndex={-1} multiple disabled={busy} onChange={(event) => selectFolder(event.currentTarget.files)} />
              <button className="babel-pdf-library-choose-file" type="button" disabled={busy} onClick={() => folderInputRef.current?.click()}>Choose folder</button>
              <p className="babel-pdf-library-batch-summary" role="status">{folder ? `${folder} · ${batch.length} ${batch.length === 1 ? "PDF" : "PDFs"}${skipped ? ` · ${skipped} other ${skipped === 1 ? "file" : "files"} skipped` : ""}. Folder structure will be preserved.` : "Keeps the selected folder and its subfolders. Other files are skipped. Each PDF uses its filename as the book title."}</p>
              {batch.length > 0 && <ul className="babel-pdf-library-batch-results" aria-label="Folder import results">{batch.map((item, index) => <li key={index} className={`babel-pdf-library-batch-result${item.status === "failed" || item.status === "invalid" ? " is-error" : ""}`}><span className="babel-pdf-library-batch-label" title={item.label}>{item.label}</span><span className="babel-pdf-library-batch-status">{item.error || ({ pending: "Ready", importing: "Importing…", imported: "Imported", failed: "Failed", invalid: "Invalid file" } as const)[item.status]}</span></li>)}</ul>}
            </>}
            {uploadError && <p className="babel-pdf-library-error" role="alert">{uploadError}</p>}
            {uploading && <div className="babel-pdf-library-upload-progress" aria-live="polite"><progress aria-label="PDF import progress" max={100} value={percent ?? undefined} /><span>{percent === null ? "Importing…" : `Importing… ${percent}%`}</span><span>{importLabel}</span></div>}
            <button className="babel-pdf-library-primary" type="submit" disabled={!readyToImport || busy}>{uploading ? "Importing…" : importMode === "single" ? "Import PDF" : batch.some((item) => item.status === "failed") ? "Retry remaining PDFs" : "Import PDFs"}<span aria-hidden="true">↗</span></button>
            {uploading && <button className="babel-pdf-library-text-button" type="button" disabled={canceling} onClick={cancelImport}>{canceling ? "Finishing current PDF…" : "Cancel import"}</button>}
          </form>
          <p className="babel-pdf-library-local-note">Originals, reading progress and annotations stay in this app’s private data. Scanned PDFs can be read and clipped; text recognition will come later.</p>
        </aside>
        <section className="babel-pdf-library-shelf" aria-label="Imported PDFs">
          <div className="babel-pdf-library-toolbar"><div><h3>{selectedFolder === "all" ? "All PDFs" : selectedFolder === null ? "Unfiled" : selectedEntry?.folder.name ?? "Your shelf"}</h3><span>{scoped.length} {scoped.length === 1 ? "document" : "documents"}</span></div><button className="babel-pdf-library-reload" type="button" onClick={() => void reload()} disabled={busy}>{loading ? "Loading…" : "Reload"}</button></div>
          <p className="babel-pdf-folders__breadcrumb">{selectedFolder === "all" ? `${appName} / All PDFs` : `${appName} / ${folderPath(selectedFolder)}`}</p>
          {selectedEntry && selectedEntry.children.length > 0 && <div className="babel-pdf-folders__children" aria-label="Subfolders">{selectedEntry.children.map((entry) => <button type="button" className="babel-pdf-library-reload" disabled={busy} key={entry.folder.id} onClick={() => selectShelf(entry.folder.id)}>↳ {entry.folder.name}</button>)}</div>}
          <label className="babel-pdf-library-search"><span className="babel-pdf-library-sr-only">Search this app’s PDFs</span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" stroke="currentColor" strokeWidth="1.7"/><path d="m15 15 5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg><input type="search" placeholder="Search titles or filenames" value={search} onChange={(event) => setSearch(event.currentTarget.value)} /></label>
          {listError && <div className="babel-pdf-library-list-error" role="alert"><p>{listError}</p><button className="babel-pdf-library-text-button" type="button" onClick={() => void reload()} disabled={loading}>Retry loading</button></div>}
          {notice && <p className="babel-pdf-library-notice" role="status">{notice}</p>}
          <div className="babel-pdf-library-documents" aria-busy={loading} tabIndex={0} role="region" aria-label="PDF shelf">
            {loading && documents.length === 0 ? <div className="babel-pdf-library-empty" role="status"><LibraryIcon /><h4>Loading your shelf…</h4><p>Retrieving PDFs from {appName}.</p></div>
              : shown.length === 0 ? <div className="babel-pdf-library-empty"><LibraryIcon /><h4>{query ? "No matching PDFs" : listError ? "Your shelf is unavailable" : selectedFolder === "all" ? "Your reading starts here" : "No PDFs in this folder"}</h4><p>{query ? "Try another title or filename." : listError ? "Retry loading your library when the app is available." : "Import a PDF here, move one from All PDFs, or open a subfolder."}</p></div>
                : <ul>{shown.map((document) => <li className="babel-pdf-library-document" key={document.id}>
                  <div className="babel-pdf-library-document-cover" aria-hidden="true"><LibraryIcon /><span>PDF</span></div>
                  <div className="babel-pdf-library-document-details"><h4 title={document.title}>{document.title}</h4><p className="babel-pdf-library-document-filename" title={document.fileName}>{document.fileName}</p><button className="babel-pdf-folders__document-path" type="button" disabled={busy} title={folderPath(document.folderId)} onClick={() => selectShelf(document.folderId)}>{folderPath(document.folderId)}</button><p className="babel-pdf-library-document-meta"><span>{fileSize(document.size)}</span><span>Page {document.progress.page}</span><span>Added {importDate(document.importedAt)}</span></p></div>
                  {deleteTarget === document.id ? <div ref={deleteConfirmRef} className="babel-pdf-library-delete-confirm" role="group" aria-label={`Confirm deletion: ${document.title}`}>
                    <p>Delete this PDF, its reading progress and annotations? This cannot be undone. Notes created from it will stay.</p>
                    {deleteError && <p className="babel-pdf-library-error" role="alert">{deleteError}</p>}
                    <div><button type="button" disabled={Boolean(deleting)} onClick={() => { setDeleteTarget(null); setDeleteError(""); }}>Cancel</button><button className="babel-pdf-library-delete" type="button" disabled={Boolean(deleting)} onClick={() => void deleteDocument(document)}>{deleting === document.id ? "Deleting…" : "Delete PDF"}</button></div>
                  </div> : <div className="babel-pdf-library-document-actions">
                    <a className="babel-pdf-library-open" href={documentHref(document)} target={`babel-pdf-${appId}-${document.id}`} aria-disabled={busy} onClick={(event) => { event.preventDefault(); if (!busy) openDocument(document); }} aria-label={`Open PDF: ${document.title}`}>Open PDF <span aria-hidden="true">↗</span></a>
                    <button className="babel-pdf-library-reload" type="button" disabled={busy} aria-label={`Move PDF: ${document.title}`} onClick={() => { setMoveTarget(document.id); setMoveDestination(document.folderId); setMoveError(""); }}>Move</button>
                    <button className="babel-pdf-library-delete" type="button" disabled={busy} aria-label={`Delete PDF: ${document.title}`} onClick={() => { setDeleteTarget(document.id); setMoveTarget(null); setDeleteError(""); }}>Delete</button>
                  </div>}
                  {moveTarget === document.id && <div ref={movePanelRef} className="babel-pdf-folders__move-panel" role="group" aria-label={`Move PDF: ${document.title}`}>
                    <PdfFolderPicker folders={folders} value={moveDestination} onChange={setMoveDestination} label="Move PDF to" disabled={busy} />
                    {moveError && <p className="babel-pdf-folders__error" role="alert">{moveError}</p>}
                    <div><button type="button" disabled={busy} onClick={() => setMoveTarget(null)}>Cancel</button><button type="button" disabled={busy || moveDestination === document.folderId} onClick={() => void moveDocument(document)}>{organizing ? "Moving…" : "Move PDF"}</button></div>
                  </div>}
                </li>)}</ul>}
          </div>
          <footer className="babel-pdf-library-footer">Read on another screen. Send selections back to a new note or your current draft.</footer>
        </section>
      </div>
    </dialog>
  </>;
}
