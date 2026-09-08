"use client";

import { FolderPicker } from "@babel-apps/platform/folders/picker";

import type { Wikilink } from "@babel-apps/markdown/core";
import {
  DetachedEditorWindow,
  prepareDetachedEditorWindow,
} from "@babel-apps/markdown/detached-editor";
import {
  DetachedReaderWindow,
  MarkdownRenderer,
  OutlinePanel,
  type ResolvedWikilink,
} from "@babel-apps/markdown/react";
import {
  literalSourceLine,
  type SearchFocus,
} from "@babel-apps/platform/search/focus";
import { focusSearchMatch } from "@babel-apps/platform/search/focus-client";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { ImportedImageMatcher } from "@/components/imported-image-matcher";
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
import type { MarkdownImportDraft } from "@/lib/markdown-import";
import {
  NOTE_CONTENT_MAX_BYTES,
  NOTE_NEW_IMAGE_MAX_COUNT,
  NOTE_SAVE_MAX_BYTES,
  utf8ByteLength,
} from "@/lib/note-limits";
import type {
  BacklinkDto,
  FolderDto,
  NoteDetailDto,
  NoteSearchField,
  NoteSummaryDto,
  NoteTemplateDto,
} from "@/lib/types";

export type NoteViewMode = "view" | "edit" | "create";

const NOTE_HEADING_ID_PREFIX = "herodotus-note-heading-";
const REMARK_FEATURES = ["gfm", "formula-math"] as const;
const PENDING_IMAGE_URL_PATTERN = /herodotus-upload:\/\/[A-Za-z0-9._-]+/g;
const MAX_MANAGED_IMAGE_URL =
  "/api/uploads/notes/00000000-0000-0000-0000-000000000000.webp";
const EMPTY_IMAGE_PREVIEWS = new Map<string, string>();

function estimatedPersistedMarkdownBytes(contentMd: string): number {
  return utf8ByteLength(
    contentMd.replace(PENDING_IMAGE_URL_PATTERN, MAX_MANAGED_IMAGE_URL),
  );
}

interface NoteReaderDraftProps {
  title: string;
  folderLabel: string;
  tags: string[];
  content: string;
  imagePreviews: ReadonlyMap<string, string>;
  liveDraft: boolean;
  ownerDocument: Document;
  resolveWikilink: (titleKey: string) => ResolvedWikilink | null;
  onNavigateWikilink: (target: ResolvedWikilink) => void;
}

function NoteReaderDraft({
  title,
  folderLabel,
  tags,
  content,
  imagePreviews,
  liveDraft,
  ownerDocument,
  resolveWikilink,
  onNavigateWikilink,
}: NoteReaderDraftProps) {
  const headingIdPrefix = `${NOTE_HEADING_ID_PREFIX}reader-`;
  return (
    <article
      className="document-view"
      aria-label={liveDraft ? "Live note reader" : "Note reader"}
    >
      <header className="document-header">
        <div>
          <span className="eyebrow">
            {folderLabel || (liveDraft ? "Draft note" : "Note")}
          </span>
          <h1>{title.trim() || "Untitled note"}</h1>
          <Tags tags={tags} />
          {liveDraft ? (
            <p className="document-meta">Live draft. Save changes in the editor.</p>
          ) : null}
        </div>
      </header>
      <div className="document-outline-layout">
        <section className="document-content" aria-label="Note content">
          <MarkdownRenderer
            content={content}
            imagePreviews={imagePreviews}
            remarkFeatures={REMARK_FEATURES}
            uploadScheme="herodotus-upload"
            resolveWikilink={resolveWikilink}
            onNavigateWikilink={onNavigateWikilink}
            headingIdPrefix={headingIdPrefix}
          />
        </section>
        <OutlinePanel
          content={content}
          mode="read"
          ownerDocument={ownerDocument}
          headingIdPrefix={headingIdPrefix}
        />
      </div>
    </article>
  );
}

function noteSubtreeIds(rootId: number, notes: readonly NoteSummaryDto[]): Set<number> {
  const grouped = new Map<number, number[]>();
  for (const note of notes) {
    if (note.parentId === null) continue;
    const children = grouped.get(note.parentId) ?? [];
    children.push(note.id);
    grouped.set(note.parentId, children);
  }
  const result = new Set([rootId]);
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined) continue;
    for (const childId of grouped.get(id) ?? []) {
      if (result.has(childId)) continue;
      result.add(childId);
      stack.push(childId);
    }
  }
  return result;
}

