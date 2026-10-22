"use client";

import { type DragEvent, useCallback, useEffect, useId, useRef, useState } from "react";
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
  const dragDepthRef = useRef(0);
  const fieldId = useId();
  const [archive, setArchive] = useState<WebArchive | null>(null);
  const [fileName, setFileName] = useState("");
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [preview, setPreview] = useState("");
  const [reading, setReading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputDisabled = reading || pending || disabled || !active;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (active && !dialog.open) dialog.showModal();
    else if (!active && dialog.open) dialog.close();
  }, [active]);

  async function chooseFile(file: File) {
    if (busyRef.current || !active || disabled) return;
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

  function isFileDrag(event: DragEvent<HTMLDialogElement>) {
    return Array.from(event.dataTransfer.types).includes("Files");
  }

  function handleDragEnter(event: DragEvent<HTMLDialogElement>) {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current++;
    if (!busyRef.current && active && !disabled) setDragging(true);
  }

  function handleDragOver(event: DragEvent<HTMLDialogElement>) {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = busyRef.current || disabled || !active ? "none" : "copy";
  }

  function handleDragLeave(event: DragEvent<HTMLDialogElement>) {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragging(false);
  }

  async function handleDrop(event: DragEvent<HTMLDialogElement>) {
    if (!isFileDrag(event)) return;
    // Files dropped anywhere in this modal must not navigate the browser or
    // reach a background notebook's folder/item drop targets.
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setDragging(false);
    if (busyRef.current || !active || disabled) return;
    const files = Array.from(event.dataTransfer.files);
    const items = Array.from(event.dataTransfer.items).filter(item => item.kind === "file");
    if (items.some(item => item.webkitGetAsEntry?.()?.isDirectory)) {
      setError("Drop one .babel.json file, not a folder.");
    } else if (files.length !== 1 || items.length > 1) {
      setError("Drop one David archive (.babel.json) at a time.");
    } else {
      await chooseFile(files[0]);
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

  return <dialog ref={dialogRef} className="babel-document-import-dialog babel-web-archive-import-dialog" aria-labelledby={`${fieldId}-heading`}
    onDragEnter={handleDragEnter} onDragOver={handleDragOver} onDragLeave={handleDragLeave}
    onDrop={event => void handleDrop(event)}
    onCancel={event => { event.preventDefault(); cancel(); }}>
    <div className="babel-document-import-shell">
      <header className="babel-document-import-header">
        <div>
          <span className="babel-folder-import-eyebrow">Import rich content</span>
          <h2 id={`${fieldId}-heading`}>Import David archive</h2>
          <p>Drop or choose a .babel.json capture with local pictures and its original layout.</p>
        </div>
        <button type="button" data-babel-command="cancel" data-babel-escape="overlay" disabled={pending || reading}
          onClick={cancel}>Cancel</button>
      </header>
      <div className="babel-document-import-body">
        <div className="babel-web-archive-dropzone" data-dragging={dragging && !inputDisabled} data-disabled={inputDisabled}>
          <svg className="babel-web-archive-dropzone-icon" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M12 3v12m-4-4 4 4 4-4M4 15v5h16v-5" />
          </svg>
          <strong>Drop a .babel.json archive here</strong>
          <p id={`${fieldId}-drop-help`}>Drag it from Downloads, or choose a file.</p>
          <input ref={fileInputRef} id={`${fieldId}-file`} type="file" hidden aria-label="David archive (.babel.json)"
            accept=".babel.json,application/json" disabled={inputDisabled}
            onChange={event => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void chooseFile(file);
            }} />
          <div><button type="button" disabled={inputDisabled} aria-describedby={`${fieldId}-drop-help`}
            onClick={() => fileInputRef.current?.click()}>Choose archive</button></div>
          <span className="babel-web-archive-file-name" role="status" aria-live="polite">{fileName || "No archive selected"}</span>
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
