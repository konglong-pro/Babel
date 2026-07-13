"use client";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { MarkdownEditor, MarkdownRenderer, type StagedImage } from "@/components/markdown";
import {
  ConfirmButton,
  entryKindLabel,
  folderPathLabel,
  formatDate,
  parseTags,
  Tags,
} from "@/components/shared";
import {
  createEntry,
  deleteEntry,
  getErrorMessage,
  updateEntry,
} from "@/lib/api-client";
import type {
  EntryDetailDto,
  EntryKind,
  EntrySummaryDto,
  FolderDto,
} from "@/lib/types";

export type EntryViewMode = "view" | "edit" | "create";

function descendantEntryIds(
  entryId: number,
  entries: readonly EntrySummaryDto[],
): Set<number> {
  const result = new Set<number>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of entries) {
      if (
        entry.parentId !== null &&
        (entry.parentId === entryId || result.has(entry.parentId)) &&
        !result.has(entry.id)
      ) {
        result.add(entry.id);
        changed = true;
      }
    }
  }
  return result;
}

function entryPathLabel(
  entryId: number,
  entries: ReadonlyMap<number, EntrySummaryDto>,
): string {
  const labels: string[] = [];
  const seen = new Set<number>();
  let current = entries.get(entryId);
  while (current && !seen.has(current.id)) {
    labels.unshift(current.title);
    seen.add(current.id);
    current = current.parentId === null ? undefined : entries.get(current.parentId);
  }
  return labels.join(" / ");
}

interface EntryDetailProps {
  detail: EntryDetailDto | null;
  mode: EntryViewMode;
  folderId: number | null;
  parentId: number | null;
  folders: FolderDto[];
  entries: readonly EntrySummaryDto[];
  loading?: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSaved: (detail: EntryDetailDto) => Promise<void> | void;
  onDeleted: () => Promise<void> | void;
  onDirtyChange: (dirty: boolean) => void;
  onRegisterSave: (action: (() => void) | null) => void;
  onBack: () => void;
}

export function EntryDetail({
  detail,
  mode,
  folderId,
  parentId,
  folders,
  entries,
  loading,
  onEdit,
  onCancel,
  onSaved,
  onDeleted,
  onDirtyChange,
  onRegisterSave,
  onBack,
}: EntryDetailProps) {
  const folderMap = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder])),
    [folders],
  );

  if (loading) {
    return <section className="detail-panel panel-status detail-loading">Loading entry…</section>;
  }

  if (mode === "create" || mode === "edit") {
    return (
      <EntryForm
        key={mode === "edit" ? `edit-${detail?.id ?? "missing"}-${detail?.version ?? 0}` : `new-${folderId}-${parentId ?? "root"}`}
        detail={mode === "edit" ? detail : null}
        initialFolderId={folderId}
        initialParentId={parentId}
        folders={folders}
        entries={entries}
        onCancel={onCancel}
        onSaved={onSaved}
        onDirtyChange={onDirtyChange}
        onRegisterSave={onRegisterSave}
      />
    );
  }

  if (!detail) {
    return (
      <section className="detail-panel empty-state" aria-label="Entry details">
        <button className="content-back" type="button" onClick={onBack}>
          <span aria-hidden="true">←</span> Entries
        </button>
        <span className="empty-monogram" aria-hidden="true">N</span>
        <h2>Build your technical memory</h2>
        <p>Select an entry, or choose a folder and create one.</p>
      </section>
    );
  }

  return (
    <article className="detail-panel document-view">
      <button className="content-back" type="button" onClick={onBack}>
        <span aria-hidden="true">←</span> Entries
      </button>
      <header className="document-header">
        <div>
          <span className="eyebrow">
            {folderPathLabel(detail.folderId, folderMap) || entryKindLabel(detail.kind)}
          </span>
          <p className="entry-kind document-kind">{entryKindLabel(detail.kind)}</p>
          <h1>{detail.title}</h1>
          <Tags tags={detail.tags} />
          <p className="document-meta">
            Version {detail.version} · Updated{" "}
            <time dateTime={detail.updatedAt}>{formatDate(detail.updatedAt)}</time>
          </p>
        </div>
        <div className="document-actions">
          <button type="button" onClick={onEdit}>Edit</button>
          <ConfirmButton
            className="danger-ghost"
            title="Move entry to trash"
            description={`Move “${detail.title}” to trash? You can restore it later.`}
            confirmLabel="Move to trash"
            onConfirm={async () => {
              await deleteEntry(detail.id, detail.version);
              await onDeleted();
            }}
          >
            Delete
          </ConfirmButton>
        </div>
      </header>

      <section className="document-content" aria-label="Entry content">
        {detail.notesMd ? (
          <MarkdownRenderer content={detail.notesMd} />
        ) : (
          <p className="empty-copy">No explanatory notes yet.</p>
        )}
        {detail.kind === "snippet" ? (
          <section className="snippet-view" aria-label="Code snippet">
            <p className="code-meta">
              <strong>{detail.language}</strong>
              {detail.filename ? <span>{detail.filename}</span> : null}
            </p>
            <pre className="code-block"><code>{detail.code}</code></pre>
          </section>
        ) : null}
      </section>
    </article>
  );
}