function notePathLabel(
  noteId: number,
  notes: ReadonlyMap<number, NoteSummaryDto>,
): string {
  const titles: string[] = [];
  const seen = new Set<number>();
  let current = notes.get(noteId);
  while (current && !seen.has(current.id)) {
    titles.unshift(current.title);
    seen.add(current.id);
    current = current.parentId === null ? undefined : notes.get(current.parentId);
  }
  return titles.join(" / ");
}

interface NoteDetailProps {
  detail: NoteDetailDto | null;
  importDraft: MarkdownImportDraft | null;
  draftKey: string | number;
  mode: NoteViewMode;
  folderId: number | null;
  parentId: number | null;
  folders: FolderDto[];
  notes: NoteSummaryDto[];
  templates: NoteTemplateDto[];
  searchFocus: SearchFocus<NoteSearchField> | null;
  backlinks: BacklinkDto[];
  loading?: boolean;
  onEdit: () => void;
  onCreateSubnote: () => void;
  onCancel: () => void;
  onSaved: (detail: NoteDetailDto) => Promise<void> | void;
  onDeleted: () => Promise<void> | void;
  onNavigateNote: (id: number, folderId?: number) => void;
  onCreateWikilink: (title: string, folderId: number) => Promise<void> | void;
  onDirtyChange: (dirty: boolean) => void;
  onPendingChange: (pending: boolean) => void;
  onRegisterSave: (action: (() => void) | null) => void;
  onBack: () => void;
}

