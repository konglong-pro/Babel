"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  DOCUMENT_IMPORT_ACCEPT,
  type DocumentConversionResult,
  type ImportedOriginalDocument,
} from "./document-core";
import {
  convertDocumentFile,
  prepareDocumentImportDraft,
} from "./document-client";

export interface DocumentImportActionProps {
  onImport: (file: File, original?: ImportedOriginalDocument) => Promise<void> | void;
  disabled?: boolean;
  label?: string;
  onOpen?: () => void;
  registerOpen?: (open: (() => void) | null) => void;
}

export function DocumentImportAction({
  onImport,
  disabled = false,
  label = "Import document as Markdown",
  onOpen,
  registerOpen,
}: DocumentImportActionProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const open = useCallback(() => {
    if (disabled || file !== null) return;
    onOpen?.();
    inputRef.current?.click();
  }, [disabled, file, onOpen]);

  useEffect(() => {
    registerOpen?.(disabled || file !== null ? null : open);
    return () => registerOpen?.(null);
  }, [disabled, file, open, registerOpen]);

  return <>
    <input ref={inputRef} type="file" accept={DOCUMENT_IMPORT_ACCEPT} hidden tabIndex={-1}
      disabled={disabled} onChange={event => {
        const chosen = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (chosen) setFile(chosen);
      }} />
    <button type="button" className="babel-document-import-action" disabled={disabled || file !== null} onClick={open}>{label}</button>
    {file !== null && createPortal(
      <DocumentImportDialog file={file} onImport={onImport} onClose={() => setFile(null)} />,
      document.body,
    )}
  </>;
}

function DocumentImportDialog({ file, onImport, onClose }: {
  file: File;
  onImport: DocumentImportActionProps["onImport"];
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const titleId = useId();
  const fieldId = useId();
  const [result, setResult] = useState<DocumentConversionResult | null>(null);
  const [markdown, setMarkdown] = useState("");
  const [title, setTitle] = useState(defaultTitle(file.name));
  const [keepOriginal, setKeepOriginal] = useState(false);
  const [busy, setBusy] = useState(true);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    void convertDocumentFile(file, controller.signal)
      .then(next => {
        if (controller.signal.aborted) return;
        setResult(next);
        setMarkdown(next.markdown);
        setTitle(next.title?.trim() ? defaultTitle(next.title, false) : defaultTitle(file.name));
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(failure));
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [attempt, file]);

  function cancel() {
    if (opening) return;
    controllerRef.current?.abort();
    onClose();
  }

  async function openDraft() {
    if (busy || opening || result === null) return;
    setOpening(true);
    setError("");
    try {
      const draft = prepareDocumentImportDraft({
        file, markdown, title, keepOriginal, token: crypto.randomUUID(),
      });
      await onImport(draft.file, draft.original);
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
      setOpening(false);
    }
  }

  return <dialog ref={dialogRef} className="babel-document-import-dialog" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); cancel(); }}
    onClose={cancel}>
    <div className="babel-document-import-shell">
      <header className="babel-document-import-header">
        <div>
          <span className="babel-folder-import-eyebrow">Import document</span>
          <h2 id={titleId}>Convert to Markdown</h2>
          <p>{file.name} · {formatBytes(file.size)}</p>
        </div>
        <button type="button" data-babel-command="cancel" data-babel-escape="overlay"
          disabled={opening} onClick={cancel}>Cancel</button>
      </header>
      <div className="babel-document-import-body">
        <p className="babel-document-import-status" role="status" aria-live="polite">
          {busy ? "Converting locally with MarkItDown…" : opening ? "Opening draft…"
            : result ? `Converted with MarkItDown ${result.sdkVersion}. Review before saving.`
              : "Conversion could not be completed."}
        </p>
        {error && <div className="babel-document-import-error" role="alert">
          <p>{error}</p>
          {!busy && result === null && <button type="button" onClick={() => {
            setError(""); setBusy(true); setAttempt(value => value + 1);
          }}>Retry conversion</button>}
        </div>}
        {result !== null && <>
          <label className="babel-document-import-field" htmlFor={`${fieldId}-title`}>
            <span>Title</span>
            <input id={`${fieldId}-title`} value={title} maxLength={240} disabled={opening}
              onChange={event => setTitle(event.currentTarget.value)} />
          </label>
          <label className="babel-document-import-field babel-document-import-preview" htmlFor={`${fieldId}-markdown`}>
            <span>Markdown preview · editable</span>
            <textarea id={`${fieldId}-markdown`} value={markdown} spellCheck={false} disabled={opening}
              onChange={event => setMarkdown(event.currentTarget.value)} />
          </label>
          <label className="babel-document-import-original">
            <input type="checkbox" checked={keepOriginal} disabled={opening}
              onChange={event => setKeepOriginal(event.currentTarget.checked)} />
            <span>Keep the original file as an attachment when this draft is saved.</span>
          </label>
          {result.warnings.length > 0 && <ul className="babel-document-import-warnings" aria-label="Conversion warnings">
            {result.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}
          </ul>}
        </>}
        <p className="babel-document-import-help">
          Supported: DOCX, PPTX, XLSX, XLS, text PDF, HTML, TXT, CSV, JSON, XML, EPUB.
          Scanned PDFs need OCR. Complex layouts, formulas, and embedded images may need manual review.
        </p>
      </div>
      <footer className="babel-document-import-footer">
        <p>Choose the folder, tags, and other details in the draft.</p>
        <button type="button" className="primary-button" data-babel-command="confirm"
          disabled={busy || opening || result === null || title.trim().length === 0}
          onClick={() => void openDraft()}>Open draft</button>
      </footer>
    </div>
  </dialog>;
}

function defaultTitle(value: string, stripExtension = true): string {
  const title = stripExtension ? value.replace(/\.[^.]+$/u, "") : value;
  return title.replace(/[\u0000-\u001f\u007f/\\]/gu, " ").trim().slice(0, 240) || "Imported document";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The document could not be imported.";
}

function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KiB` : `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
