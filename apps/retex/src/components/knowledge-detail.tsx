"use client";

import type { Wikilink } from "@babel-apps/markdown/core";
import {
  DetachedReaderWindow,
  MarkdownRenderer,
  OutlinePanel,
  type ResolvedWikilink,
} from "@babel-apps/markdown/react";
import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ImportedImageMatcher } from "@/components/imported-image-matcher";
import { LinkedMentions } from "@/components/linked-mentions";
import { MarkdownEditor, type StagedImage } from "@/components/markdown-editor";
import { pageDescendantIds } from "@/components/page-tree-state";
import {
  ConfirmButton,
  formatDate,
  parseTags,
  RelationPicker,
  Tags,
} from "@/components/shared";
import {
  createKnowledge,
  deleteKnowledge,
  getErrorMessage,
  listExercises,
  updateKnowledge,
} from "@/lib/api-client";
import type { MarkdownImportDraft } from "@/lib/markdown-import";
import {
  NOTE_CONTENT_MAX_BYTES,
  NOTE_NEW_IMAGE_MAX_COUNT,
  NOTE_SAVE_MAX_BYTES,
  utf8ByteLength,
} from "@/lib/note-limits";
import type {
  BacklinksDto,
  ExerciseSummaryDto,
  KnowledgeDetailDto,
  KnowledgeSummaryDto,
  LinkEntityKind,
} from "@/lib/types";

const KNOWLEDGE_HEADING_ID_PREFIX = "retex-knowledge-heading-";
const REMARK_FEATURES = ["gfm", "typst-math"] as const;
const PENDING_IMAGE_URL_PATTERN = /retex-upload:\/\/[A-Za-z0-9._-]+/g;
const MAX_MANAGED_IMAGE_URL =
  "/api/uploads/notes/00000000-0000-0000-0000-000000000000.webp";

function estimatedPersistedMarkdownBytes(contentMd: string): number {
  return utf8ByteLength(
    contentMd.replace(PENDING_IMAGE_URL_PATTERN, MAX_MANAGED_IMAGE_URL),
  );
}

interface KnowledgeReaderDraftProps {
  title: string;
  tags: string[];
  content: string;
  imagePreviews: ReadonlyMap<string, string>;
  ownerDocument: Document;
  resolveWikilink: (titleKey: string) => ResolvedWikilink | null;
  onNavigateWikilink: (target: ResolvedWikilink) => void;
}

