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
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PageSessionDescriptor } from "@babel-apps/platform/pages/core";
import {
  PageDeckPage,
  usePageSessionLifecycle,
  usePageSessions,
} from "@babel-apps/platform/pages/react";

import { MarkdownEditor, type StagedImage } from "@/components/markdown-editor";
import { formatDate } from "@/components/shared";
import {
  getErrorMessage,
  getReflection,
  listReflectionBacklinks,
  saveReflection,
} from "@/lib/api-client";
import { persistedEditorModeAfterSave } from "@/lib/editor-save-mode";
import { documentSaveLimitError } from "@/lib/note-limits";
import { focusValiSearchMatch } from "@/lib/search-focus.client";
import {
  valiSearchFocusSourceLine,
  type ValiSearchFocus,
} from "@/lib/search-focus";
import type {
  DocumentBacklinkDto,
  ReflectionDetailDto,
} from "@/lib/types";

const REFLECTION_HEADING_ID_PREFIX = "vali-reflection-heading-";
const REMARK_FEATURES = ["gfm", "formula-math"] as const;
type ValiResolvedWikilink = ResolvedWikilink & { date?: string };

interface ReflectionPageSessionProps {
  pageKey: string;
  date: string;
  exists: boolean;
  searchFocus: ValiSearchFocus | null;
  onOpenDate: (date: string) => void;
  onOpenNote: (id: number, folderId?: number) => void;
  onSaved: (detail: ReflectionDetailDto) => void;
}

export function reflectionPage(date: string): PageSessionDescriptor {
  return {
    key: `reflection:${date}`,
    kind: "Reflection",
    title: date,
    href: `/reflection?date=${encodeURIComponent(date)}`,
    scope: "reflection",
  };
}

