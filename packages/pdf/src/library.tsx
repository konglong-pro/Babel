"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { usePathname, useRouter } from "next/navigation";

import { PDF_MAX_FILE_BYTES, isPdfProgress, type PdfDocumentSummary } from "@babel-apps/platform/pdf/core";
import { openSearchWindow } from "@babel-apps/platform/search/window";

import { pdfExcerptOwnerId, preparePdfExcerptOwner } from "./excerpts";

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
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "Unknown date";
}

export function PdfLibraryButton({ appId, appName, notebookHref }: PdfLibraryButtonProps) {
  const router = useRouter();
  const pathname = usePathname();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRequest = useRef<AbortController | null>(null);
  const uploadRequest = useRef<XMLHttpRequest | null>(null);
  const [documents, setDocuments] = useState<PdfDocumentSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const [percent, setPercent] = useState<number | null>(null);

  useEffect(() => preparePdfExcerptOwner(() => {
    if (pathname !== notebookHref && !pathname.startsWith(`${notebookHref}/`)) router.push(notebookHref);
  }), [notebookHref, pathname, router]);

  useEffect(() => () => {
    listRequest.current?.abort();
    if (uploadRequest.current) {
      uploadRequest.current.onload = null;
      uploadRequest.current.onerror = null;
      uploadRequest.current.onabort = null;
      uploadRequest.current.abort();
    }
  }, []);

  const reload = useCallback(async () => {
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
    uploadRequest.current?.abort();
    dialogRef.current?.close();
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
    setSelectedFile(file ?? null);
    setUploadError("");
    setNotice("");
    setPercent(null);
    setTitle(file?.name.replace(/\.pdf$/iu, "").slice(0, 240) ?? "");
    if (file && file.size === 0) setUploadError("Choose a nonempty PDF file.");
    else if (file && file.size > PDF_MAX_FILE_BYTES) setUploadError("PDF files must not exceed 512 MiB.");
  }

  function importPdf(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFile || uploading) return;
    setNotice("");
    if (selectedFile.size === 0 || selectedFile.size > PDF_MAX_FILE_BYTES) {
      setUploadError("Choose a nonempty PDF file no larger than 512 MiB.");
      return;
    }
    if (!title.trim() || title.trim().length > 240) { setUploadError("Enter a book title from 1 to 240 characters."); return; }
    const body = new FormData();
    body.set("file", selectedFile);
    body.set("title", title.trim());
    const request = new XMLHttpRequest();
    uploadRequest.current = request;
    setUploading(true);
    setUploadError("");
    setPercent(0);
    const finish = () => {
      if (uploadRequest.current === request) uploadRequest.current = null;
      setUploading(false);
      setPercent(null);
    };
    request.upload.onprogress = (progress) => {
      setPercent(progress.lengthComputable && progress.total > 0 ? Math.min(99, Math.round(progress.loaded / progress.total * 100)) : null);
    };
    request.onload = () => {
      finish();
      let data: unknown;
      try { data = JSON.parse(request.responseText); } catch { /* Report the response below without clearing the selected file. */ }
      if (request.status < 200 || request.status >= 300) {
        setUploadError(errorMessage(data, "The PDF could not be imported. Your selected file is ready to retry."));
        return;
      }
      const document = data && typeof data === "object" && "document" in data ? data.document : undefined;
      if (!isSummary(document)) { setUploadError("The server returned an unexpected response. Reload the library before trying again."); return; }
      // Cancel an older list request so it cannot replace the newly imported book.
      listRequest.current?.abort();
      setDocuments((previous) => [document, ...previous.filter((item) => item.id !== document.id)]);
      setListError("");
      setSelectedFile(null);
      if (inputRef.current) inputRef.current.value = "";
      setTitle("");
      setSearch("");
      setNotice(`“${document.title}” was added. Select Open PDF to read it in a separate window.`);
    };
    request.onerror = () => { finish(); setUploadError("The app could not be reached. Your selected file is ready to retry."); };
    request.onabort = () => { finish(); setUploadError("Import canceled. Your selected file is ready to retry."); };
    request.open("POST", "/api/pdf/documents");
    request.send(body);
  }

  const query = search.trim().toLocaleLowerCase();
  const documentHref = (document: PdfDocumentSummary) => `/pdf-reader?id=${encodeURIComponent(document.id)}&owner=${encodeURIComponent(pdfExcerptOwnerId())}`;
  const shown = documents.filter((document) => !query || `${document.title}\n${document.fileName}`.toLocaleLowerCase().includes(query));

  return <>
    <button className="babel-pdf-library-button" type="button" onClick={openLibrary} title={`Open ${appName} PDF library`}><LibraryIcon /><span>PDFs</span></button>
    <dialog ref={dialogRef} className="babel-pdf-library" aria-label={`${appName} PDF library`}
      onCancel={(event) => { event.preventDefault(); closeLibrary(); }}>
      <header className="babel-pdf-library-header">
        <div className="babel-pdf-library-heading"><span className="babel-pdf-library-mark"><LibraryIcon /></span><div><p>{appName} / READING ROOM</p><h2>PDF library</h2></div></div>
        <button className="babel-pdf-library-close" type="button" onClick={closeLibrary} aria-label="Close PDF library">×</button>
      </header>
      <div className="babel-pdf-library-body">
        <aside className="babel-pdf-library-import">
          <div className="babel-pdf-library-import-intro"><span className="babel-pdf-library-eyebrow">ADD TO YOUR SHELF</span><h3>A place for your sources.</h3><p>Keep textbooks, papers and scanned pages together in {appName}.</p></div>
          <form onSubmit={importPdf}>
            <label className="babel-pdf-library-file-label" htmlFor={`babel-pdf-file-${appId}`}>Choose a PDF <span>Up to 512 MiB</span></label>
            <input ref={inputRef} id={`babel-pdf-file-${appId}`} type="file" accept=".pdf,application/pdf" disabled={uploading} onChange={(event) => selectFile(event.currentTarget.files?.[0])} />
            {selectedFile && <p className="babel-pdf-library-selected" title={selectedFile.name}>{selectedFile.name}<span>{fileSize(selectedFile.size)}</span></p>}
            <label className="babel-pdf-library-field-label" htmlFor={`babel-pdf-title-${appId}`}>Book title</label>
            <input id={`babel-pdf-title-${appId}`} className="babel-pdf-library-title-input" type="text" value={title} maxLength={240} placeholder="Title on your shelf" disabled={uploading} onChange={(event) => setTitle(event.currentTarget.value)} />
            {uploadError && <p className="babel-pdf-library-error" role="alert">{uploadError}</p>}
            {uploading && <div className="babel-pdf-library-upload-progress" aria-live="polite"><progress aria-label="PDF import progress" max={100} value={percent ?? undefined} /><span>{percent === null ? "Importing…" : percent >= 99 ? "Saving original…" : `Importing… ${percent}%`}</span></div>}
            <button className="babel-pdf-library-primary" type="submit" disabled={!selectedFile || uploading}>{uploading ? "Importing…" : "Import PDF"}<span aria-hidden="true">↗</span></button>
            {uploading && <button className="babel-pdf-library-text-button" type="button" onClick={() => uploadRequest.current?.abort()}>Cancel import</button>}
          </form>
          <p className="babel-pdf-library-local-note">Originals, reading progress and annotations stay in this app’s private data. Scanned PDFs can be read and clipped; text recognition will come later.</p>
        </aside>
        <section className="babel-pdf-library-shelf" aria-label="Imported PDFs">
          <div className="babel-pdf-library-toolbar"><div><h3>Your shelf</h3><span>{documents.length} {documents.length === 1 ? "document" : "documents"}</span></div><button className="babel-pdf-library-reload" type="button" onClick={() => void reload()} disabled={loading || uploading}>{loading ? "Loading…" : "Reload"}</button></div>
          <label className="babel-pdf-library-search"><span className="babel-pdf-library-sr-only">Search this app’s PDFs</span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" stroke="currentColor" strokeWidth="1.7"/><path d="m15 15 5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg><input type="search" placeholder="Search titles or filenames" value={search} onChange={(event) => setSearch(event.currentTarget.value)} /></label>
          {listError && <div className="babel-pdf-library-list-error" role="alert"><p>{listError}</p><button className="babel-pdf-library-text-button" type="button" onClick={() => void reload()} disabled={loading}>Retry loading</button></div>}
          {notice && <p className="babel-pdf-library-notice" role="status">{notice}</p>}
          <div className="babel-pdf-library-documents" aria-busy={loading}>
            {loading && documents.length === 0 ? <div className="babel-pdf-library-empty" role="status"><LibraryIcon /><h4>Loading your shelf…</h4><p>Retrieving PDFs from {appName}.</p></div>
              : shown.length === 0 ? <div className="babel-pdf-library-empty"><LibraryIcon /><h4>{query ? "No matching PDFs" : listError ? "Your shelf is unavailable" : "Your reading starts here"}</h4><p>{query ? "Try another title or filename." : listError ? "Retry loading your library when the app is available." : "Import a PDF to open it in its own reading window."}</p></div>
                : <ul>{shown.map((document) => <li className="babel-pdf-library-document" key={document.id}>
                  <div className="babel-pdf-library-document-cover" aria-hidden="true"><LibraryIcon /><span>PDF</span></div>
                  <div className="babel-pdf-library-document-details"><h4 title={document.title}>{document.title}</h4><p className="babel-pdf-library-document-filename" title={document.fileName}>{document.fileName}</p><p className="babel-pdf-library-document-meta"><span>{fileSize(document.size)}</span><span>Page {document.progress.page}</span><span>Added {importDate(document.importedAt)}</span></p></div>
                  <a className="babel-pdf-library-open" href={documentHref(document)} target={`babel-pdf-${appId}-${document.id}`} aria-disabled={uploading} onClick={(event) => { event.preventDefault(); if (!uploading) openDocument(document); }} aria-label={`Open PDF: ${document.title}`}>Open PDF <span aria-hidden="true">↗</span></a>
                </li>)}</ul>}
          </div>
          <footer className="babel-pdf-library-footer">Read on another screen. Send selections back to a new note or your current draft.</footer>
        </section>
      </div>
    </dialog>
  </>;
}
