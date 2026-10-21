"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useWorkspaceProcessActive } from "../pages/react";
import type { ImportedOriginalDocument } from "./document-core";
import { renderWebArchiveSnapshot, type WebArchive } from "./web-archive-core";
import { prepareWebArchiveImport, readWebArchiveFile, webArchiveImportTitle } from "./web-archive-client";

export interface WebArchiveImportActionProps {
  onImport: (file: File, original?: ImportedOriginalDocument) => Promise<void> | void;
  disabled?: boolean;
  onOpen?: () => void;
  registerOpen?: (open: (() => void) | null) => void;
}

export function WebArchiveImportAction({ onImport, disabled = false, onOpen, registerOpen }: WebArchiveImportActionProps) {
  const active = useWorkspaceProcessActive();
  const [opened, setOpened] = useState(false);
  const open = useCallback(() => {
    if (disabled || opened || !active) return;
    onOpen?.();
    setOpened(true);
  }, [active, disabled, onOpen, opened]);
  useEffect(() => {
    registerOpen?.(disabled || opened || !active ? null : open);
    return () => registerOpen?.(null);
  }, [active, disabled, open, opened, registerOpen]);

  return <>
    <button type="button" disabled={disabled || opened || !active} onClick={open}>Import David archive</button>
    {opened && createPortal(<WebArchiveImportDialog onImport={onImport} disabled={disabled}
      onClose={() => setOpened(false)} />, document.body)}
  </>;
}

function WebArchiveImportDialog({ onImport, onClose, disabled }: {
  onImport: WebArchiveImportActionProps["onImport"];
  onClose: () => void;
  disabled: boolean;
}) {
  const active = useWorkspaceProcessActive();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const fieldId = useId();
  const [archive, setArchive] = useState<WebArchive | null>(null);
  const [fileName, setFileName] = useState("");
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [preview, setPreview] = useState("");
  const [reading, setReading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (active && !dialog.open) dialog.showModal();
    else if (!active && dialog.open) dialog.close();
  }, [active]);

  async function chooseFile(file: File) {
    if (busyRef.current) return;
    busyRef.current = true;
    setReading(true);
    setError("");
    try {
      const next = await readWebArchiveFile(file);
      setArchive(next);
      setFileName(file.name);
      setTitle(webArchiveImportTitle(next.title));
      setMarkdown(next.markdown);
      setPreview("");
    } catch (failure) {
      // A bad replacement must not discard the previously reviewed capture.
      setError(failure instanceof Error ? failure.message : "The archive could not be read.");
    } finally {
      busyRef.current = false;
      setReading(false);
    }
  }

  async function openDraft() {
    if (!archive || busyRef.current || !active || disabled) return;
    busyRef.current = true;
    setError("");
    try {
      const prepared = prepareWebArchiveImport(archive, { title, markdown });
      setPending(true);
      await onImport(prepared.file, prepared.original);
      onClose();
    } catch (failure) {
      busyRef.current = false;
      setError(failure instanceof Error ? failure.message : "The archive draft could not be opened.");
      setPending(false);
    }
  }

  function cancel() {
    if (!busyRef.current) onClose();
  }

  function togglePreview() {
    setError("");
    try {
      setPreview(preview ? "" : renderWebArchiveSnapshot(archive!));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The original layout could not be previewed.");
    }
  }

  return <dialog ref={dialogRef} className="babel-document-import-dialog" aria-labelledby={`${fieldId}-heading`}
    onCancel={event => { event.preventDefault(); cancel(); }}>
    <div className="babel-document-import-shell">
      <header className="babel-document-import-header">
        <div>
          <span className="babel-folder-import-eyebrow">Import rich content</span>
          <h2 id={`${fieldId}-heading`}>Import David archive</h2>
          <p>Open a .babel.json capture with local pictures and its original layout.</p>
        </div>
        <button type="button" data-babel-command="cancel" data-babel-escape="overlay" disabled={pending || reading}
          onClick={cancel}>Cancel</button>
      </header>
      <div className="babel-document-import-body">
        <div className="babel-document-import-field">
          <span>David archive (.babel.json)</span>
          <input ref={fileInputRef} id={`${fieldId}-file`} type="file" hidden aria-label="David archive (.babel.json)"
            accept=".babel.json,application/json" disabled={reading || pending}
            onChange={event => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void chooseFile(file);
            }} />
          <div><button type="button" disabled={reading || pending} onClick={() => fileInputRef.current?.click()}>Choose archive</button></div>
          <span>{fileName || "No archive selected"}</span>
        </div>
        {archive && <>
          <p role="status">{archive.assets.length} local {archive.assets.length === 1 ? "image" : "images"} · Original layout included</p>
          {archive.warnings.length > 0 && <div className="babel-document-import-help">
            <p>Capture warnings</p><ul>{archive.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
          </div>}
          <label className="babel-document-import-field" htmlFor={`${fieldId}-title`}>
            <span>Title</span><input id={`${fieldId}-title`} value={title} maxLength={240} disabled={pending || reading}
              onChange={event => setTitle(event.currentTarget.value)} />
          </label>
          <label className="babel-document-import-field babel-document-import-preview" htmlFor={`${fieldId}-markdown`}>
            <span>Markdown · review and edit</span>
            <textarea id={`${fieldId}-markdown`} value={markdown} spellCheck={false} disabled={pending || reading}
              onChange={event => setMarkdown(event.currentTarget.value)} />
          </label>
          <div><button type="button" disabled={pending || reading} onClick={togglePreview}>
            {preview ? "Hide original layout" : "Preview original layout"}</button></div>
          {preview && <iframe title="Original captured layout" sandbox="" referrerPolicy="no-referrer" srcDoc={preview}
            style={{ width: "100%", height: "360px", border: "1px solid currentColor" }} />}
        </>}
        <p className="babel-document-import-help">Markdown and pictures open in an unsaved draft. Nothing is stored before Save. After saving, use “View original layout” in the note to open the static, offline snapshot.</p>
        {error && <p role="alert" className="babel-document-import-error">{error}</p>}
      </div>
      <footer className="babel-document-import-footer">
        <p role="status" aria-live="polite">{reading ? "Reading archive…" : pending ? "Opening draft…" : "Nothing is saved before Save."}</p>
        <button type="button" disabled={!archive || !title.trim() || reading || pending || !active || disabled}
          onClick={() => void openDraft()}>Open draft</button>
      </footer>
    </div>
  </dialog>;
}
