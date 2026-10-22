"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useWorkspaceProcessActive } from "../pages/react";
import { clipboardMarkdownTitle, prepareClipboardMarkdownFile } from "./clipboard-client";

export interface ClipboardMarkdownImportActionProps {
  onImport: (file: File) => Promise<void> | void;
  disabled?: boolean;
  onOpen?: () => void;
  registerOpen?: (open: (() => void) | null) => void;
}

export function ClipboardMarkdownImportAction({
  onImport, disabled = false, onOpen, registerOpen,
}: ClipboardMarkdownImportActionProps) {
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
    <button type="button" disabled={disabled || opened || !active} onClick={open}>Paste Markdown / David</button>
    {opened && createPortal(
      <ClipboardMarkdownImportDialog onImport={onImport} onClose={() => setOpened(false)} />,
      document.body,
    )}
  </>;
}

function ClipboardMarkdownImportDialog({ onImport, onClose }: {
  onImport: ClipboardMarkdownImportActionProps["onImport"];
  onClose: () => void;
}) {
  const active = useWorkspaceProcessActive();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const markdownRef = useRef<HTMLTextAreaElement>(null);
  const titleEdited = useRef(false);
  const fieldId = useId();
  const [markdown, setMarkdown] = useState("");
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (active && !dialog.open) {
      dialog.showModal();
      markdownRef.current?.focus();
    }
    else if (!active && dialog.open) dialog.close();
  }, [active]);

  function updateMarkdown(value: string) {
    setMarkdown(value);
    if (!titleEdited.current) setTitle(value.trim() ? clipboardMarkdownTitle(value) : "");
    setError("");
  }

  async function readClipboard() {
    setReading(true);
    setError("");
    try {
      updateMarkdown(await navigator.clipboard.readText());
    } catch {
      setError("Clipboard access was unavailable. Click the Markdown field and paste with Ctrl+V or Cmd+V.");
    } finally {
      setReading(false);
    }
  }

  async function openDraft() {
    if (pending || reading) return;
    setError("");
    try {
      const file = prepareClipboardMarkdownFile(markdown, title);
      setPending(true);
      await onImport(file);
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The Markdown draft could not be opened.");
      setPending(false);
    }
  }

  function cancel() {
    if (!pending && !reading) onClose();
  }

  return <dialog ref={dialogRef} className="babel-document-import-dialog" aria-labelledby={`${fieldId}-heading`}
    onCancel={event => { event.preventDefault(); cancel(); }}>
    <div className="babel-document-import-shell">
      <header className="babel-document-import-header">
        <div>
          <span className="babel-folder-import-eyebrow">Import from clipboard</span>
          <h2 id={`${fieldId}-heading`}>Paste Markdown / David</h2>
          <p>Copy with David, then paste below. Review the text before opening an editable draft.</p>
        </div>
        <button type="button" data-babel-command="cancel" data-babel-escape="overlay"
          disabled={pending || reading} onClick={cancel}>Cancel</button>
      </header>
      <div className="babel-document-import-body">
        <div><button type="button" disabled={pending || reading} onClick={() => void readClipboard()}>
          {reading ? "Reading clipboard…" : "Read clipboard"}
        </button></div>
        <label className="babel-document-import-field" htmlFor={`${fieldId}-title`}>
          <span>Title</span>
          <input id={`${fieldId}-title`} value={title} maxLength={240} disabled={pending || reading}
            onChange={event => { titleEdited.current = true; setTitle(event.currentTarget.value); }} />
        </label>
        <label className="babel-document-import-field babel-document-import-preview" htmlFor={`${fieldId}-markdown`}>
          <span id={`${fieldId}-markdown-label`}>Markdown · paste and edit</span>
          <textarea ref={markdownRef} id={`${fieldId}-markdown`} aria-labelledby={`${fieldId}-markdown-label`}
            value={markdown} spellCheck={false} disabled={pending || reading}
            placeholder="Paste Markdown here (Ctrl+V / Cmd+V)"
            onChange={event => updateMarkdown(event.currentTarget.value)} />
        </label>
        <p className="babel-document-import-help">Up to 10 MiB. Web images keep their original URLs; local images can be matched in the draft. Nothing is saved until you save the draft.</p>
        {error && <p role="alert" className="babel-document-import-error">{error}</p>}
      </div>
      <footer className="babel-document-import-footer">
        <p role="status" aria-live="polite">{pending ? "Opening draft…" : "The current folder will receive the draft."}</p>
        <button type="button" disabled={pending || reading || !markdown.trim() || !title.trim()}
          onClick={() => void openDraft()}>Open draft</button>
      </footer>
    </div>
  </dialog>;
}