interface EntryFormProps {
  detail: EntryDetailDto | null;
  initialFolderId: number | null;
  initialParentId: number | null;
  folders: FolderDto[];
  entries: readonly EntrySummaryDto[];
  onCancel: () => void;
  onSaved: (detail: EntryDetailDto) => Promise<void> | void;
  onDirtyChange: (dirty: boolean) => void;
  onRegisterSave: (action: (() => void) | null) => void;
}

function EntryForm({
  detail,
  initialFolderId,
  initialParentId,
  folders,
  entries,
  onCancel,
  onSaved,
  onDirtyChange,
  onRegisterSave,
}: EntryFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const stagedRef = useRef<StagedImage[]>([]);
  const initialKind = detail?.kind ?? "knowledge";
  const initialTitle = detail?.title ?? "";
  const initialTags = detail?.tags.join(", ") ?? "";
  const initialNotes = detail?.notesMd ?? "";
  const initialCode = detail?.code ?? "";
  const initialLanguage = detail?.language ?? "";
  const initialFilename = detail?.filename ?? "";
  const initialFolder = detail?.folderId ?? initialFolderId;
  const initialParent = detail?.parentId ?? initialParentId;
  const [kind, setKind] = useState<EntryKind>(initialKind);
  const [title, setTitle] = useState(initialTitle);
  const [tags, setTags] = useState(initialTags);
  const [notesMd, setNotesMd] = useState(initialNotes);
  const [code, setCode] = useState(initialCode);
  const [language, setLanguage] = useState(initialLanguage);
  const [filename, setFilename] = useState(initialFilename);
  const [folderId, setFolderId] = useState<number | null>(initialFolder);
  const [parentId, setParentId] = useState<number | null>(initialParent);
  const [stagedImages, setStagedImages] = useState<StagedImage[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const folderMap = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder])),
    [folders],
  );
  const folderOptions = useMemo(
    () => folders.map((folder) => ({ id: folder.id, label: folderPathLabel(folder.id, folderMap) })),
    [folderMap, folders],
  );
  const entryMap = useMemo(
    () => new Map(entries.map((entry) => [entry.id, entry])),
    [entries],
  );
  const unavailableParentIds = useMemo(
    () => (detail ? descendantEntryIds(detail.id, entries) : new Set<number>()),
    [detail, entries],
  );
  const parentOptions = useMemo(
    () =>
      entries
        .filter(
          (entry) =>
            entry.folderId === folderId &&
            entry.id !== detail?.id &&
            !unavailableParentIds.has(entry.id),
        )
        .map((entry) => ({ id: entry.id, label: entryPathLabel(entry.id, entryMap) })),
    [detail?.id, entries, entryMap, folderId, unavailableParentIds],
  );
  const imagePreviews = useMemo(
    () => new Map(stagedImages.map((image) => [image.token, image.previewUrl])),
    [stagedImages],
  );
  const snippetChanged = kind === "snippet"
    ? code !== initialCode || language !== initialLanguage || filename !== initialFilename
    : initialKind === "snippet";
  const dirty =
    kind !== initialKind ||
    title !== initialTitle ||
    tags !== initialTags ||
    notesMd !== initialNotes ||
    folderId !== initialFolder ||
    parentId !== initialParent ||
    snippetChanged ||
    stagedImages.length > 0;

  useEffect(() => {
    stagedRef.current = stagedImages;
  }, [stagedImages]);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    const save = () => formRef.current?.requestSubmit();
    onRegisterSave(save);
    return () => onRegisterSave(null);
  }, [onRegisterSave]);

  useEffect(() => {
    return () => {
      onDirtyChange(false);
      for (const image of stagedRef.current) URL.revokeObjectURL(image.previewUrl);
    };
  }, [onDirtyChange]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (folderId === null) {
      setError("Select a folder before saving this entry.");
      return;
    }
    if (kind === "snippet" && !language.trim()) {
      setError("A code snippet needs a language identifier.");
      return;
    }

    setPending(true);
    setError("");
    try {
      const input = {
        folderId,
        parentId,
        kind,
        title: title.trim(),
        notesMd,
        code: kind === "snippet" ? code : null,
        language: kind === "snippet" ? language.trim() : null,
        filename: kind === "snippet" && filename.trim() ? filename.trim() : null,
        tags: parseTags(tags),
      };
      const saved = detail
        ? await updateEntry(detail.id, detail.version, input, stagedImages)
        : await createEntry(input, stagedImages);
      onDirtyChange(false);
      await onSaved(saved);
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  function changeNotes(nextNotes: string) {
    setNotesMd(nextNotes);
    setStagedImages((current) => {
      const retained = current.filter((image) => {
        const referenced = nextNotes.includes(`neum-upload://${image.token}`);
        if (!referenced) URL.revokeObjectURL(image.previewUrl);
        return referenced;
      });
      return retained.length === current.length ? current : retained;
    });
  }

  return (
    <section className="detail-panel form-view">
      <form ref={formRef} onSubmit={submit}>
        <header className="document-header form-header">
          <div>
            <span className="eyebrow">{detail ? "Edit entry" : "New entry"}</span>
            <h1>{detail ? detail.title : "Capture technical knowledge"}</h1>
          </div>
          <div className="document-actions">
            <button type="button" onClick={onCancel}>Cancel</button>
            <button
              className="primary-button"
              type="submit"
              disabled={pending || folderId === null || !title.trim() || (kind === "snippet" && !language.trim())}
              title="Save entry (Ctrl/Cmd+S)"
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </header>

        {error ? <p className="form-error" role="alert">{error}</p> : null}

        <div className="form-row form-columns">
          <label className="field title-field">
            <span>Title</span>
            <input
              name="title"
              autoComplete="off"
              required
              maxLength={240}
              value={title}
              placeholder="A precise concept or snippet name"
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Kind</span>
            <select
              name="kind"
              value={kind}
              onChange={(event) => setKind(event.target.value as EntryKind)}
            >
              <option value="knowledge">Knowledge note</option>
              <option value="snippet">Code snippet</option>
            </select>
          </label>
          <label className="field">
            <span>Folder</span>
            <select
              name="folderId"
              required
              value={folderId ?? ""}
              onChange={(event) => {
                const nextFolderId = event.target.value ? Number(event.target.value) : null;
                setFolderId(nextFolderId);
                setParentId((current) =>
                  current !== null && entryMap.get(current)?.folderId === nextFolderId
                    ? current
                    : null,
                );
              }}
            >
              <option value="" disabled>Select a folder</option>
              {folderOptions.map((folder) => (
                <option key={folder.id} value={folder.id}>{folder.label}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Parent page</span>
            <select
              name="parentId"
              value={parentId ?? ""}
              onChange={(event) => setParentId(event.target.value ? Number(event.target.value) : null)}
            >
              <option value="">Root page</option>
              {parentOptions.map((entry) => (
                <option key={entry.id} value={entry.id}>{entry.label}</option>
              ))}
            </select>
          </label>
          <label className="field tags-field">
            <span>Tags</span>
            <input
              name="tags"
              autoComplete="off"
              value={tags}
              placeholder="database, networking, JSON"
              onChange={(event) => setTags(event.target.value)}
            />
            <small>Separate tags with commas. Matching is case-insensitive.</small>
          </label>
        </div>

        <MarkdownEditor
          label="Notes"
          name="notesMd"
          value={notesMd}
          imagePreviews={imagePreviews}
          onChange={changeNotes}
          onImageError={setError}
          onStageImage={(image) => setStagedImages((current) => [...current, image])}
        />
        <p className="editor-footnote">Images remain in this browser until you save the entry.</p>

        {kind === "snippet" ? (
          <section className="snippet-fields" aria-label="Code snippet fields">
            <div className="form-row form-columns snippet-meta-fields">
              <label className="field">
                <span>Language</span>
                <input
                  name="language"
                  autoComplete="off"
                  required
                  maxLength={80}
                  value={language}
                  placeholder="json, yaml, bash, typescript"
                  onChange={(event) => setLanguage(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Display filename (optional)</span>
                <input
                  name="filename"
                  autoComplete="off"
                  maxLength={240}
                  value={filename}
                  placeholder="docker-compose.yml"
                  onChange={(event) => setFilename(event.target.value)}
                />
              </label>
            </div>
            <label className="field code-field">
              <span>Code</span>
              <textarea
                name="code"
                rows={18}
                value={code}
                spellCheck={false}
                placeholder="Paste the snippet exactly as you want to preserve it."
                onChange={(event) => setCode(event.target.value)}
              />
            </label>
            <p className="editor-footnote">JSON and YAML are stored as written, even when incomplete.</p>
          </section>
        ) : null}
      </form>
    </section>
  );
}
