"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { usePathname, useRouter } from "next/navigation";

import { isPdfProgress, type PdfDocumentSummary } from "@babel-apps/platform/pdf/core";
import { openSearchWindow } from "@babel-apps/platform/search/window";

import { pdfExcerptOwnerId, preparePdfExcerptOwner } from "./excerpts";
import { pdfImportError, preparePdfFolder, type FolderPdf } from "./imports";

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
    typeof document.title === "string" && typeof document.fileName === "string" &&
    typeof document.size === "number" && Number.isFinite(document.size) && document.size > 0 &&
    typeof document.importedAt === "string" && typeof document.updatedAt === "string" && isPdfProgress(document.progress);
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
  const selectedImportId = useRef("");
  const mounted = useRef(true);
  const [documents, setDocuments] = useState<PdfDocumentSummary[]>([]);
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
      const data: unknown = await response.json();
      if (!response.ok) throw new Error(errorMessage(data, "The PDF library could not be loaded. Please retry."));
      if (!data || typeof data !== "object" || !("documents" in data) || !Array.isArray(data.documents) || !data.documents.every(isSummary)) {
        throw new Error("The app returned an unexpected PDF library response. Please retry.");
      }
      if (!request.signal.aborted) setDocuments(data.documents);
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
    selectedImportId.current = crypto.randomUUID();
    setSelectedFile(file ?? null);
    setUploadError("");
    setNotice("");
    setPercent(null);
    setTitle(file?.name.replace(/\.pdf$/iu, "").slice(0, 240) ?? "");
    if (file) setUploadError(pdfImportError(file));
  }

  function selectFolder(files: FileList | null) {
    const selection = preparePdfFolder(Array.from(files ?? []));
    setFolder(selection.folder);
    setSkipped(selection.skipped);
    setBatch(selection.files.map((file) => ({ ...file, importId: crypto.randomUUID(), status: file.error ? "invalid" : "pending" })));
    setUploadError(selection.files.length ? "" : "No PDF files were found in this folder. Choose another folder.");
    setNotice("");
    setPercent(null);
    if (folderInputRef.current) folderInputRef.current.value = "";
  }

  function uploadPdf(file: File, bookTitle: string, importId: string, onProgress: (percent: number | null) => void): Promise<PdfDocumentSummary> {
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
      request.send(body);
    });
  }

  async function importPdf(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (importBusy.current || deleting) return;
    if (importMode === "single") {
      if (!selectedFile) return;
      const invalid = pdfImportError(selectedFile);
      if (invalid) { setUploadError(invalid); return; }
      if (!title.trim() || title.trim().length > 240) { setUploadError("Enter a book title from 1 to 240 characters."); return; }
    }
    const queue = importMode === "folder"
      ? batch.map((item, index) => ({ ...item, index })).filter((item) => item.status === "pending" || item.status === "failed")
      : [{ file: selectedFile!, title: title.trim(), label: selectedFile!.name, importId: selectedImportId.current || (selectedImportId.current = crypto.randomUUID()), index: -1 }];
    if (!queue.length) return;
    importBusy.current = true;
    canceled.current = false;
    setCanceling(false);
    listRequest.current?.abort();
    setUploading(true); setUploadError(""); setNotice(""); setListError(""); setSearch("");
    let imported = 0;
    let failed = 0;
    const update = (index: number, changes: Partial<ImportItem>) => {
      if (mounted.current && index >= 0) setBatch((previous) => previous.map((item, current) => current === index ? { ...item, ...changes } : item));
    };
    try {
      for (const [position, item] of queue.entries()) {
        if (canceled.current || !mounted.current) break;
        update(item.index, { status: "importing", error: "" });
        setImportLabel(queue.length > 1 ? `${position + 1} of ${queue.length} · ${item.file.name}` : item.file.name);
        setPercent(Math.round(position / queue.length * 100));
        try {
          const document = await uploadPdf(item.file, item.title, item.importId, (value) => {
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
    } finally {
      importBusy.current = false;
      if (mounted.current) { setUploading(false); setCanceling(false); setPercent(null); setImportLabel(""); }
    }
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
  const shown = documents.filter((document) => !query || `${document.title}\n${document.fileName}`.toLocaleLowerCase().includes(query));
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
          <div className="babel-pdf-library-import-intro"><span className="babel-pdf-library-eyebrow">ADD TO YOUR SHELF</span><h3>A place for your sources.</h3><p>Keep textbooks, papers and scanned pages together in {appName}.</p></div>
          <form onSubmit={importPdf}>
            <div className="babel-pdf-library-import-mode" role="group" aria-label="PDF import mode">
              <button type="button" aria-pressed={importMode === "single"} disabled={uploading || Boolean(deleting)} onClick={() => { setImportMode("single"); setUploadError(""); }}>Single PDF</button>
              <button type="button" aria-pressed={importMode === "folder"} disabled={uploading || Boolean(deleting)} onClick={() => { setImportMode("folder"); setUploadError(""); }}>Folder batch</button>
            </div>
            {importMode === "single" ? <>
              <label className="babel-pdf-library-file-label" htmlFor={`babel-pdf-file-${appId}`}>Choose a PDF <span>Up to 512 MiB</span></label>
              <input ref={inputRef} id={`babel-pdf-file-${appId}`} type="file" accept=".pdf,application/pdf" hidden tabIndex={-1} disabled={uploading || Boolean(deleting)} onChange={(event) => selectFile(event.currentTarget.files?.[0])} />
              <div className="babel-pdf-library-file-picker">
                <button className="babel-pdf-library-choose-file" type="button" disabled={uploading || Boolean(deleting)} onClick={() => inputRef.current?.click()}>Choose file</button>
                <span className="babel-pdf-library-file-status" role="status">{selectedFile ? "PDF selected" : "No file selected"}</span>
              </div>
              {selectedFile && <p className="babel-pdf-library-selected" title={selectedFile.name}>{selectedFile.name}<span>{fileSize(selectedFile.size)}</span></p>}
              <label className="babel-pdf-library-field-label" htmlFor={`babel-pdf-title-${appId}`}>Book title</label>
              <input id={`babel-pdf-title-${appId}`} className="babel-pdf-library-title-input" type="text" value={title} maxLength={240} placeholder="Title on your shelf" disabled={uploading || Boolean(deleting)} onChange={(event) => setTitle(event.currentTarget.value)} />
            </> : <>
              <p className="babel-pdf-library-file-label">Choose a folder <span>512 MiB per PDF</span></p>
              <input ref={(node) => { folderInputRef.current = node; node?.setAttribute("webkitdirectory", ""); node?.setAttribute("directory", ""); }} type="file" hidden tabIndex={-1} multiple disabled={uploading || Boolean(deleting)} onChange={(event) => selectFolder(event.currentTarget.files)} />
              <button className="babel-pdf-library-choose-file" type="button" disabled={uploading || Boolean(deleting)} onClick={() => folderInputRef.current?.click()}>Choose folder</button>
              <p className="babel-pdf-library-batch-summary" role="status">{folder ? `${folder} · ${batch.length} ${batch.length === 1 ? "PDF" : "PDFs"}${skipped ? ` · ${skipped} other ${skipped === 1 ? "file" : "files"} skipped` : ""}` : "Includes PDFs in subfolders. Other files are skipped. Each PDF uses its filename as the book title."}</p>
              {batch.length > 0 && <ul className="babel-pdf-library-batch-results" aria-label="Folder import results">{batch.map((item, index) => <li key={index} className={`babel-pdf-library-batch-result${item.status === "failed" || item.status === "invalid" ? " is-error" : ""}`}><span className="babel-pdf-library-batch-label" title={item.label}>{item.label}</span><span className="babel-pdf-library-batch-status">{item.error || ({ pending: "Ready", importing: "Importing…", imported: "Imported", failed: "Failed", invalid: "Invalid file" } as const)[item.status]}</span></li>)}</ul>}
            </>}
            {uploadError && <p className="babel-pdf-library-error" role="alert">{uploadError}</p>}
            {uploading && <div className="babel-pdf-library-upload-progress" aria-live="polite"><progress aria-label="PDF import progress" max={100} value={percent ?? undefined} /><span>{percent === null ? "Importing…" : `Importing… ${percent}%`}</span><span>{importLabel}</span></div>}
            <button className="babel-pdf-library-primary" type="submit" disabled={!readyToImport || uploading || Boolean(deleting)}>{uploading ? "Importing…" : importMode === "single" ? "Import PDF" : batch.some((item) => item.status === "failed") ? "Retry remaining PDFs" : "Import PDFs"}<span aria-hidden="true">↗</span></button>
            {uploading && <button className="babel-pdf-library-text-button" type="button" disabled={canceling} onClick={cancelImport}>{canceling ? "Finishing current PDF…" : "Cancel import"}</button>}
          </form>
          <p className="babel-pdf-library-local-note">Originals, reading progress and annotations stay in this app’s private data. Scanned PDFs can be read and clipped; text recognition will come later.</p>
        </aside>
        <section className="babel-pdf-library-shelf" aria-label="Imported PDFs">
          <div className="babel-pdf-library-toolbar"><div><h3>Your shelf</h3><span>{documents.length} {documents.length === 1 ? "document" : "documents"}</span></div><button className="babel-pdf-library-reload" type="button" onClick={() => void reload()} disabled={loading || uploading || Boolean(deleting)}>{loading ? "Loading…" : "Reload"}</button></div>
          <label className="babel-pdf-library-search"><span className="babel-pdf-library-sr-only">Search this app’s PDFs</span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" stroke="currentColor" strokeWidth="1.7"/><path d="m15 15 5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg><input type="search" placeholder="Search titles or filenames" value={search} onChange={(event) => setSearch(event.currentTarget.value)} /></label>
          {listError && <div className="babel-pdf-library-list-error" role="alert"><p>{listError}</p><button className="babel-pdf-library-text-button" type="button" onClick={() => void reload()} disabled={loading}>Retry loading</button></div>}
          {notice && <p className="babel-pdf-library-notice" role="status">{notice}</p>}
          <div className="babel-pdf-library-documents" aria-busy={loading} tabIndex={0} role="region" aria-label="PDF shelf">
            {loading && documents.length === 0 ? <div className="babel-pdf-library-empty" role="status"><LibraryIcon /><h4>Loading your shelf…</h4><p>Retrieving PDFs from {appName}.</p></div>
              : shown.length === 0 ? <div className="babel-pdf-library-empty"><LibraryIcon /><h4>{query ? "No matching PDFs" : listError ? "Your shelf is unavailable" : "Your reading starts here"}</h4><p>{query ? "Try another title or filename." : listError ? "Retry loading your library when the app is available." : "Import a PDF to open it in its own reading window."}</p></div>
                : <ul>{shown.map((document) => <li className="babel-pdf-library-document" key={document.id}>
                  <div className="babel-pdf-library-document-cover" aria-hidden="true"><LibraryIcon /><span>PDF</span></div>
                  <div className="babel-pdf-library-document-details"><h4 title={document.title}>{document.title}</h4><p className="babel-pdf-library-document-filename" title={document.fileName}>{document.fileName}</p><p className="babel-pdf-library-document-meta"><span>{fileSize(document.size)}</span><span>Page {document.progress.page}</span><span>Added {importDate(document.importedAt)}</span></p></div>
                  {deleteTarget === document.id ? <div ref={deleteConfirmRef} className="babel-pdf-library-delete-confirm" role="group" aria-label={`Confirm deletion: ${document.title}`}>
                    <p>Delete this PDF, its reading progress and annotations? This cannot be undone. Notes created from it will stay.</p>
                    {deleteError && <p className="babel-pdf-library-error" role="alert">{deleteError}</p>}
                    <div><button type="button" disabled={Boolean(deleting)} onClick={() => { setDeleteTarget(null); setDeleteError(""); }}>Cancel</button><button className="babel-pdf-library-delete" type="button" disabled={Boolean(deleting)} onClick={() => void deleteDocument(document)}>{deleting === document.id ? "Deleting…" : "Delete PDF"}</button></div>
                  </div> : <div className="babel-pdf-library-document-actions">
                    <a className="babel-pdf-library-open" href={documentHref(document)} target={`babel-pdf-${appId}-${document.id}`} aria-disabled={uploading || Boolean(deleting)} onClick={(event) => { event.preventDefault(); if (!uploading && !deleting) openDocument(document); }} aria-label={`Open PDF: ${document.title}`}>Open PDF <span aria-hidden="true">↗</span></a>
                    <button className="babel-pdf-library-delete" type="button" disabled={uploading || Boolean(deleting)} aria-label={`Delete PDF: ${document.title}`} onClick={() => { setDeleteTarget(document.id); setDeleteError(""); }}>Delete</button>
                  </div>}
                </li>)}</ul>}
          </div>
          <footer className="babel-pdf-library-footer">Read on another screen. Send selections back to a new note or your current draft.</footer>
        </section>
      </div>
    </dialog>
  </>;
}
