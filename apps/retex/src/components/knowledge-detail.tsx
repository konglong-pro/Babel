"use client";

import type { Wikilink } from "@babel-apps/markdown/core";
import {
  MarkdownRenderer,
  type ResolvedWikilink,
} from "@babel-apps/markdown/react";
import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { LinkedMentions } from "@/components/linked-mentions";
import { MarkdownEditor } from "@/components/markdown-editor";
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
import type {
  BacklinksDto,
  ExerciseSummaryDto,
  KnowledgeDetailDto,
  KnowledgeSummaryDto,
  LinkEntityKind,
} from "@/lib/types";

interface KnowledgeDetailProps {
  detail: KnowledgeDetailDto | null;
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
        key={mode === "edit" ? `edit:${detail?.id ?? "none"}` : `new:${createParentId ?? "root"}`}
        detail={mode === "edit" ? detail : null}
        folderId={folderId}
        pages={pages}
        createParentId={createParentId}
        onCancel={onCancel}
        onSaved={onSaved}
        resolveWikilink={resolveWikilink}
        onNavigateWikilink={navigateWikilink}
        onCreateWikilink={onCreateWikilink}
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
          <button type="button" onClick={onCreateChild}>
            New subnote
          </button>
          <button type="button" onClick={onEdit}>
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

      <section className="document-content" aria-label="Note content">
        <MarkdownRenderer
          content={detail.contentMd}
          remarkFeatures={["math"]}
          defaultWikilinkKind="knowledge"
          resolveWikilink={resolveWikilink}
          onNavigateWikilink={navigateWikilink}
          onCreateFromWikilink={createFromWikilink}
        />
      </section>

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
  folderId: number | null;
  pages: KnowledgeSummaryDto[];
  createParentId: number | null;
  onCancel: () => void;
  onSaved: (detail: KnowledgeDetailDto) => void;
  resolveWikilink: (titleKey: string) => ResolvedWikilink | null;
  onNavigateWikilink: (target: ResolvedWikilink) => void;
  onCreateWikilink: (title: string, folderId: number) => Promise<void> | void;
}

function KnowledgeForm({
  detail,
  folderId,
  pages,
  createParentId,
  onCancel,
  onSaved,
  resolveWikilink,
  onNavigateWikilink,
  onCreateWikilink,
}: KnowledgeFormProps) {
  const [title, setTitle] = useState(detail?.title ?? "");
  const [tags, setTags] = useState(detail?.tags.join(", ") ?? "");
  const [content, setContent] = useState(detail?.contentMd ?? "");
  const [parentId, setParentId] = useState<number | null>(detail?.parentId ?? createParentId);
  const [exerciseIds, setExerciseIds] = useState(
    detail?.relatedExercises.map((item) => item.id) ?? [],
  );
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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (folderId === null) {
      setError("Select a folder first.");
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
        ? await updateKnowledge(detail.id, input)
        : await createKnowledge(input);
      onSaved(saved);
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  function createFromWikilink(wikilink: Wikilink) {
    const targetTitle = normalizedWikilinkTitle(wikilink);
    if (folderId === null || !targetTitle) return;
    if (!window.confirm(
      `Create Knowledge note “${targetTitle}”, discard unsaved changes, and open it?`,
    )) return;
    void Promise.resolve(onCreateWikilink(targetTitle, folderId)).catch(() => undefined);
  }

  function navigateFromPreview(target: ResolvedWikilink) {
    if (!window.confirm("Discard unsaved changes and open this linked note?")) return;
    onNavigateWikilink(target);
  }

  return (
    <section className="detail-panel form-view">
      <form onSubmit={submit}>
        <header className="document-header">
          <div>
            <span className="eyebrow">{detail ? "Edit Knowledge" : "New Knowledge"}</span>
            <h1>{detail ? detail.title : "Capture a New Mathematical Insight"}</h1>
          </div>
          <div className="document-actions">
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
            <button className="primary-button" type="submit" disabled={pending || !title.trim()}>
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </header>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
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

        <MarkdownEditor
          label="Content"
          name="contentMd"
          value={content}
          onChange={setContent}
          hint="Use $…$ for math and [[title]] to link another note."
          enableWikilinkAutocomplete
          resolveWikilink={resolveWikilink}
          onNavigateWikilink={navigateFromPreview}
          onCreateFromWikilink={createFromWikilink}
        />

        <RelationPicker
          legend="Link Exercises"
          items={exercises}
          selectedIds={exerciseIds}
          loading={relationsLoading}
          onChange={setExerciseIds}
        />
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