function KnowledgeReaderDraft({
  title,
  tags,
  content,
  imagePreviews,
  ownerDocument,
  resolveWikilink,
  onNavigateWikilink,
}: KnowledgeReaderDraftProps) {
  const headingIdPrefix = `${KNOWLEDGE_HEADING_ID_PREFIX}reader-`;
  return (
    <article className="document-view" aria-label="Live Knowledge reader">
      <header className="document-header">
        <div>
          <span className="eyebrow">Knowledge</span>
          <h1>{title.trim() || "Untitled Knowledge note"}</h1>
          <Tags tags={tags} />
          <p className="document-meta">Live draft. Save changes in the editor.</p>
        </div>
      </header>
      <div className="document-outline-layout">
        <section className="document-content" aria-label="Note content">
          <MarkdownRenderer
            content={content}
            imagePreviews={imagePreviews}
            uploadScheme="retex-upload"
            remarkFeatures={REMARK_FEATURES}
            defaultWikilinkKind="knowledge"
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

interface KnowledgeDetailProps {
  detail: KnowledgeDetailDto | null;
  importDraft: MarkdownImportDraft | null;
  draftKey: number;
  mode: "view" | "edit" | "create";
  folderId: number | null;
  pages: KnowledgeSummaryDto[];
  createParentId: number | null;
  backlinks: BacklinksDto;
  loading?: boolean;
  onEdit: () => void;
  onCreateChild: () => void;
  onCancel: () => void;
  onSaved: (detail: KnowledgeDetailDto) => void;
  onDeleted: () => void;
  onNavigateEntity: (
    kind: LinkEntityKind,
    id: number,
    folderId?: number,
  ) => void;
  onCreateWikilink: (title: string, folderId: number) => Promise<void> | void;
  onDirtyChange?: (dirty: boolean) => void;
  onRegisterSave?: (action: (() => void) | null) => void;
}

function pagePathLabel(
  pageId: number,
  pages: ReadonlyMap<number, KnowledgeSummaryDto>,
): string {
  const titles: string[] = [];
  const seen = new Set<number>();
  let current = pages.get(pageId);
  while (current && !seen.has(current.id)) {
    titles.unshift(current.title);
    seen.add(current.id);
    current = current.parentId === null ? undefined : pages.get(current.parentId);
  }
  return titles.join(" / ");
}

export function KnowledgeDetail({
  detail,
  importDraft,
  draftKey,
  mode,
  folderId,
  pages,
  createParentId,
  backlinks,
  loading,
  onEdit,
  onCreateChild,
  onCancel,
  onSaved,
  onDeleted,
  onNavigateEntity,
  onCreateWikilink,
  onDirtyChange,
  onRegisterSave,
}: KnowledgeDetailProps) {
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
  const navigateWikilink = useCallback(
    (target: ResolvedWikilink) => {
      if (!isLinkEntityKind(target.kind)) return;
      onNavigateEntity(target.kind, target.id);
    },
    [onNavigateEntity],
  );
  const createFromWikilink = useCallback((wikilink: Wikilink) => {
    const targetFolderId = detail?.folderId ?? folderId;
    const title = normalizedWikilinkTitle(wikilink);
    if (targetFolderId === null || !title) return;
    if (!window.confirm(`Create Knowledge note “${title}” and open it?`)) return;
    void Promise.resolve(onCreateWikilink(title, targetFolderId)).catch(() => undefined);
  }, [detail?.folderId, folderId, onCreateWikilink]);

  if (loading) {
    return <section className="detail-panel panel-status">Loading note…</section>;
  }

  if (mode === "create" || mode === "edit") {
    return (
      <KnowledgeForm
        key={mode === "edit" ? `edit:${detail?.id ?? "none"}` : `new:${draftKey}`}
        detail={mode === "edit" ? detail : null}
        importDraft={mode === "create" ? importDraft : null}
        folderId={folderId}
        pages={pages}
        createParentId={createParentId}
        onCancel={onCancel}
        onSaved={onSaved}
        resolveWikilink={resolveWikilink}
        onNavigateWikilink={navigateWikilink}
        onCreateWikilink={onCreateWikilink}
        onDirtyChange={onDirtyChange}
        onRegisterSave={onRegisterSave}
      />
    );
  }

  if (!detail) {
    return (
      <section className="detail-panel empty-state" aria-label="Knowledge details">
        <span aria-hidden="true">∴</span>
        <h2>Archive Ideas Worth Revisiting</h2>
        <p>Select a note on the left, or create a new Knowledge note inside a folder.</p>
      </section>
    );
  }

  return (
    <article className="detail-panel document-view">
      <header className="document-header">
        <div>
          <span className="eyebrow">Knowledge</span>
          <h1>{detail.title}</h1>
          <Tags tags={detail.tags} />
          <p className="document-meta">Updated {formatDate(detail.updatedAt)}</p>
        </div>
        <div className="document-actions">
          <button data-babel-command="new" data-babel-priority="10" type="button" onClick={onCreateChild}>
            New subnote
          </button>
          <button data-babel-command="edit" type="button" onClick={onEdit}>
            Edit
          </button>
          <ConfirmButton
            className="danger-ghost"
            title="Delete Knowledge Note"
            description={`Delete “${detail.title}”? This action cannot be undone.`}
            onConfirm={async () => {
              await deleteKnowledge(detail.id);
              onDeleted();
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
            uploadScheme="retex-upload"
            remarkFeatures={REMARK_FEATURES}
            defaultWikilinkKind="knowledge"
            resolveWikilink={resolveWikilink}
            onNavigateWikilink={navigateWikilink}
            onCreateFromWikilink={createFromWikilink}
            headingIdPrefix={KNOWLEDGE_HEADING_ID_PREFIX}
          />
        </section>
        <OutlinePanel
          content={detail.contentMd}
          mode="read"
          headingIdPrefix={KNOWLEDGE_HEADING_ID_PREFIX}
        />
      </div>

      <section className="related-section">
        <h2>Related Exercises</h2>
        {detail.relatedExercises.length === 0 ? (
          <p className="muted">No related exercises yet.</p>
        ) : (
          <ul className="related-list">
            {detail.relatedExercises.map((exercise) => (
              <li key={exercise.id}>
                <Link href={`/exercise?item=${exercise.id}`}>{exercise.title}</Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <LinkedMentions backlinks={backlinks} onNavigate={onNavigateEntity} />
    </article>
  );
}

interface KnowledgeFormProps {
  detail: KnowledgeDetailDto | null;
  importDraft: MarkdownImportDraft | null;
  folderId: number | null;
  pages: KnowledgeSummaryDto[];
  createParentId: number | null;
  onCancel: () => void;
  onSaved: (detail: KnowledgeDetailDto) => void;
  resolveWikilink: (titleKey: string) => ResolvedWikilink | null;
  onNavigateWikilink: (target: ResolvedWikilink) => void;
  onCreateWikilink: (title: string, folderId: number) => Promise<void> | void;
  onDirtyChange?: (dirty: boolean) => void;
  onRegisterSave?: (action: (() => void) | null) => void;
}

function KnowledgeForm({
  detail,
  importDraft,
  folderId,
  pages,
  createParentId,
  onCancel,
  onSaved,
  resolveWikilink,
  onNavigateWikilink,
  onCreateWikilink,
  onDirtyChange,
  onRegisterSave,
}: KnowledgeFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const stagedRef = useRef<StagedImage[]>([]);
  const initialTitle = detail?.title ?? importDraft?.title ?? "";
  const initialTags = detail?.tags.join(", ") ?? "";
  const initialContent = detail?.contentMd ?? importDraft?.contentMd ?? "";
  const initialParentId = detail?.parentId ?? createParentId;
  const initialExerciseIds = detail?.relatedExercises.map((item) => item.id) ?? [];
  const [title, setTitle] = useState(initialTitle);
  const [tags, setTags] = useState(initialTags);
  const [content, setContent] = useState(initialContent);
  const [parentId, setParentId] = useState<number | null>(initialParentId);
  const [exerciseIds, setExerciseIds] = useState(initialExerciseIds);
  const [stagedImages, setStagedImages] = useState<StagedImage[]>([]);
  const [exercises, setExercises] = useState<ExerciseSummaryDto[]>([]);
  const [relationsLoading, setRelationsLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const pageMap = useMemo(
    () => new Map(pages.map((page) => [page.id, page])),
    [pages],
  );
  const unavailableParentIds = useMemo(
    () => detail ? pageDescendantIds(pages, detail.id) : new Set<number>(),
    [detail, pages],
  );
  const parentPages = useMemo(
    () =>
      pages
        .filter(
          (page) =>
            page.folderId === folderId &&
            page.id !== detail?.id &&
            !unavailableParentIds.has(page.id),
        )
        .map((page) => ({ id: page.id, label: pagePathLabel(page.id, pageMap) }))
        .sort((a, b) => a.label.localeCompare(b.label, "en-US")),
    [detail?.id, folderId, pageMap, pages, unavailableParentIds],
  );
  const imagePreviews = useMemo(
    () => new Map(stagedImages.map((image) => [image.token, image.previewUrl])),
    [stagedImages],
  );
  const activeImportedReferences = useMemo(
    () => (importDraft?.imageReferences ?? []).filter((reference) =>
      content.includes(`retex-upload://${reference.token}`),
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
    content.includes(`retex-upload://${image.token}`),
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
    parentId !== initialParentId ||
    !sameIdSet(exerciseIds, initialExerciseIds) ||
    stagedImages.length > 0;

  useEffect(() => {
    let active = true;
    listExercises()
      .then((items) => {
        if (active) setExercises(items);
      })
      .catch((caught) => {
        if (active) setError(getErrorMessage(caught));
      })
      .finally(() => {
        if (active) setRelationsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    stagedRef.current = stagedImages;
  }, [stagedImages]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    const save = () => formRef.current?.requestSubmit();
    onRegisterSave?.(save);
    return () => onRegisterSave?.(null);
  }, [onRegisterSave]);

  useEffect(() => {
    return () => {
      for (const image of stagedRef.current) URL.revokeObjectURL(image.previewUrl);
    };
  }, []);

  useEffect(() => {
    return () => onDirtyChange?.(false);
  }, [onDirtyChange]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (folderId === null) {
      setError("Select a folder first.");
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
        exerciseIds,
      };
      const saved = detail
        ? await updateKnowledge(detail.id, input, stagedImages)
        : await createKnowledge(input, stagedImages);
      onDirtyChange?.(false);
      onSaved(saved);
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
        const referenced = nextContent.includes(`retex-upload://${image.token}`);
        if (!referenced) URL.revokeObjectURL(image.previewUrl);
        return referenced;
      });
      return retained.length === current.length ? current : retained;
    });
  }

  function resolveImportedImages(images: readonly StagedImage[]) {
    setStagedImages((current) => {
      const replacements = new Map(images.map((image) => [image.token, image]));
      const next: StagedImage[] = [];
      for (const image of current) {
        const replacement = replacements.get(image.token);
        if (replacement === undefined) {
          next.push(image);
        } else if (replacement.previewUrl !== image.previewUrl) {
          URL.revokeObjectURL(image.previewUrl);
        }
      }
      next.push(...replacements.values());
      return next;
    });
  }

  async function createFromWikilink(wikilink: Wikilink) {
    if (pending) return;
    const targetTitle = normalizedWikilinkTitle(wikilink);
    if (folderId === null || !targetTitle) return;
    if (!window.confirm(
      `Create Knowledge note “${targetTitle}”, discard unsaved changes, and open it?`,
    )) return;
    setPending(true);
    try {
      await Promise.resolve(onCreateWikilink(targetTitle, folderId)).catch(() => undefined);
    } finally {
      setPending(false);
    }
  }

  function navigateFromPreview(target: ResolvedWikilink) {
    onNavigateWikilink(target);
  }

  return (
    <section className="detail-panel form-view">
      <form ref={formRef} onSubmit={submit} aria-busy={pending}>
        <fieldset className="form-controls" disabled={pending}>
        <header className="document-header">
          <div>
            <span className="eyebrow">
              {detail ? "Edit Knowledge" : importDraft ? "Import Markdown" : "New Knowledge"}
            </span>
            <h1>
              {detail
                ? detail.title
                : importDraft
                  ? importDraft.title
                  : "Capture a New Mathematical Insight"}
            </h1>
          </div>
          <div className="document-actions">
            <DetachedReaderWindow
              title={`${title.trim() || "Untitled Knowledge note"} - Reader`}
              windowKey={`retex-knowledge-${detail?.id ?? "draft"}`}
              buttonLabel="Read"
              buttonPortalTargetId="babel-detached-reader-trigger-target"
              disabled={pending}
            >
              {({ document: readerDocument }) => (
                <KnowledgeReaderDraft
                  title={title}
                  tags={parseTags(tags)}
                  content={content}
                  imagePreviews={imagePreviews}
                  ownerDocument={readerDocument}
                  resolveWikilink={resolveWikilink}
                  onNavigateWikilink={onNavigateWikilink}
                />
              )}
            </DetachedReaderWindow>
            <button data-babel-command="cancel" type="button" onClick={onCancel}>
              Cancel
            </button>
            <button
              data-babel-command="save"
              className="primary-button"
              type="submit"
              disabled={pending || !title.trim() || Boolean(saveBlockMessage)}
              title={saveBlockMessage || undefined}
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </header>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        {!error && limitError ? (
          <p className="form-error" role="alert">{limitError}</p>
        ) : null}

        <div className="form-row two-columns">
          <label className="field">
            <span>Title</span>
            <input
              name="title"
              autoComplete="off"
              required
              maxLength={240}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Tags</span>
            <input
              name="tags"
              autoComplete="off"
              value={tags}
              placeholder="limits, derivatives, geometric meaning…"
              onChange={(event) => setTags(event.target.value)}
            />
            <small>Separate tags with commas.</small>
          </label>
        </div>

        <label className="field">
          <span>Parent page</span>
          <select
            name="parentId"
            value={parentId ?? ""}
            onChange={(event) => setParentId(event.target.value ? Number(event.target.value) : null)}
          >
            <option value="">Knowledge root</option>
            {parentPages.map((page) => (
              <option key={page.id} value={page.id}>
                {page.label}
              </option>
            ))}
          </select>
        </label>

        <ImportedImageMatcher
          references={activeImportedReferences}
          stagedImages={stagedImages}
          disabled={pending}
          onResolve={resolveImportedImages}
          onError={setError}
        />

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
            hint="Use native Typst math inside $…$ and [[title]] to link another note."
            enableWikilinkAutocomplete
            resolveWikilink={resolveWikilink}
            onNavigateWikilink={navigateFromPreview}
            onCreateFromWikilink={createFromWikilink}
            textareaRef={textareaRef}
            footerExtras={(
              <RelationPicker
                legend="Link Exercises"
                items={exercises}
                selectedIds={exerciseIds}
                loading={relationsLoading}
                onChange={setExerciseIds}
              />
            )}
          />
          <OutlinePanel
            content={content}
            mode="edit"
            textareaRef={textareaRef}
            headingIdPrefix={KNOWLEDGE_HEADING_ID_PREFIX}
          />
        </div>
        </fieldset>
      </form>
    </section>
  );
}

function normalizedWikilinkTitle(wikilink: Wikilink): string {
  return wikilink.titleRaw.trim().replace(/\s+/gu, " ");
}

function isLinkEntityKind(value: string | undefined): value is LinkEntityKind {
  return value === "knowledge" || value === "exercise";
}

function sameIdSet(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) return false;
  const expected = new Set(right);
  return left.every((id) => expected.has(id));
}
