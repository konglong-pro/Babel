"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  DOCUMENT_IMPORT_ACCEPT,
  splitDocumentChapters,
  type DocumentChapter,
  type DocumentHeadingLevel,
  type DocumentConversionResult,
  type ImportedOriginalDocument,
} from "./document-core";
import {
  convertDocumentFile,
  prepareDocumentImportDraft,
  prepareDocumentChapterFiles,
} from "./document-client";

export interface DocumentImportActionProps {
  onImport: (file: File, original?: ImportedOriginalDocument) => Promise<void> | void;
  onImportChapters?: (files: File[]) => Promise<void> | void;
  disabled?: boolean;
  label?: string;
  onOpen?: () => void;
  registerOpen?: (open: (() => void) | null) => void;
}

export function DocumentImportAction({
  onImport,
  onImportChapters,
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
      <DocumentImportDialog file={file} onImport={onImport} onImportChapters={onImportChapters} onClose={() => setFile(null)} />,
      document.body,
    )}
  </>;
}

function DocumentImportDialog({ file, onImport, onImportChapters, onClose }: {
  file: File;
  onImport: DocumentImportActionProps["onImport"];
  onImportChapters?: DocumentImportActionProps["onImportChapters"];
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
  const [mode, setMode] = useState<"single" | "chapters">(onImportChapters && /\.epub$/iu.test(file.name) ? "chapters" : "single");
  const [chapters, setChapters] = useState<Array<DocumentChapter & { included: boolean }>>([]);
  const [selectedChapter, setSelectedChapter] = useState(0);
  const [splitAt, setSplitAt] = useState(0);
  const [strategy, setStrategy] = useState<DocumentHeadingLevel | "epub">("auto");
  const [chaptersEdited, setChaptersEdited] = useState(false);

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
        const bookTitle = next.title?.trim() ? defaultTitle(next.title, false) : defaultTitle(file.name);
        setTitle(bookTitle);
        setChapters(reviewChapters(next.chapters ?? splitDocumentChapters(next.markdown, bookTitle)));
        setStrategy(next.chapters ? "epub" : "auto");
        setChaptersEdited(false);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(failure));
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [attempt, file]);

  const currentChapter = chapters[selectedChapter];
  const includedChapters = chapters.filter(chapter => chapter.included);

  function updateChapter(changes: Partial<DocumentChapter & { included: boolean }>) {
    setChapters(current => current.map((chapter, index) => index === selectedChapter ? { ...chapter, ...changes } : chapter));
    setChaptersEdited(true);
  }

  function detectChapters(nextStrategy: DocumentHeadingLevel | "epub") {
    if (chaptersEdited && !window.confirm("Re-detecting chapters replaces your chapter edits and boundaries. Continue?")) return;
    const next = nextStrategy === "epub" && result?.chapters
      ? result.chapters : splitDocumentChapters(markdown, title, nextStrategy === "epub" ? "auto" : nextStrategy);
    setChapters(reviewChapters(next));
    setSelectedChapter(0);
    setSplitAt(0);
    setStrategy(nextStrategy);
    setChaptersEdited(false);
  }

  function mergeChapter() {
    if (selectedChapter === 0 || !currentChapter) return;
    setChapters(current => current.flatMap((chapter, index) => {
      if (index === selectedChapter) return [];
      if (index === selectedChapter - 1) return [{
        ...chapter, markdown: `${chapter.markdown.trimEnd()}\n\n${currentChapter.markdown.trimStart()}`,
        included: chapter.included || currentChapter.included,
      }];
      return [chapter];
    }));
    setSelectedChapter(selectedChapter - 1);
    setSplitAt(0);
    setChaptersEdited(true);
  }

  function splitChapter() {
    if (!currentChapter || !currentChapter.markdown.slice(0, splitAt).trim() || !currentChapter.markdown.slice(splitAt).trim()) return;
    const remainder = currentChapter.markdown.slice(splitAt);
    const inferred = splitDocumentChapters(remainder, `${currentChapter.title} (continued)`)[0];
    setChapters(current => current.flatMap((chapter, index) => index === selectedChapter ? [
      { ...chapter, markdown: chapter.markdown.slice(0, splitAt) },
      { title: defaultTitle(inferred.title, false), markdown: remainder, included: chapter.included },
    ] : [chapter]));
    setSelectedChapter(selectedChapter + 1);
    setSplitAt(0);
    setChaptersEdited(true);
  }

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
      if (mode === "chapters" && onImportChapters) {
        await onImportChapters(prepareDocumentChapterFiles(includedChapters, title));
        onClose();
        return;
      }
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
          {busy ? "Converting locally with MarkItDown…" : opening ? "Preparing import…"
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
          {onImportChapters && <label className="babel-document-import-field" htmlFor={`${fieldId}-mode`}>
            <span id={`${fieldId}-mode-label`}>Import as</span>
            <select id={`${fieldId}-mode`} aria-labelledby={`${fieldId}-mode-label`} value={mode} disabled={opening}
              onChange={event => {
                const nextMode = event.currentTarget.value as "single" | "chapters";
                if (nextMode === "chapters" && !chaptersEdited && markdown !== result.markdown) detectChapters(strategy === "epub" ? "auto" : strategy);
                setMode(nextMode);
                setError("");
              }}>
              <option value="single">One note</option>
              <option value="chapters">Book chapters · separate notes in the current folder</option>
            </select>
          </label>}
          {mode === "single" ? <>
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
          </> : <>
            <div className="babel-document-chapter-toolbar">
              <label className="babel-document-import-field" htmlFor={`${fieldId}-strategy`}>
                <span id={`${fieldId}-strategy-label`}>Chapter boundaries</span>
                <select id={`${fieldId}-strategy`} aria-labelledby={`${fieldId}-strategy-label`} value={strategy} disabled={opening}
                  onChange={event => {
                    const value = event.currentTarget.value;
                    detectChapters(value === "epub" || value === "auto" ? value : Number(value) as DocumentHeadingLevel);
                  }}>
                  {result.chapters && <option value="epub" disabled={markdown !== result.markdown}>{result.chapterSource === "epub-toc" ? "EPUB table of contents" : "EPUB reading order"}</option>}
                  <option value="auto">Automatically detect headings</option>
                  {[1, 2, 3, 4, 5, 6].map(level => <option key={level} value={level}>Heading {level}</option>)}
                </select>
              </label>
              <p role="status">{includedChapters.length} of {chapters.length} sections selected. Review titles and text; merge sections or split at the cursor.</p>
            </div>
            {chapters.length === 1 && <p className="babel-document-import-help">Only one section was found. Choose another heading level or place the cursor in the text and split manually.</p>}
            <div className="babel-document-chapters">
              <nav aria-label="Book sections" className="babel-document-chapter-list">
                {chapters.map((chapter, index) => <button key={index} type="button" disabled={opening}
                  aria-current={index === selectedChapter ? "true" : undefined}
                  onClick={() => { setSelectedChapter(index); setSplitAt(0); }}>
                  {chapter.title || "Untitled section"}{chapter.included ? "" : " · excluded"}
                </button>)}
              </nav>
              {currentChapter && <section className="babel-document-chapter-editor" aria-label="Selected chapter">
                <label className="babel-document-import-original">
                  <input type="checkbox" checked={currentChapter.included} disabled={opening}
                    onChange={event => updateChapter({ included: event.currentTarget.checked })} />
                  <span>Include this section</span>
                </label>
                <label className="babel-document-import-field" htmlFor={`${fieldId}-chapter-title`}>
                  <span>Note title</span>
                  <input id={`${fieldId}-chapter-title`} value={currentChapter.title} maxLength={240} disabled={opening}
                    onChange={event => updateChapter({ title: event.currentTarget.value })} />
                </label>
                <label className="babel-document-import-field babel-document-import-preview" htmlFor={`${fieldId}-chapter-text`}>
                  <span>Chapter Markdown · editable</span>
                  <textarea id={`${fieldId}-chapter-text`} value={currentChapter.markdown} spellCheck={false} disabled={opening}
                    onSelect={event => setSplitAt(event.currentTarget.selectionStart)}
                    onChange={event => updateChapter({ markdown: event.currentTarget.value })} />
                </label>
                <div className="babel-document-chapter-actions">
                  <button type="button" disabled={opening || selectedChapter === 0} onClick={mergeChapter}>Merge with previous</button>
                  <button type="button" disabled={opening || !currentChapter.markdown.slice(0, splitAt).trim() || !currentChapter.markdown.slice(splitAt).trim()}
                    onClick={splitChapter}>Split at cursor</button>
                </div>
              </section>}
            </div>
          </>}
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
        <p>{mode === "chapters" ? "Next: review chapter titles, tags and the destination folder, then confirm the import." : "Choose the folder, tags, and other details in the draft."}</p>
        <button type="button" className="primary-button" data-babel-command="confirm"
          disabled={busy || opening || result === null || (mode === "chapters" ? includedChapters.length === 0 : title.trim().length === 0)}
          onClick={() => void openDraft()}>{mode === "chapters" ? "Review chapter import" : "Open draft"}</button>
      </footer>
    </div>
  </dialog>;
}

function reviewChapters(chapters: readonly DocumentChapter[]): Array<DocumentChapter & { included: boolean }> {
  return chapters.map(chapter => ({ ...chapter, title: defaultTitle(chapter.title, false), included: true }));
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
