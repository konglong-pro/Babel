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
import { entryUnitLabel } from "@/lib/entry-routes";
import {
  ENTRY_CODE_MAX_BYTES,
  ENTRY_NEW_IMAGE_MAX_COUNT,
  ENTRY_NOTES_MAX_BYTES,
  ENTRY_SAVE_MAX_BYTES,
  utf8ByteLength,
} from "@/lib/entry-limits";
import type { MarkdownImportDraft } from "@/lib/markdown-import";
import type {
  EntryBacklinkDto,
  EntryDetailDto,
  EntryKind,
  EntrySummaryDto,
  FolderDto,
} from "@/lib/types";

export type EntryViewMode = "view" | "edit" | "create";

const ENTRY_HEADING_ID_PREFIX = "neum-entry-heading-";
const REMARK_FEATURES = ["gfm", "typst-math"] as const;
const EMPTY_IMAGE_PREVIEWS: ReadonlyMap<string, string> = new Map();
const PENDING_IMAGE_URL_PATTERN = /neum-upload:\/\/[A-Za-z0-9._-]+/g;
const MAX_MANAGED_IMAGE_URL =
  "/api/uploads/entries/00000000-0000-0000-0000-000000000000.webp";

function estimatedPersistedMarkdownBytes(notesMd: string): number {
  return utf8ByteLength(
    notesMd.replace(PENDING_IMAGE_URL_PATTERN, MAX_MANAGED_IMAGE_URL),
  );
}

interface EntryReaderDraftProps {
  kind: EntryKind;
  title: string;
  folderLabel: string;
  tags: string[];
  notesMd: string;
  imagePreviews: ReadonlyMap<string, string>;
  language: string;
  filename: string;
  code: string;
  live: boolean;
  ownerDocument: Document;
  resolveWikilink: (titleKey: string) => ResolvedWikilink | null;
  onNavigateWikilink: (target: ResolvedWikilink) => void;
}

function EntryReaderDraft({
  kind,
  title,
  folderLabel,
  tags,
  notesMd,
  imagePreviews,
  language,
  filename,
  code,
  live,
  ownerDocument,
  resolveWikilink,
  onNavigateWikilink,
}: EntryReaderDraftProps) {
  const headingIdPrefix = `${ENTRY_HEADING_ID_PREFIX}reader-`;
  return (
    <article className="document-view" aria-label={live ? "Live entry reader" : "Entry reader"}>
      <header className="document-header">
        <div>
          <span className="eyebrow">{folderLabel || entryKindLabel(kind)}</span>
          <p className="entry-kind document-kind">{entryKindLabel(kind)}</p>
          <h1>{title.trim() || "Untitled entry"}</h1>
          <Tags tags={tags} />
          {live ? <p className="document-meta">Live draft. Save changes in the editor.</p> : null}
        </div>
      </header>
      <div className="document-outline-layout">
        <section className="document-content" aria-label="Entry content">
          {notesMd ? (
            <MarkdownRenderer
              content={notesMd}
              imagePreviews={imagePreviews}
              remarkFeatures={REMARK_FEATURES}
              uploadScheme="neum-upload"
              resolveWikilink={resolveWikilink}
              onNavigateWikilink={onNavigateWikilink}
              headingIdPrefix={headingIdPrefix}
            />
          ) : (
            <p className="empty-copy">No explanatory notes yet.</p>
          )}
          {kind === "snippet" ? (
            <section className="snippet-view" aria-label="Code snippet">
              <p className="code-meta">
                <strong>{language.trim() || "Unspecified language"}</strong>
                {filename.trim() ? <span>{filename}</span> : null}
              </p>
              <pre className="code-block"><code>{code}</code></pre>
            </section>
          ) : null}
        </section>
        <OutlinePanel
          content={notesMd}
          mode="read"
          ownerDocument={ownerDocument}
          headingIdPrefix={headingIdPrefix}
        />
      </div>
    </article>
  );
}

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
  kind: EntryKind;
  detail: EntryDetailDto | null;
  importDraft: MarkdownImportDraft | null;
  draftKey: number;
  mode: EntryViewMode;
  folderId: number | null;
  parentId: number | null;
  folders: FolderDto[];
  entries: readonly EntrySummaryDto[];
  backlinks: EntryBacklinkDto[];
  loading?: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSaved: (detail: EntryDetailDto) => Promise<void> | void;
  onDeleted: () => Promise<void> | void;
  onNavigateEntry: (
    id: number,
    kind: EntryKind,
    folderId?: number,
    exactFolder?: boolean,
  ) => void;
  onCreateWikilink?: (title: string, folderId: number) => Promise<void> | void;
  onDirtyChange: (dirty: boolean) => void;
  onRegisterSave: (action: (() => void) | null) => void;
  onBack: () => void;
}

