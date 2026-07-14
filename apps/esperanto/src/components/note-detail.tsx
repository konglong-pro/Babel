"use client";

import type { Wikilink } from "@babel-apps/markdown/core";
import {
  MarkdownRenderer,
  OutlinePanel,
  type ResolvedWikilink,
} from "@babel-apps/markdown/react";
import {
  useCallback,
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { MarkdownEditor, type StagedImage } from "@/components/markdown-editor";
import {
  ConfirmButton,
  folderPathLabel,
  formatDate,
  parseTags,
  Tags,
} from "@/components/shared";
import {
  createNote,
  deleteNote,
  getErrorMessage,
  updateNote,
} from "@/lib/api-client";
import type {
  BacklinkDto,
  FolderDto,
  NoteDetailDto,
  NoteSummaryDto,
} from "@/lib/types";

const NOTE_HEADING_ID_PREFIX = "esperanto-note-heading-";

export type NoteViewMode = "view" | "edit" | "create";

interface NoteDetailProps {
  detail: NoteDetailDto | null;
  mode: NoteViewMode;
  folderId: number | null;
  parentId: number | null;
  folders: FolderDto[];
  notes: NoteSummaryDto[];
  backlinks: BacklinkDto[];
  loading?: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSaved: (detail: NoteDetailDto) => Promise<void> | void;
  onDeleted: () => Promise<void> | void;
  onNavigateNote: (id: number, folderId?: number) => void;
  onCreateWikilink: (title: string, folderId: number) => Promise<void> | void;
  onDirtyChange: (dirty: boolean) => void;
  onRegisterSave: (action: (() => void) | null) => void;
  onBack: () => void;
}

export function NoteDetail({
  detail,
  mode,
  folderId,
  parentId,
  folders,
  notes,
  backlinks,
  loading,
  onEdit,
  onCancel,
  onSaved,
  onDeleted,
  onNavigateNote,
  onCreateWikilink,
  onDirtyChange,
  onRegisterSave,
  onBack,
}: NoteDetailProps) {
  const folderMap = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders]);
  const wikilinkTargets = useMemo(() => new Map(
    (detail?.links ?? [])
      .filter((link): link is { titleKey: string; targetId: number } => link.targetId !== null)
      .map((link) => [link.titleKey, { id: link.targetId }]),
  ), [detail?.links]);
  const resolveWikilink = useCallback(
    (titleKey: string): ResolvedWikilink | null => wikilinkTargets.get(titleKey) ?? null,
    [wikilinkTargets],
  );
  const navigateWikilink = useCallback(
    (target: ResolvedWikilink) => onNavigateNote(target.id),
    [onNavigateNote],
  );
  const createFromWikilink = useCallback((wikilink: Wikilink) => {
    const targetFolderId = detail?.folderId ?? folderId;
    const title = wikilink.titleRaw.trim().replace(/\s+/gu, " ");
    if (targetFolderId === null || !title) return;
    if (!window.confirm(`Create note “${title}”?`)) return;
    void onCreateWikilink(title, targetFolderId);
  }, [detail?.folderId, folderId, onCreateWikilink]);

  if (loading) {
    return <section className="detail-panel panel-status detail-loading">Loading note…</section>;
  }

  if (mode === "create" || mode === "edit") {
    return (
      <NoteForm
        detail={mode === "edit" ? detail : null}
        initialFolderId={folderId}
        initialParentId={parentId}
        folders={folders}
        notes={notes}
        onCancel={onCancel}
        onSaved={onSaved}
        onDirtyChange={onDirtyChange}
        onRegisterSave={onRegisterSave}
        resolveWikilink={resolveWikilink}
        onNavigateWikilink={navigateWikilink}
        onCreateWikilink={onCreateWikilink}
      />
    );
  }

  if (!detail) {
    return (
      <section className="detail-panel empty-state" aria-label="Note details">
        <button className="content-back" type="button" onClick={onBack}>
          <span aria-hidden="true">←</span> Notes
        </button>
        <span className="empty-monogram" aria-hidden="true">E</span>
        <h2>Make language memorable</h2>
        <p>Select a note, or choose a folder and create one.</p>
      </section>
    );
  }

  return (
    <article className="detail-panel document-view">
      <button className="content-back" type="button" onClick={onBack}>
        <span aria-hidden="true">←</span> Notes
      </button>
      <header className="document-header">
        <div>
          <span className="eyebrow">{folderPathLabel(detail.folderId, folderMap) || "Note"}</span>
          <h1>{detail.title}</h1>
          <Tags tags={detail.tags} />
          <p className="document-meta">
            Updated <time dateTime={detail.updatedAt}>{formatDate(detail.updatedAt)}</time>
          </p>
        </div>
        <div className="document-actions">
          <button type="button" onClick={onEdit}>Edit</button>
          <ConfirmButton
            className="danger-ghost"
            title="Delete note"
            description={`Delete “${detail.title}”? This action cannot be undone.`}
            onConfirm={async () => {
              await deleteNote(detail.id);
              await onDeleted();
            }}
          >
            Delete
          </ConfirmButton>
        </div>
      </header>

      <div className="document-outline-layout">
        <section className="document-content" aria-label="Note content">
          <MarkdownRenderer
            content={detail.contentMd}
            uploadScheme="esperanto-upload"
            resolveWikilink={resolveWikilink}
            onNavigateWikilink={navigateWikilink}
            onCreateFromWikilink={createFromWikilink}
            headingIdPrefix={NOTE_HEADING_ID_PREFIX}
          />
        </section>
        <OutlinePanel
          content={detail.contentMd}
          mode="read"
          headingIdPrefix={NOTE_HEADING_ID_PREFIX}
        />
      </div>
      <section className="linked-mentions" aria-labelledby="linked-mentions-heading">
        <h2 id="linked-mentions-heading">Linked mentions ({backlinks.length})</h2>
        {backlinks.length === 0 ? (
          <p className="empty-copy">No notes link here yet.</p>
        ) : (
          <ul>
            {backlinks.map((backlink) => (
              <li key={backlink.id}>
                <button
                  type="button"
                  onClick={() => onNavigateNote(backlink.id, backlink.folderId)}
                >
                  {backlink.title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}

interface NoteFormProps {
  detail: NoteDetailDto | null;
  initialFolderId: number | null;
  initialParentId: number | null;
  folders: FolderDto[];
  notes: NoteSummaryDto[];
  onCancel: () => void;
  onSaved: (detail: NoteDetailDto) => Promise<void> | void;
  onDirtyChange: (dirty: boolean) => void;
  onRegisterSave: (action: (() => void) | null) => void;
  resolveWikilink: (titleKey: string) => ResolvedWikilink | null;
  onNavigateWikilink: (target: ResolvedWikilink) => void;
  onCreateWikilink: (title: string, folderId: number) => Promise<void> | void;
}

function NoteForm({
  detail,
  initialFolderId,
  initialParentId,
  folders,
  notes,
  onCancel,
  onSaved,
  onDirtyChange,
  onRegisterSave,
  resolveWikilink,
  onNavigateWikilink,
  onCreateWikilink,
}: NoteFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const stagedRef = useRef<StagedImage[]>([]);
  const initialTitle = detail?.title ?? "";
  const initialTags = detail?.tags.join(", ") ?? "";
  const initialContent = detail?.contentMd ?? "";
  const initialFolder = detail?.folderId ?? initialFolderId;
  const initialParent = detail?.parentId ?? initialParentId;
  const [title, setTitle] = useState(initialTitle);
  const [tags, setTags] = useState(initialTags);
  const [content, setContent] = useState(initialContent);
  const [folderId, setFolderId] = useState<number | null>(initialFolder);
  const [parentId, setParentId] = useState<number | null>(initialParent);
  const [stagedImages, setStagedImages] = useState<StagedImage[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const folderMap = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders]);
  const folderOptions = useMemo(
    () => folders.map((folder) => ({ id: folder.id, label: folderPathLabel(folder.id, folderMap) })),
    [folderMap, folders],
  );
  const parentOptions = useMemo(() => {
    if (folderId === null) return [];
    const noteMap = new Map(notes.map((note) => [note.id, note]));
    const excluded = detail ? noteDescendantIds(detail.id, notes) : new Set<number>();
    if (detail) excluded.add(detail.id);
    return notes
      .filter((note) => note.folderId === folderId && !excluded.has(note.id))
      .map((note) => ({ id: note.id, label: notePathLabel(note.id, noteMap) }));
  }, [detail, folderId, notes]);
  const imagePreviews = useMemo(
    () => new Map(stagedImages.map((image) => [image.token, image.previewUrl])),
    [stagedImages],
  );
  const dirty =
    title !== initialTitle ||
    tags !== initialTags ||
    content !== initialContent ||
    folderId !== initialFolder ||
    parentId !== initialParent ||
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
      setError("Select a folder before saving this note.");
      return;
    }

    setPending(true);
    setError("");
    try {
      const input = {
        folderId,
        parentId,
        title: title.trim(),
        contentMd: content,
        tags: parseTags(tags),
      };
      const saved = detail
        ? await updateNote(detail.id, input, stagedImages)
        : await createNote(input, stagedImages);
      onDirtyChange(false);
      await onSaved(saved);
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  function changeContent(nextContent: string) {
    setContent(nextContent);
    setStagedImages((current) => {
      const retained = current.filter((image) => {
        const referenced = nextContent.includes(`esperanto-upload://${image.token}`);
        if (!referenced) URL.revokeObjectURL(image.previewUrl);
        return referenced;
      });
      return retained.length === current.length ? current : retained;
    });
  }

  async function createFromWikilink(wikilink: Wikilink) {
    if (pending) return;
    const normalizedTitle = wikilink.titleRaw.trim().replace(/\s+/gu, " ");
    if (folderId === null || !normalizedTitle) return;
    if (!window.confirm(`Create note “${normalizedTitle}”?`)) return;
    setPending(true);
    try {
      await onCreateWikilink(normalizedTitle, folderId);
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="detail-panel form-view">
      <form ref={formRef} onSubmit={submit}>
        <header className="document-header form-header">
          <div>
            <span className="eyebrow">{detail ? "Edit note" : "New note"}</span>
            <h1>{detail ? detail.title : "Capture what you learned"}</h1>
          </div>
          <div className="document-actions">
            <button type="button" onClick={onCancel}>Cancel</button>
            <button
              className="primary-button"
              type="submit"
              disabled={pending || folderId === null || !title.trim()}
              title="Save note (Ctrl/Cmd+S)"
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
              placeholder="A clear title for this note"
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Folder</span>
            <select
              name="folderId"
              required
              value={folderId ?? ""}
              onChange={(event) => {
                setFolderId(event.target.value ? Number(event.target.value) : null);
                setParentId(null);
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
              {parentOptions.map((note) => (
                <option key={note.id} value={note.id}>{note.label}</option>
              ))}
            </select>
          </label>
          <label className="field tags-field">
            <span>Tags</span>
            <input
              name="tags"
              autoComplete="off"
              value={tags}
              placeholder="phrasal verbs, travel, review"
              onChange={(event) => setTags(event.target.value)}
            />
            <small>Separate tags with commas. Matching is case-insensitive.</small>
          </label>
        </div>

        <div className="editor-outline-layout">
          <MarkdownEditor
            label="Content"
            name="contentMd"
            value={content}
            imagePreviews={imagePreviews}
            onChange={changeContent}
            onImageError={setError}
            onStageImage={(image) => setStagedImages((current) => [...current, image])}
            resolveWikilink={resolveWikilink}
            onNavigateWikilink={onNavigateWikilink}
            onCreateFromWikilink={createFromWikilink}
            textareaRef={textareaRef}
            headingIdPrefix={NOTE_HEADING_ID_PREFIX}
            footerExtras={(
              <p className="editor-footnote">
                Images remain in this browser until you save the note.
              </p>
            )}
          />
          <OutlinePanel
            content={content}
            mode="edit"
            textareaRef={textareaRef}
            headingIdPrefix={NOTE_HEADING_ID_PREFIX}
          />
        </div>
      </form>
    </section>
  );
}

function noteDescendantIds(rootId: number, notes: readonly NoteSummaryDto[]): Set<number> {
  const ids = new Set<number>();
  let added = true;
  while (added) {
    added = false;
    for (const note of notes) {
      if (note.parentId === rootId || (note.parentId !== null && ids.has(note.parentId))) {
        if (ids.has(note.id)) continue;
        ids.add(note.id);
        added = true;
      }
    }
  }
  return ids;
}

function notePathLabel(
  id: number,
  noteMap: ReadonlyMap<number, NoteSummaryDto>,
): string {
  const titles: string[] = [];
  const visited = new Set<number>();
  let cursor: number | null = id;
  while (cursor !== null && !visited.has(cursor)) {
    visited.add(cursor);
    const note = noteMap.get(cursor);
    if (!note) break;
    titles.push(note.title);
    cursor = note.parentId;
  }
  return titles.reverse().join(" / ");
}
