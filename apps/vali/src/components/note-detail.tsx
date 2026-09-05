"use client";

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
  useCallback,
  type FormEvent,
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
import { documentSaveLimitError } from "@/lib/note-limits";
import { focusValiSearchMatch } from "@/lib/search-focus.client";
import {
  valiSearchFocusSourceLine,
  type ValiSearchFocus,
} from "@/lib/search-focus";
import type {
  DocumentBacklinkDto,
  FolderDto,
  NoteDetailDto,
  NoteSummaryDto,
  NoteTemplateDto,
} from "@/lib/types";

const NOTE_HEADING_ID_PREFIX = "vali-note-heading-";
const REMARK_FEATURES = ["gfm", "formula-math"] as const;
const EMPTY_IMAGE_PREVIEWS: ReadonlyMap<string, string> = new Map();
type ValiResolvedWikilink = ResolvedWikilink & { date?: string };

interface NoteReaderDraftProps {
  title: string;
  folderLabel: string;
  tags: string[];
  content: string;
  imagePreviews: ReadonlyMap<string, string>;
  live: boolean;
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
  live,
  ownerDocument,
  resolveWikilink,
  onNavigateWikilink,
}: NoteReaderDraftProps) {
  const headingIdPrefix = `${NOTE_HEADING_ID_PREFIX}reader-`;
  return (
    <article className="document-view" aria-label={live ? "Live note reader" : "Note reader"}>
      <header className="document-header">
        <div>
          <span className="eyebrow">{folderLabel || "Draft note"}</span>
          <h1>{title.trim() || "Untitled note"}</h1>
          <Tags tags={tags} />
          {live ? <p className="document-meta">Live draft. Save changes in the editor.</p> : null}
        </div>
      </header>
      <div className="document-outline-layout">
        <section className="document-content" aria-label="Note content">
          <MarkdownRenderer
            content={content}
            imagePreviews={imagePreviews}
            remarkFeatures={REMARK_FEATURES}
            uploadScheme="vali-upload"
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

export type NoteViewMode = "view" | "edit" | "create";

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
  searchFocus: ValiSearchFocus | null;
  backlinks: DocumentBacklinkDto[];
  loading?: boolean;
  onEdit: () => void;
  onCreateSubnote: () => void;
  onCancel: () => void;
  onSaved: (detail: NoteDetailDto) => Promise<void> | void;
  onDeleted: () => Promise<void> | void;
  onNavigateNote: (id: number, folderId?: number) => void;
  onNavigateReflection: (date: string) => void;
  onCreateWikilink: (title: string, folderId: number) => Promise<void> | void;
  onDirtyChange: (dirty: boolean) => void;
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
  onNavigateReflection,
  onCreateWikilink,
  onDirtyChange,
  onRegisterSave,
  onBack,
}: NoteDetailProps) {
  const folderMap = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders]);
  const wikilinkTargets = useMemo(() => {
    const entries: Array<[string, ValiResolvedWikilink]> = [];
    for (const link of detail?.links ?? []) {
      if (link.targetKind === "reflection" && link.targetDate) {
        entries.push([link.titleKey, {
          id: Number(link.targetDate.replaceAll("-", "")),
          kind: "reflection",
          date: link.targetDate,
        }]);
      } else if (link.targetId !== null) {
        entries.push([link.titleKey, { id: link.targetId, kind: "note" }]);
      }
    }
    return new Map(entries);
  }, [detail?.links]);
  const resolveWikilink = useCallback(
    (titleKey: string): ResolvedWikilink | null => wikilinkTargets.get(titleKey) ?? null,
    [wikilinkTargets],
  );
  const navigateWikilink = useCallback(
    (target: ResolvedWikilink) => {
      const date = "date" in target && typeof target.date === "string"
        ? target.date
        : null;
      if (target.kind === "reflection" && date) {
        onNavigateReflection(date);
        return;
      }
      onNavigateNote(target.id);
    },
    [onNavigateNote, onNavigateReflection],
  );
  const createFromWikilink = useCallback((wikilink: Wikilink) => {
    const targetFolderId = detail?.folderId ?? folderId;
    const title = wikilink.titleRaw.trim().replace(/\s+/gu, " ");
    if (targetFolderId === null || !title) return;
    if (!window.confirm(`Create note “${title}”?`)) return;
    void onCreateWikilink(title, targetFolderId);
  }, [detail?.folderId, folderId, onCreateWikilink]);
  const readerTriggerId = `vali-note-${detail?.id ?? draftKey}-reader-trigger`;
  const detailId = detail?.id;
  const detailRootRef = useRef<HTMLElement>(null);
  const searchFocusField = searchFocus?.field;
  const searchFocusQuery = searchFocus?.query;
  const searchFocusSourceLine = useMemo(
    () => valiSearchFocusSourceLine(
      detail?.contentMd ?? "",
      searchFocusField === undefined || searchFocusQuery === undefined
        ? null
        : { field: searchFocusField, query: searchFocusQuery },
    ),
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
      stopFocus = focusValiSearchMatch(root, {
        field: searchFocusField,
        query: searchFocusQuery,
      });
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
    <article ref={detailRootRef} className="detail-panel document-view" data-babel-pane="detail" tabIndex={-1}>
        <button className="content-back" data-babel-escape="list" type="button" onClick={onBack}>
        <span aria-hidden="true">←</span> Notes
      </button>
      <header className="document-header">
        <div>
          <DetachedReaderWindow
            title={`${detail.title} - Reader`}
            windowKey={`vali-note-${detail.id}`}
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
                live={false}
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
          <button
            data-babel-child-create=""
            type="button"
            onClick={onCreateSubnote}
          >
            New subnote
          </button>
          <button
            data-babel-command="edit"
            type="button"
            onClick={(event) => {
              prepareDetachedEditorWindow({
                title: `${detail.title} - Editor`,
                windowKey: `vali-note-${detail.id}`,
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
            remarkFeatures={REMARK_FEATURES}
            uploadScheme="vali-upload"
            resolveWikilink={resolveWikilink}
            onNavigateWikilink={navigateWikilink}
            onCreateFromWikilink={createFromWikilink}
            headingIdPrefix={NOTE_HEADING_ID_PREFIX}
            focusSourceLine={searchFocusSourceLine}
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
              <li key={backlink.kind === "note" ? `note:${backlink.id}` : `reflection:${backlink.date}`}>
                <button
                  type="button"
                  onClick={() => {
                    if (backlink.kind === "reflection") {
                      onNavigateReflection(backlink.date);
                    } else {
                      onNavigateNote(backlink.id, backlink.folderId);
                    }
                  }}
                >
                  <span className="linked-kind">{backlink.kind}</span> {backlink.title}
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
  onRegisterSave,
  resolveWikilink,
  onNavigateWikilink,
  onCreateWikilink,
}: NoteFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const stagedRef = useRef<StagedImage[]>([]);
  const initialTitle = detail?.title ?? importDraft?.title ?? "";
  const initialTags = detail?.tags.join(", ") ?? "";
  const initialContent = detail?.contentMd ?? importDraft?.contentMd ?? "";
  const initialFolder = detail?.folderId ?? initialFolderId;
  const initialParent = detail?.parentId ?? initialParentId;
  const [title, setTitle] = useState(initialTitle);
  const [tags, setTags] = useState(initialTags);
  const [content, setContent] = useState(initialContent);
  const [folderId, setFolderId] = useState<number | null>(initialFolder);
  const [parentId, setParentId] = useState<number | null>(initialParent);
  const [templateId, setTemplateId] = useState("");
  const [stagedImages, setStagedImages] = useState<StagedImage[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const folderMap = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders]);
  const readerTriggerId = `vali-note-${detail?.id ?? draftKey}-reader-trigger`;
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
  const activeImportedReferences = useMemo(
    () => (importDraft?.imageReferences ?? []).filter((reference) =>
      content.includes(`vali-upload://${reference.token}`),
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
  const limitError = documentSaveLimitError(content, stagedImages);
  const saveBlockMessage = unresolvedImportedImages.length > 0
    ? "Match or remove every imported local image before saving."
    : limitError;
  const dirty =
    importDraft !== null ||
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
    if (saveBlockMessage) {
      setError(saveBlockMessage);
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
      setError(getErrorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  function changeContent(nextContent: string) {
    setContent(nextContent);
    setStagedImages((current) => {
      const retained = current.filter((image) => {
        const referenced = nextContent.includes(`vali-upload://${image.token}`);
        if (!referenced) URL.revokeObjectURL(image.previewUrl);
        return referenced;
      });
      return retained.length === current.length ? current : retained;
    });
  }

  function applyTemplate(nextTemplateId: string) {
    if (pending) return;
    const template = templates.find(({ id }) => String(id) === nextTemplateId);
    const nextContent = template?.contentMd ?? "";
    if (
      content !== initialContent &&
      content !== nextContent &&
      !window.confirm("Replace the current note content with this template?")
    ) {
      return;
    }
    setTemplateId(nextTemplateId);
    changeContent(nextContent);
  }

  function resolveImportedImages(images: readonly StagedImage[]) {
    if (pending) return;
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

  const contentEditor = (
    <div className="editor-outline-layout">
      <MarkdownEditor
        label="Content"
        name="contentMd"
        value={content}
        disabled={pending}
        imagePreviews={imagePreviews}
        onChange={changeContent}
        onImageError={setError}
        onStageImage={(image) => setStagedImages((current) => [...current, image])}
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
              windowKey={`vali-note-${detail?.id ?? draftKey}`}
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
                  live
                  ownerDocument={readerDocument}
                  resolveWikilink={resolveWikilink}
                  onNavigateWikilink={onNavigateWikilink}
                />
              )}
            </DetachedReaderWindow>
            <span className="eyebrow">
              {detail ? "Edit note" : importDraft ? "Import Markdown" : "New note"}
            </span>
            <h1>{detail ? detail.title : importDraft?.title ?? "Capture what you learned"}</h1>
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
          <label className="field title-field">
            <span>Title</span>
            <input
              autoFocus
              name="title"
              autoComplete="off"
              disabled={pending}
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
              disabled={pending}
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
              disabled={pending}
              value={parentId ?? ""}
              onChange={(event) => setParentId(event.target.value ? Number(event.target.value) : null)}
            >
              <option value="">Root page</option>
              {parentOptions.map((note) => (
                <option key={note.id} value={note.id}>{note.label}</option>
              ))}
            </select>
          </label>
          {!detail && !importDraft ? (
            <label className="field">
              <span>Template</span>
              <select
                name="templateId"
                disabled={pending}
                value={templateId}
                onChange={(event) => applyTemplate(event.target.value)}
              >
                <option value="">No template</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>{template.name}</option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="field tags-field">
            <span>Tags</span>
            <input
              name="tags"
              autoComplete="off"
              disabled={pending}
              value={tags}
              placeholder="phrasal verbs, travel, review"
              onChange={(event) => setTags(event.target.value)}
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
            windowKey={`vali-note-${detail.id}`}
            disabled={pending}
            onSave={() => formRef.current?.requestSubmit()}
          >
            {contentEditor}
          </DetachedEditorWindow>
        ) : contentEditor}
        <p className="editor-footnote">
          Images remain in this browser until you save the note.
        </p>
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
