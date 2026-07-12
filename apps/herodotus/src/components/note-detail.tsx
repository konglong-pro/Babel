"use client";

import {
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { ImportedImageMatcher } from "@/components/imported-image-matcher";
import { MarkdownEditor, MarkdownRenderer, type StagedImage } from "@/components/markdown";
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
import type { FolderDto, NoteDetailDto } from "@/lib/types";

export type NoteViewMode = "view" | "edit" | "create";

const PENDING_IMAGE_URL_PATTERN = /herodotus-upload:\/\/[A-Za-z0-9._-]+/g;
const MAX_MANAGED_IMAGE_URL =
  "/api/uploads/notes/00000000-0000-0000-0000-000000000000.webp";

function estimatedPersistedMarkdownBytes(contentMd: string): number {
  return utf8ByteLength(
    contentMd.replace(PENDING_IMAGE_URL_PATTERN, MAX_MANAGED_IMAGE_URL),
  );
}

interface NoteDetailProps {
  detail: NoteDetailDto | null;
  importDraft: MarkdownImportDraft | null;
  draftKey: number;
  mode: NoteViewMode;
  folderId: number | null;
  folders: FolderDto[];
  loading?: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSaved: (detail: NoteDetailDto) => Promise<void> | void;
  onDeleted: () => Promise<void> | void;
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
  folders,
  loading,
  onEdit,
  onCancel,
  onSaved,
  onDeleted,
  onDirtyChange,
  onPendingChange,
  onRegisterSave,
  onBack,
}: NoteDetailProps) {
  const folderMap = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders]);

  if (loading) {
    return <section className="detail-panel panel-status detail-loading">Loading note…</section>;
  }

  if (mode === "create" || mode === "edit") {
    return (
      <NoteForm
        key={detail ? `edit-${detail.id}` : `create-${draftKey}`}
        detail={mode === "edit" ? detail : null}
        importDraft={mode === "create" ? importDraft : null}
        initialFolderId={folderId}
        folders={folders}
        onCancel={onCancel}
        onSaved={onSaved}
        onDirtyChange={onDirtyChange}
        onPendingChange={onPendingChange}
        onRegisterSave={onRegisterSave}
      />
    );
  }

  if (!detail) {
    return (
      <section className="detail-panel empty-state" aria-label="Note details">
        <button className="content-back" type="button" onClick={onBack}>
          <span aria-hidden="true">←</span> Notes
        </button>
        <span className="empty-monogram" aria-hidden="true">H</span>
        <h2>Keep history and literature close</h2>
        <p>Select a note, or choose a folder to begin a new record.</p>
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

      <section className="document-content" aria-label="Note content">
        <MarkdownRenderer content={detail.contentMd} />
      </section>
    </article>
  );
}

interface NoteFormProps {
  detail: NoteDetailDto | null;
  importDraft: MarkdownImportDraft | null;
  initialFolderId: number | null;
  folders: FolderDto[];
  onCancel: () => void;
  onSaved: (detail: NoteDetailDto) => Promise<void> | void;
  onDirtyChange: (dirty: boolean) => void;
  onPendingChange: (pending: boolean) => void;
  onRegisterSave: (action: (() => void) | null) => void;
}

function NoteForm({
  detail,
  importDraft,
  initialFolderId,
  folders,
  onCancel,
  onSaved,
  onDirtyChange,
  onPendingChange,
  onRegisterSave,
}: NoteFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
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
  const [folderId, setFolderId] = useState<number | null>(initialFolder);
  const [stagedImages, setStagedImages] = useState<StagedImage[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const folderMap = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders]);
  const folderOptions = useMemo(
    () => folders.map((folder) => ({ id: folder.id, label: folderPathLabel(folder.id, folderMap) })),
    [folderMap, folders],
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

  return (
    <section className="detail-panel form-view">
      <form ref={formRef} onSubmit={submit}>
        <header className="document-header form-header">
          <div>
            <span className="eyebrow">
              {detail ? "Edit note" : importDraft ? "Import Markdown" : "New note"}
            </span>
            <h1>
              {detail ? detail.title : importDraft ? importDraft.title : "Begin a new record"}
            </h1>
          </div>
          <div className="document-actions">
            <button type="button" disabled={pending} onClick={onCancel}>Cancel</button>
            <button
              className="primary-button"
              type="submit"
              disabled={pending || folderId === null || !title.trim() || Boolean(saveBlockMessage)}
              title={saveBlockMessage || "Save note (Ctrl/Cmd+S)"}
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </header>

        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {!error && limitError ? <p className="form-error" role="alert">{limitError}</p> : null}

        <div className="form-row form-columns">
          <label className="field title-field">
            <span>Title</span>
            <input
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
          <label className="field">
            <span>Folder</span>
            <select
              name="folderId"
              required
              disabled={pending}
              value={folderId ?? ""}
              onChange={(event) => {
                if (!pendingRef.current) {
                  setFolderId(event.target.value ? Number(event.target.value) : null);
                }
              }}
            >
              <option value="" disabled>Select a folder</option>
              {folderOptions.map((folder) => (
                <option key={folder.id} value={folder.id}>{folder.label}</option>
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
        />
        <p className="editor-footnote">Images remain in this browser until you save the note.</p>
      </form>
    </section>
  );
}