export function NoteDetail({
  detail,
  importDraft,
  draftKey,
  mode,
  folderId,
  parentId,
  folders,
  notes,
  templates,
  searchFocus,
  backlinks,
  loading,
  onEdit,
  onCreateSubnote,
  onCancel,
  onSaved,
  onDeleted,
  onNavigateNote,
  onCreateWikilink,
  onDirtyChange,
  onPendingChange,
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
  const readerTriggerId = `herodotus-note-${detail?.id ?? draftKey}-reader-trigger`;

  const detailId = detail?.id;
  const detailRootRef = useRef<HTMLElement>(null);
  const searchFocusField = searchFocus?.field;
  const searchFocusQuery = searchFocus?.query;
  const focusSourceLine = useMemo(
    () => searchFocusField === "content" && searchFocusQuery !== undefined
      ? literalSourceLine(detail?.contentMd ?? "", searchFocusQuery)
      : undefined,
    [detail?.contentMd, searchFocusField, searchFocusQuery],
  );

  useEffect(() => {
    const root = detailRootRef.current;
    if (
      root === null ||
      detailId === undefined ||
      mode !== "view" ||
      searchFocusField === undefined ||
      searchFocusQuery === undefined
    ) {
      return;
    }
    const view = root.ownerDocument.defaultView;
    if (view === null) return;
    let stopFocus: (() => void) | undefined;
    const frame = view.requestAnimationFrame(() => {
      stopFocus = focusSearchMatch(
        root,
        { field: searchFocusField, query: searchFocusQuery },
        {
          title: ".document-header h1",
          tags: '.document-header [data-search-field="tags"]',
          content: ".document-content .markdown-body",
        },
      );
    });
    return () => {
      view.cancelAnimationFrame(frame);
      stopFocus?.();
    };
  }, [detailId, mode, searchFocusField, searchFocusQuery]);

  if (loading) {
    return <section className="detail-panel panel-status detail-loading" data-babel-pane="detail" tabIndex={-1}>Loading note…</section>;
  }

  if (mode === "create" || mode === "edit") {
    return (
      <NoteForm
        key={detail ? `edit-${detail.id}` : `create-${draftKey}`}
        draftKey={draftKey}
        detail={mode === "edit" ? detail : null}
        importDraft={mode === "create" ? importDraft : null}
        initialFolderId={folderId}
        initialParentId={parentId}
        folders={folders}
        notes={notes}
        templates={templates}
        onCancel={onCancel}
        onSaved={onSaved}
        onDirtyChange={onDirtyChange}
        onPendingChange={onPendingChange}
        onRegisterSave={onRegisterSave}
        resolveWikilink={resolveWikilink}
        onNavigateWikilink={navigateWikilink}
        onCreateWikilink={onCreateWikilink}
      />
    );
  }

  if (!detail) {
    return (
      <section className="detail-panel empty-state" data-babel-pane="detail" tabIndex={-1} aria-label="Note details">
        <button className="content-back" data-babel-escape="list" type="button" onClick={onBack}>
          <span aria-hidden="true">←</span> Notes
        </button>
        <span className="empty-monogram" aria-hidden="true">H</span>
        <h2>Keep history and literature close</h2>
        <p>Select a note, or choose a folder to begin a new record.</p>
      </section>
    );
  }

  return (
    <article ref={detailRootRef} className="detail-panel document-view" data-babel-pane="detail" tabIndex={-1}>
      <button className="content-back" data-babel-escape="list" type="button" onClick={onBack}>
        <span aria-hidden="true">←</span> Notes
      </button>
      <header className="document-header">
        <div>
          <DetachedReaderWindow
            title={`${detail.title} - Reader`}
            windowKey={`herodotus-note-${detail.id}`}
            buttonLabel="Read"
            buttonPortalTargetId={readerTriggerId}
          >
            {({ document: readerDocument }) => (
              <NoteReaderDraft
                title={detail.title}
                folderLabel={folderPathLabel(detail.folderId, folderMap)}
                tags={detail.tags}
                content={detail.contentMd}
                imagePreviews={EMPTY_IMAGE_PREVIEWS}
                liveDraft={false}
                ownerDocument={readerDocument}
                resolveWikilink={resolveWikilink}
                onNavigateWikilink={navigateWikilink}
              />
            )}
          </DetachedReaderWindow>
          <span className="eyebrow">{folderPathLabel(detail.folderId, folderMap) || "Note"}</span>
          <h1>{detail.title}</h1>
          <Tags tags={detail.tags} />
          <p className="document-meta">
            Updated <time dateTime={detail.updatedAt}>{formatDate(detail.updatedAt)}</time>
          </p>
        </div>
        <div className="document-actions">
          <button data-babel-child-create="" type="button" onClick={onCreateSubnote}>New subnote</button>
          <button
            data-babel-command="edit"
            type="button"
            onClick={(event) => {
              prepareDetachedEditorWindow({
                title: `${detail.title} - Editor`,
                windowKey: `herodotus-note-${detail.id}`,
                anchorElement: event.currentTarget.closest<HTMLElement>(".detail-panel"),
              });
              onEdit();
            }}
          >
            Edit
          </button>
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
          <div id={readerTriggerId} className="reader-trigger-slot" />
        </div>
      </header>

      <div className="document-outline-layout">
        <section className="document-content" aria-label="Note content">
          <MarkdownRenderer
            content={detail.contentMd}
            focusSourceLine={focusSourceLine}
            remarkFeatures={REMARK_FEATURES}
            uploadScheme="herodotus-upload"
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
  draftKey: string | number;
  detail: NoteDetailDto | null;
  importDraft: MarkdownImportDraft | null;
  initialFolderId: number | null;
  initialParentId: number | null;
  folders: FolderDto[];
  notes: NoteSummaryDto[];
  templates: NoteTemplateDto[];
  onCancel: () => void;
  onSaved: (detail: NoteDetailDto) => Promise<void> | void;
  onDirtyChange: (dirty: boolean) => void;
  onPendingChange: (pending: boolean) => void;
  onRegisterSave: (action: (() => void) | null) => void;
  resolveWikilink: (titleKey: string) => ResolvedWikilink | null;
  onNavigateWikilink: (target: ResolvedWikilink) => void;
  onCreateWikilink: (title: string, folderId: number) => Promise<void> | void;
}

function NoteForm({
  draftKey,
  detail,
  importDraft,
  initialFolderId,
  initialParentId,
  folders,
  notes,
  templates,
  onCancel,
  onSaved,
  onDirtyChange,
  onPendingChange,
  onRegisterSave,
  resolveWikilink,
  onNavigateWikilink,
  onCreateWikilink,
}: NoteFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const stagedRef = useRef<StagedImage[]>([]);
  const mountedRef = useRef(false);
  const pendingRef = useRef(false);
  const submissionGenerationRef = useRef(0);
  const initialTitle = detail?.title ?? importDraft?.title ?? "";
  const initialTags = detail?.tags.join(", ") ?? "";
  const initialContent = detail?.contentMd ?? importDraft?.contentMd ?? "";
  const initialFolder = detail?.folderId ?? initialFolderId;
  const [title, setTitle] = useState(initialTitle);
  const [tags, setTags] = useState(initialTags);
  const [content, setContent] = useState(initialContent);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [folderId, setFolderId] = useState<number | null>(initialFolder);
  const [parentId, setParentId] = useState<number | null>(initialParentId);
  const [stagedImages, setStagedImages] = useState<StagedImage[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const folderMap = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders]);
  const readerTriggerId = `herodotus-note-${detail?.id ?? draftKey}-reader-trigger`;
  const unavailableParentIds = useMemo(
    () => detail === null ? new Set<number>() : noteSubtreeIds(detail.id, notes),
    [detail, notes],
  );
  const noteMap = useMemo(
    () => new Map(notes.map((note) => [note.id, note])),
    [notes],
  );
  const parentOptions = useMemo(
    () =>
      notes
        .filter(
          (note) =>
            note.folderId === folderId && !unavailableParentIds.has(note.id),
        )
        .map((note) => ({ id: note.id, label: notePathLabel(note.id, noteMap) })),
    [folderId, noteMap, notes, unavailableParentIds],
  );
  const imagePreviews = useMemo(
    () => new Map(stagedImages.map((image) => [image.token, image.previewUrl])),
    [stagedImages],
  );
  const activeImportedReferences = useMemo(
    () => (importDraft?.imageReferences ?? []).filter((reference) =>
      content.includes(`herodotus-upload://${reference.token}`),
    ),
    [content, importDraft?.imageReferences],
  );
  const stagedTokens = useMemo(
    () => new Set(stagedImages.map((image) => image.token)),
    [stagedImages],
  );
  const unresolvedImportedImages = activeImportedReferences.filter(
    (reference) => !stagedTokens.has(reference.token),
  );
  const referencedStagedImages = stagedImages.filter((image) =>
    content.includes(`herodotus-upload://${image.token}`),
  );
  const contentBytes = utf8ByteLength(content);
  const persistedContentBytes = estimatedPersistedMarkdownBytes(content);
  const saveBytes = referencedStagedImages.reduce(
    (total, image) => total + image.file.size,
    persistedContentBytes,
  );
  const limitError = Math.max(contentBytes, persistedContentBytes) > NOTE_CONTENT_MAX_BYTES
    ? "Markdown content must not exceed 10 MB."
    : referencedStagedImages.length > NOTE_NEW_IMAGE_MAX_COUNT
      ? `A note can upload at most ${NOTE_NEW_IMAGE_MAX_COUNT} new images at once.`
      : saveBytes > NOTE_SAVE_MAX_BYTES
        ? "Markdown and new images must not exceed 100 MB in one save."
        : "";
  const saveBlockMessage = unresolvedImportedImages.length > 0
    ? "Match or remove every imported local image before saving."
    : limitError;
  const dirty =
    importDraft !== null ||
    title !== initialTitle ||
    tags !== initialTags ||
    content !== initialContent ||
    folderId !== initialFolder ||
    parentId !== initialParentId ||
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
    mountedRef.current = true;
    onPendingChange(false);
    return () => {
      mountedRef.current = false;
      pendingRef.current = false;
      submissionGenerationRef.current += 1;
      onPendingChange(false);
    };
  }, [onPendingChange]);

  useEffect(() => {
    return () => {
      onDirtyChange(false);
      for (const image of stagedRef.current) URL.revokeObjectURL(image.previewUrl);
    };
  }, [onDirtyChange]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current) return;
    if (folderId === null) {
      setError("Select a folder before saving this note.");
      return;
    }
    if (saveBlockMessage) {
      setError(saveBlockMessage);
      return;
    }

    const submissionGeneration = submissionGenerationRef.current + 1;
    submissionGenerationRef.current = submissionGeneration;
    pendingRef.current = true;
    setPending(true);
    onPendingChange(true);
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
      if (
        !mountedRef.current ||
        submissionGenerationRef.current !== submissionGeneration
      ) {
        return;
      }
      for (const image of stagedRef.current) URL.revokeObjectURL(image.previewUrl);
      stagedRef.current = [];
      setStagedImages([]);
      setTitle(saved.title);
      setTags(saved.tags.join(", "));
      setContent(saved.contentMd);
      setFolderId(saved.folderId);
      setParentId(saved.parentId);
      onDirtyChange(false);
      await onSaved(saved);
    } catch (caught) {
      if (
        mountedRef.current &&
        submissionGenerationRef.current === submissionGeneration
      ) {
        setError(getErrorMessage(caught));
      }
    } finally {
      if (submissionGenerationRef.current === submissionGeneration) {
        pendingRef.current = false;
        onPendingChange(false);
        if (mountedRef.current) setPending(false);
      }
    }
  }

  function changeContent(nextContent: string) {
    if (pendingRef.current) return;
    setContent(nextContent);
    setStagedImages((current) => {
      const retained = current.filter((image) => {
        const referenced = nextContent.includes(`herodotus-upload://${image.token}`);
        if (!referenced) URL.revokeObjectURL(image.previewUrl);
        return referenced;
      });
      return retained.length === current.length ? current : retained;
    });
  }

  function selectTemplate(value: string) {
    if (pendingRef.current || detail !== null || importDraft !== null) return;
    const template = value
      ? templates.find((candidate) => candidate.id === Number(value))
      : undefined;
    const nextContent = template?.contentMd ?? "";
    if (
      nextContent !== content &&
      (content.length > 0 || stagedImages.length > 0) &&
      !window.confirm("Replace the current draft content with this template?")
    ) {
      return;
    }
    setSelectedTemplateId(value);
    changeContent(nextContent);
  }

  function resolveImportedImages(images: readonly StagedImage[]) {
    if (pendingRef.current) return;
    setStagedImages((current) => {
      const replacements = new Map(images.map((image) => [image.token, image]));
      const next: StagedImage[] = [];
      for (const image of current) {
        const replacement = replacements.get(image.token);
        if (replacement === undefined) {
          next.push(image);
          continue;
        }
        if (replacement.previewUrl !== image.previewUrl) {
          URL.revokeObjectURL(image.previewUrl);
        }
      }
      next.push(...replacements.values());
      return next;
    });
  }

  async function createFromWikilink(wikilink: Wikilink) {
    if (pendingRef.current) return;
    const title = wikilink.titleRaw.trim().replace(/\s+/gu, " ");
    if (folderId === null || !title) return;
    if (!window.confirm(`Create note “${title}”?`)) return;

    const operationGeneration = submissionGenerationRef.current + 1;
    submissionGenerationRef.current = operationGeneration;
    pendingRef.current = true;
    setPending(true);
    try {
      const creation = onCreateWikilink(title, folderId);
      await creation;
    } catch (caught) {
      if (
        mountedRef.current &&
        submissionGenerationRef.current === operationGeneration
      ) {
        setError(getErrorMessage(caught));
      }
    } finally {
      if (submissionGenerationRef.current === operationGeneration) {
        pendingRef.current = false;
        if (mountedRef.current) setPending(false);
      }
    }
  }

  const editorLayout = (
    <div className="editor-outline-layout">
      <MarkdownEditor
        label="Content"
        name="contentMd"
        value={content}
        disabled={pending}
        imagePreviews={imagePreviews}
        onChange={changeContent}
        onImageError={setError}
        onStageImage={(image) => {
          if (!pendingRef.current) {
            setStagedImages((current) => [...current, image]);
          }
        }}
        resolveWikilink={resolveWikilink}
        onNavigateWikilink={onNavigateWikilink}
        onCreateFromWikilink={createFromWikilink}
        textareaRef={textareaRef}
        headingIdPrefix={NOTE_HEADING_ID_PREFIX}
      />
      <OutlinePanel
        content={content}
        mode="edit"
        textareaRef={textareaRef}
        headingIdPrefix={NOTE_HEADING_ID_PREFIX}
      />
    </div>
  );

  return (
    <section className="detail-panel form-view" data-babel-pane="detail" tabIndex={-1}>
      <form ref={formRef} onSubmit={submit}>
        <header className="document-header form-header">
          <div>
            <DetachedReaderWindow
              title={`${title.trim() || "Untitled note"} - Reader`}
              windowKey={`herodotus-note-${detail?.id ?? draftKey}`}
              buttonLabel="Read"
              buttonPortalTargetId={readerTriggerId}
              disabled={pending}
            >
              {({ document: readerDocument }) => (
                <NoteReaderDraft
                  title={title}
                  folderLabel={folderId === null ? "" : folderPathLabel(folderId, folderMap)}
                  tags={parseTags(tags)}
                  content={content}
                  imagePreviews={imagePreviews}
                  liveDraft={true}
                  ownerDocument={readerDocument}
                  resolveWikilink={resolveWikilink}
                  onNavigateWikilink={onNavigateWikilink}
                />
              )}
            </DetachedReaderWindow>
            <span className="eyebrow">
              {detail ? "Edit note" : importDraft ? "Import Markdown" : "New note"}
            </span>
            <h1>
              {detail ? detail.title : importDraft ? importDraft.title : "Begin a new record"}
            </h1>
          </div>
          <div className="document-actions">
            <button data-babel-command="cancel" type="button" disabled={pending} onClick={onCancel}>Cancel</button>
            <button
              data-babel-command="save"
              className="primary-button"
              type="submit"
              disabled={pending || folderId === null || !title.trim() || Boolean(saveBlockMessage)}
              title={saveBlockMessage || "Save note"}
            >
              {pending ? "Saving…" : "Save"}
            </button>
            <div id={readerTriggerId} className="reader-trigger-slot" />
          </div>
        </header>

        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {!error && limitError ? <p className="form-error" role="alert">{limitError}</p> : null}

        <div className="form-row form-columns">
          {detail === null && importDraft === null ? (
            <label className="field template-field">
              <span>Template</span>
              <select
                name="templateId"
                disabled={pending}
                value={selectedTemplateId}
                onChange={(event) => selectTemplate(event.target.value)}
              >
                <option value="">No template</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>{template.name}</option>
                ))}
              </select>
              <small>Copies the template Markdown into this note without linking them.</small>
            </label>
          ) : null}
          <label className="field title-field">
            <span>Title</span>
            <input
              autoFocus
              name="title"
              autoComplete="off"
              required
              maxLength={240}
              disabled={pending}
              value={title}
              placeholder="A clear title for this note"
              onChange={(event) => {
                if (!pendingRef.current) setTitle(event.target.value);
              }}
            />
          </label>
          <div className="field">
            <span>Folder</span>
            <FolderPicker
              name="folderId"
              label="Folder"
              folders={folders}
              required
              disabled={pending}
              value={folderId}
              onChange={(nextFolderId) => {
                setFolderId(nextFolderId);
                setParentId(null);
              }}
            />
          </div>
          <label className="field">
            <span>Parent page</span>
            <select
              name="parentId"
              disabled={pending || folderId === null}
              value={parentId ?? ""}
              onChange={(event) => {
                if (!pendingRef.current) {
                  setParentId(event.target.value ? Number(event.target.value) : null);
                }
              }}
            >
              <option value="">No parent (root page)</option>
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
              disabled={pending}
              value={tags}
              placeholder="ancient history, Homer, tragedy"
              onChange={(event) => {
                if (!pendingRef.current) setTags(event.target.value);
              }}
            />
            <small>Separate tags with commas. Matching is case-insensitive.</small>
          </label>
        </div>

        <ImportedImageMatcher
          references={activeImportedReferences}
          stagedImages={stagedImages}
          disabled={pending}
          onResolve={resolveImportedImages}
          onError={setError}
        />

        {detail ? (
          <DetachedEditorWindow
            title={`${title.trim() || "Untitled note"} - Editor`}
            windowKey={`herodotus-note-${detail.id}`}
            disabled={pending}
            onSave={() => formRef.current?.requestSubmit()}
          >
            {editorLayout}
          </DetachedEditorWindow>
        ) : editorLayout}
        <p className="editor-footnote">
          Images remain in this browser until you save the note.
        </p>
      </form>
    </section>
  );
}