export function EntryDetail({
  kind,
  detail,
  importDraft,
  draftKey,
  mode,
  folderId,
  parentId,
  folders,
  entries,
  backlinks,
  loading,
  onEdit,
  onCancel,
  onSaved,
  onDeleted,
  onNavigateEntry,
  onCreateWikilink,
  onDirtyChange,
  onRegisterSave,
  onBack,
}: EntryDetailProps) {
  const folderMap = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder])),
    [folders],
  );
  const wikilinkTargets = useMemo(() => {
    const targets = new Map<string, ResolvedWikilink>();
    for (const link of detail?.links ?? []) {
      if (link.targetId === null || link.targetKind === null) continue;
      targets.set(link.titleKey, { id: link.targetId, kind: link.targetKind });
    }
    return targets;
  }, [detail?.links]);
  const resolveWikilink = useCallback(
    (titleKey: string): ResolvedWikilink | null => wikilinkTargets.get(titleKey) ?? null,
    [wikilinkTargets],
  );
  const navigateWikilink = useCallback((target: ResolvedWikilink) => {
    if (target.kind !== "knowledge" && target.kind !== "snippet") return;
    onNavigateEntry(target.id, target.kind, undefined, true);
  }, [onNavigateEntry]);
  const createFromWikilink = useCallback((wikilink: Wikilink) => {
    if (onCreateWikilink === undefined) return;
    const targetFolderId = detail?.folderId ?? folderId;
    const title = wikilink.titleRaw.trim().replace(/\s+/gu, " ");
    if (targetFolderId === null || !title) return;
    if (!window.confirm(`Create entry “${title}”?`)) return;
    void onCreateWikilink(title, targetFolderId);
  }, [detail?.folderId, folderId, onCreateWikilink]);

  if (loading) {
    return <section className="detail-panel panel-status detail-loading">Loading entry…</section>;
  }

  if (mode === "create" || mode === "edit") {
    return (
      <EntryForm
        key={mode === "edit"
          ? `edit-${detail?.id ?? "missing"}-${detail?.version ?? 0}`
          : `new-${folderId}-${parentId ?? "root"}-${draftKey}`}
        detail={mode === "edit" ? detail : null}
        importDraft={mode === "create" ? importDraft : null}
        kind={kind}
        initialFolderId={folderId}
        initialParentId={parentId}
        folders={folders}
        entries={entries}
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
      <section className="detail-panel empty-state" aria-label="Entry details">
        <button className="content-back" type="button" onClick={onBack}>
          <span aria-hidden="true">←</span> {entryUnitLabel(kind)}
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
        <span aria-hidden="true">←</span> {entryUnitLabel(kind)}
      </button>
      <header className="document-header">
        <div>
          <DetachedReaderWindow
            title={`${detail.title} - Reader`}
            windowKey={`neum-${detail.kind}-${detail.id}`}
            buttonLabel="Read"
            buttonPortalTargetId="babel-detached-reader-trigger-target"
          >
            {({ document: readerDocument }) => (
              <EntryReaderDraft
                kind={detail.kind}
                title={detail.title}
                folderLabel={folderPathLabel(detail.folderId, folderMap)}
                tags={detail.tags}
                notesMd={detail.notesMd}
                imagePreviews={EMPTY_IMAGE_PREVIEWS}
                language={detail.language ?? ""}
                filename={detail.filename ?? ""}
                code={detail.code ?? ""}
                live={false}
                ownerDocument={readerDocument}
                resolveWikilink={resolveWikilink}
                onNavigateWikilink={navigateWikilink}
              />
            )}
          </DetachedReaderWindow>
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
          <button
            data-babel-command="edit"
            type="button"
            onClick={(event) => {
              prepareDetachedEditorWindow({
                title: `${detail.title} - Editor`,
                windowKey: `neum-${detail.kind}-${detail.id}`,
                anchorElement: event.currentTarget.closest<HTMLElement>(".detail-panel"),
              });
              onEdit();
            }}
          >
            Edit
          </button>
          <ConfirmButton
            className="danger-ghost"
            title="Delete entry permanently"
            description={`Permanently delete "${detail.title}"? This cannot be undone.`}
            confirmLabel="Delete permanently"
            onConfirm={async () => {
              await deleteEntry(detail.id, detail.version);
              await onDeleted();
            }}
          >
            Delete
          </ConfirmButton>
        </div>
      </header>

      <div className="document-outline-layout">
        <section className="document-content" aria-label="Entry content">
          {detail.notesMd ? (
            <MarkdownRenderer
              content={detail.notesMd}
              remarkFeatures={REMARK_FEATURES}
              uploadScheme="neum-upload"
              resolveWikilink={resolveWikilink}
              onNavigateWikilink={navigateWikilink}
              onCreateFromWikilink={onCreateWikilink === undefined ? undefined : createFromWikilink}
              headingIdPrefix={ENTRY_HEADING_ID_PREFIX}
            />
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
        <OutlinePanel
          content={detail.notesMd}
          mode="read"
          headingIdPrefix={ENTRY_HEADING_ID_PREFIX}
        />
      </div>
      <section className="linked-mentions" aria-labelledby="linked-mentions-heading">
        <h2 id="linked-mentions-heading">Linked mentions ({backlinks.length})</h2>
        {backlinks.length === 0 ? (
          <p className="empty-copy">No entries link here yet.</p>
        ) : (
          <ul>
            {backlinks.map((backlink) => (
              <li key={backlink.id}>
                <button
                  type="button"
                  onClick={() => onNavigateEntry(
                    backlink.id,
                    backlink.kind,
                    backlink.folderId,
                    true,
                  )}
                >
                  <span>{backlink.title}</span>
                  <small>{entryKindLabel(backlink.kind)}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}

interface EntryFormProps {
  kind: EntryKind;
  detail: EntryDetailDto | null;
  importDraft: MarkdownImportDraft | null;
  initialFolderId: number | null;
  initialParentId: number | null;
  folders: FolderDto[];
  entries: readonly EntrySummaryDto[];
  onCancel: () => void;
  onSaved: (detail: EntryDetailDto) => Promise<void> | void;
  onDirtyChange: (dirty: boolean) => void;
  onRegisterSave: (action: (() => void) | null) => void;
  resolveWikilink: (titleKey: string) => ResolvedWikilink | null;
  onNavigateWikilink: (target: ResolvedWikilink) => void;
  onCreateWikilink?: (title: string, folderId: number) => Promise<void> | void;
}

function EntryForm({
  kind,
  detail,
  importDraft,
  initialFolderId,
  initialParentId,
  folders,
  entries,
  onCancel,
  onSaved,
  onDirtyChange,
  onRegisterSave,
  resolveWikilink,
  onNavigateWikilink,
  onCreateWikilink,
}: EntryFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const stagedRef = useRef<StagedImage[]>([]);
  const initialTitle = detail?.title ?? importDraft?.title ?? "";
  const initialTags = detail?.tags.join(", ") ?? "";
  const initialNotes = detail?.notesMd ?? importDraft?.contentMd ?? "";
  const initialCode = detail?.code ?? "";
  const initialLanguage = detail?.language ?? "";
  const initialFilename = detail?.filename ?? "";
  const initialFolder = detail?.folderId ?? initialFolderId;
  const initialParent = detail?.parentId ?? initialParentId;
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
            entry.kind === kind &&
            entry.id !== detail?.id &&
            !unavailableParentIds.has(entry.id),
        )
        .map((entry) => ({ id: entry.id, label: entryPathLabel(entry.id, entryMap) })),
    [detail?.id, entries, entryMap, folderId, kind, unavailableParentIds],
  );
  const imagePreviews = useMemo(
    () => new Map(stagedImages.map((image) => [image.token, image.previewUrl])),
    [stagedImages],
  );
  const activeImportedReferences = useMemo(
    () => (importDraft?.imageReferences ?? []).filter((reference) =>
      notesMd.includes(`neum-upload://${reference.token}`),
    ),
    [importDraft?.imageReferences, notesMd],
  );
  const stagedTokens = useMemo(
    () => new Set(stagedImages.map((image) => image.token)),
    [stagedImages],
  );
  const unresolvedImportedImages = activeImportedReferences.filter(
    (reference) => !stagedTokens.has(reference.token),
  );
  const referencedStagedImages = stagedImages.filter((image) =>
    notesMd.includes(`neum-upload://${image.token}`),
  );
  const notesBytes = utf8ByteLength(notesMd);
  const persistedNotesBytes = estimatedPersistedMarkdownBytes(notesMd);
  const codeBytes = kind === "snippet" ? utf8ByteLength(code) : 0;
  const saveBytes = referencedStagedImages.reduce(
    (total, image) => total + image.file.size,
    persistedNotesBytes + codeBytes,
  );
  const limitError = Math.max(notesBytes, persistedNotesBytes) > ENTRY_NOTES_MAX_BYTES
    ? "Markdown notes must not exceed 10 MiB."
    : codeBytes > ENTRY_CODE_MAX_BYTES
      ? "Code content must not exceed 10 MiB."
      : referencedStagedImages.length > ENTRY_NEW_IMAGE_MAX_COUNT
        ? `An entry can upload at most ${ENTRY_NEW_IMAGE_MAX_COUNT} new images at once.`
        : saveBytes > ENTRY_SAVE_MAX_BYTES
          ? "Markdown notes, code, and new images must not exceed 100 MiB in one save."
          : "";
  const saveBlockMessage = unresolvedImportedImages.length > 0
    ? "Match or remove every imported local image before saving."
    : limitError;
  const snippetChanged = kind === "snippet"
    ? code !== initialCode || language !== initialLanguage || filename !== initialFilename
    : false;
  const dirty =
    importDraft !== null ||
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

  function createFromWikilink(wikilink: Wikilink) {
    if (pending) return;
    if (folderId === null || onCreateWikilink === undefined) return;
    const title = wikilink.titleRaw.trim().replace(/\s+/gu, " ");
    if (!title) return;
    if (!window.confirm(`Create entry “${title}”?`)) return;
    void onCreateWikilink(title, folderId);
  }

  const notesEditor = (
    <div className="editor-outline-layout">
      <MarkdownEditor
        label="Notes"
        name="notesMd"
        value={notesMd}
        imagePreviews={imagePreviews}
        onChange={changeNotes}
        onImageError={setError}
        onStageImage={(image) => setStagedImages((current) => [...current, image])}
        resolveWikilink={resolveWikilink}
        onNavigateWikilink={onNavigateWikilink}
        onCreateFromWikilink={onCreateWikilink === undefined ? undefined : createFromWikilink}
        textareaRef={textareaRef}
        headingIdPrefix={ENTRY_HEADING_ID_PREFIX}
      />
      <OutlinePanel
        content={notesMd}
        mode="edit"
        textareaRef={textareaRef}
        headingIdPrefix={ENTRY_HEADING_ID_PREFIX}
      />
    </div>
  );

  return (
    <section className="detail-panel form-view">
      <form ref={formRef} onSubmit={submit}>
        <header className="document-header form-header">
          <div>
            <DetachedReaderWindow
              title={`${title.trim() || "Untitled entry"} - Reader`}
              windowKey={`neum-${kind}-${detail?.id ?? "draft"}`}
              buttonLabel="Read"
              buttonPortalTargetId="babel-detached-reader-trigger-target"
              disabled={pending}
            >
              {({ document: readerDocument }) => (
                <EntryReaderDraft
                  kind={kind}
                  title={title}
                  folderLabel={folderId === null ? "" : folderPathLabel(folderId, folderMap)}
                  tags={parseTags(tags)}
                  notesMd={notesMd}
                  imagePreviews={imagePreviews}
                  language={language}
                  filename={filename}
                  code={code}
                  live
                  ownerDocument={readerDocument}
                  resolveWikilink={resolveWikilink}
                  onNavigateWikilink={onNavigateWikilink}
                />
              )}
            </DetachedReaderWindow>
            <span className="eyebrow">
              {detail ? "Edit entry" : importDraft ? "Import Markdown" : "New entry"}
            </span>
            <h1>
              {detail ? detail.title : importDraft ? importDraft.title : "Capture technical knowledge"}
            </h1>
          </div>
          <div className="document-actions">
            <button data-babel-command="cancel" type="button" onClick={onCancel}>Cancel</button>
            <button
              data-babel-command="save"
              className="primary-button"
              type="submit"
              disabled={pending || folderId === null || !title.trim() || (kind === "snippet" && !language.trim()) || Boolean(saveBlockMessage)}
              title={saveBlockMessage || "Save entry"}
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
              value={title}
              placeholder="A precise concept or snippet name"
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

        {kind === "knowledge" ? (
          <ImportedImageMatcher
            references={activeImportedReferences}
            stagedImages={stagedImages}
            disabled={pending}
            onResolve={resolveImportedImages}
            onError={setError}
          />
        ) : null}

        {detail ? (
          <DetachedEditorWindow
            title={`${title.trim() || "Untitled entry"} - Editor`}
            windowKey={`neum-${kind}-${detail.id}`}
            disabled={pending}
            onSave={() => formRef.current?.requestSubmit()}
          >
            {notesEditor}
          </DetachedEditorWindow>
        ) : notesEditor}
        <p className="editor-footnote">
          Images remain in this browser until you save the entry.
        </p>
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
            <p className="editor-footnote">
              JSON and YAML are stored as written, even when incomplete.
            </p>
          </section>
        ) : null}
      </form>
    </section>
  );
}