export function ReflectionPageSession({
  pageKey,
  date,
  exists,
  searchFocus,
  onOpenDate,
  onOpenNote,
  onSaved,
}: ReflectionPageSessionProps) {
  const { setPageStatus, updatePage } = usePageSessions();
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const stagedRef = useRef<StagedImage[]>([]);
  const [detail, setDetail] = useState<ReflectionDetailDto | null>(null);
  const [backlinks, setBacklinks] = useState<DocumentBacklinkDto[]>([]);
  const [content, setContent] = useState("");
  const [stagedImages, setStagedImages] = useState<StagedImage[]>([]);
  const [mode, setMode] = useState<"view" | "edit">(exists ? "view" : "edit");
  const [loading, setLoading] = useState(exists);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [reloadVersion, setReloadVersion] = useState(0);
  const readerTriggerId = `vali-reflection-${date}-reader-trigger`;
  const detailRootRef = useRef<HTMLElement>(null);
  const detailDate = detail?.date;
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

  const dirty = content !== (detail?.contentMd ?? "") || stagedImages.length > 0;
  const imagePreviews = useMemo(
    () => new Map(stagedImages.map((image) => [image.token, image.previewUrl])),
    [stagedImages],
  );
  const limitError = documentSaveLimitError(content, stagedImages);
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

  useEffect(() => {
    setPageStatus(pageKey, { dirty, pending });
  }, [dirty, pageKey, pending, setPageStatus]);

  useEffect(() => {
    updatePage(pageKey, {
      scope: "reflection",
      href: reflectionPage(date).href,
    });
  }, [date, pageKey, updatePage]);

  usePageSessionLifecycle(pageKey, {
    save: () => {
      if (!dirty && !pending) return true;
      formRef.current?.requestSubmit();
      return false;
    },
    discard: () => {
      for (const image of stagedRef.current) URL.revokeObjectURL(image.previewUrl);
      stagedRef.current = [];
      setStagedImages([]);
    },
  });

  useEffect(() => {
    if (!exists) return;
    let active = true;
    Promise.all([getReflection(date), listReflectionBacklinks(date)])
      .then(([nextDetail, nextBacklinks]) => {
        if (!active) return;
        setDetail(nextDetail);
        setContent(nextDetail.contentMd);
        setBacklinks(nextBacklinks);
        setMode("view");
        setError("");
      })
      .catch((caught) => {
        if (active) setError(getErrorMessage(caught));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [date, exists, reloadVersion]);

  useEffect(() => {
    stagedRef.current = stagedImages;
  }, [stagedImages]);

  useEffect(() => {
    const root = detailRootRef.current;
    if (
      root === null ||
      detailDate === undefined ||
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
  }, [detailDate, mode, searchFocusField, searchFocusQuery]);

  useEffect(() => {
    return () => {
      for (const image of stagedRef.current) URL.revokeObjectURL(image.previewUrl);
    };
  }, []);

  const resolveWikilink = useCallback(
    (titleKey: string): ResolvedWikilink | null => wikilinkTargets.get(titleKey) ?? null,
    [wikilinkTargets],
  );

  const navigateWikilink = useCallback((target: ResolvedWikilink) => {
    const targetDate = "date" in target && typeof target.date === "string"
      ? target.date
      : null;
    if (target.kind === "reflection" && targetDate) {
      onOpenDate(targetDate);
      return;
    }
    onOpenNote(target.id);
  }, [onOpenDate, onOpenNote]);

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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || limitError) {
      if (limitError) setError(limitError);
      return;
    }
    setPending(true);
    setError("");
    const persistedBeforeSave = detail !== null;
    try {
      const saved = await saveReflection(date, content, stagedImages);
      for (const image of stagedRef.current) URL.revokeObjectURL(image.previewUrl);
      stagedRef.current = [];
      setStagedImages([]);
      setDetail(saved);
      setContent(saved.contentMd);
      setMode(persistedEditorModeAfterSave(persistedBeforeSave));
      setBacklinks(await listReflectionBacklinks(saved.date));
      onSaved(saved);
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  function createFromWikilink(wikilink: Wikilink) {
    const targetDate = wikilink.titleRaw.trim();
    if (validReflectionDate(targetDate)) onOpenDate(targetDate);
  }

  function renderReflectionReader(
    readerDocument: Document,
    live: boolean,
  ) {
    const headingIdPrefix = `${REFLECTION_HEADING_ID_PREFIX}reader-${date}-`;
    return (
      <article aria-label={live ? "Live reflection reader" : "Reflection reader"}>
        <header className="document-header">
          <div>
            <span className="eyebrow">Daily reflection</span>
            <h1>{date}</h1>
            {live ? <p className="document-meta">Live draft. Save changes in the editor.</p> : null}
          </div>
        </header>
        <div className="document-outline-layout">
          <section className="document-content" aria-label="Reflection content">
            <MarkdownRenderer
              content={content}
              emptyText="This reflection is empty."
              imagePreviews={imagePreviews}
              remarkFeatures={REMARK_FEATURES}
              uploadScheme="vali-upload"
              resolveWikilink={resolveWikilink}
              onNavigateWikilink={navigateWikilink}
              headingIdPrefix={headingIdPrefix}
            />
          </section>
          <OutlinePanel
            content={content}
            mode="read"
            ownerDocument={readerDocument}
            headingIdPrefix={headingIdPrefix}
          />
        </div>
      </article>
    );
  }

  const reflectionEditor = (
    <div className="editor-outline-layout">
      <MarkdownEditor
        label="Reflection"
        name="contentMd"
        value={content}
        disabled={pending}
        imagePreviews={imagePreviews}
        onChange={changeContent}
        onImageError={setError}
        onStageImage={(image) => setStagedImages((current) => [...current, image])}
        resolveWikilink={resolveWikilink}
        onNavigateWikilink={navigateWikilink}
        onCreateFromWikilink={createFromWikilink}
        textareaRef={textareaRef}
        headingIdPrefix={`${REFLECTION_HEADING_ID_PREFIX}${date}-`}
      />
      <OutlinePanel
        content={content}
        mode="edit"
        textareaRef={textareaRef}
        headingIdPrefix={`${REFLECTION_HEADING_ID_PREFIX}${date}-`}
      />
    </div>
  );

  if (error && exists && detail === null && !loading) {
    return (
      <PageDeckPage pageKey={pageKey}>
        <main className="reflection-detail detail-panel">
          <div className="standalone-status error-state" role="alert">
            <h1>Could not open this reflection</h1>
            <p>{error}</p>
            <button type="button" onClick={() => {
              setLoading(true);
              setReloadVersion((version) => version + 1);
            }}>
              Retry
            </button>
          </div>
        </main>
      </PageDeckPage>
    );
  }

  return (
    <PageDeckPage pageKey={pageKey}>
      <main ref={detailRootRef} className="reflection-detail detail-panel">
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {!error && limitError ? <p className="form-error" role="alert">{limitError}</p> : null}
        {loading ? (
          <div className="standalone-status">Loading reflection…</div>
        ) : mode === "edit" ? (
          <form ref={formRef} onSubmit={submit}>
            <header className="document-header form-header">
              <div>
                <DetachedReaderWindow
                  title={`${date} - Reflection reader`}
                  windowKey={`vali-reflection-${date}`}
                  buttonLabel="Read"
                  buttonPortalTargetId={readerTriggerId}
                  disabled={pending}
                >
                  {({ document: readerDocument }) =>
                    renderReflectionReader(readerDocument, true)}
                </DetachedReaderWindow>
                <span className="eyebrow">{detail ? "Edit reflection" : "New reflection"}</span>
                <h1>{date}</h1>
              </div>
              <div className="document-actions">
                {detail ? (
                  <button
                    data-babel-command="cancel"
                    type="button"
                    onClick={() => {
                      if (dirty && !window.confirm("Discard your unsaved reflection changes?")) {
                        return;
                      }
                      setContent(detail.contentMd);
                      for (const image of stagedRef.current) {
                        URL.revokeObjectURL(image.previewUrl);
                      }
                      stagedRef.current = [];
                      setStagedImages([]);
                      setMode("view");
                    }}
                  >
                    Cancel
                  </button>
                ) : null}
                <button
                  data-babel-command="save"
                  className="primary-button"
                  type="submit"
                  disabled={pending || Boolean(limitError)}
                  title={limitError || "Save reflection"}
                >
                  {pending ? "Saving…" : "Save"}
                </button>
                <div id={readerTriggerId} className="reader-trigger-slot" />
              </div>
            </header>
            {detail ? (
              <DetachedEditorWindow
                title={`${date} - Reflection editor`}
                windowKey={`vali-reflection-${date}`}
                disabled={pending}
                onSave={() => formRef.current?.requestSubmit()}
              >
                {reflectionEditor}
              </DetachedEditorWindow>
            ) : reflectionEditor}
            <p className="editor-footnote">Images are committed with this reflection.</p>
          </form>
        ) : (
          <article>
            <header className="document-header">
              <div>
                <DetachedReaderWindow
                  title={`${date} - Reflection reader`}
                  windowKey={`vali-reflection-${date}`}
                  buttonLabel="Read"
                  buttonPortalTargetId={readerTriggerId}
                >
                  {({ document: readerDocument }) =>
                    renderReflectionReader(readerDocument, false)}
                </DetachedReaderWindow>
                <span className="eyebrow">Daily reflection</span>
                <h1>{date}</h1>
                {detail ? <p className="document-meta">Updated {formatDate(detail.updatedAt)}</p> : null}
              </div>
              <div className="document-actions">
                <button
                  data-babel-command="edit"
                  type="button"
                  onClick={(event) => {
                    prepareDetachedEditorWindow({
                      title: `${date} - Reflection editor`,
                      windowKey: `vali-reflection-${date}`,
                      anchorElement: event.currentTarget.closest<HTMLElement>(".detail-panel"),
                    });
                    setMode("edit");
                  }}
                >
                  Edit
                </button>
                <div id={readerTriggerId} className="reader-trigger-slot" />
              </div>
            </header>
            <div className="document-outline-layout">
              <section className="document-content" aria-label="Reflection content">
                <MarkdownRenderer
                  content={content}
                  emptyText="This reflection is empty."
                  remarkFeatures={REMARK_FEATURES}
                  uploadScheme="vali-upload"
                  resolveWikilink={resolveWikilink}
                  onNavigateWikilink={navigateWikilink}
                  onCreateFromWikilink={createFromWikilink}
                  headingIdPrefix={`${REFLECTION_HEADING_ID_PREFIX}${date}-`}
                  focusSourceLine={searchFocusSourceLine}
                />
              </section>
              <OutlinePanel
                content={content}
                mode="read"
                headingIdPrefix={`${REFLECTION_HEADING_ID_PREFIX}${date}-`}
              />
            </div>
            <section className="linked-mentions" aria-labelledby={`reflection-backlinks-${date}`}>
              <h2 id={`reflection-backlinks-${date}`}>Linked mentions ({backlinks.length})</h2>
              {backlinks.length === 0 ? (
                <p className="empty-copy">No documents link here yet.</p>
              ) : (
                <ul>
                  {backlinks.map((backlink) => (
                    <li
                      key={backlink.kind === "note"
                        ? `note:${backlink.id}`
                        : `reflection:${backlink.date}`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          if (backlink.kind === "reflection") {
                            onOpenDate(backlink.date);
                          } else {
                            onOpenNote(backlink.id, backlink.folderId);
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
        )}
      </main>
    </PageDeckPage>
  );
}

export function validReflectionDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}
