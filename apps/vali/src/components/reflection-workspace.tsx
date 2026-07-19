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

import {
  BEFORE_NAVIGATE_EVENT,
} from "@/components/app-header";
import { MarkdownEditor, type StagedImage } from "@/components/markdown-editor";
import { formatDate } from "@/components/shared";
import {
  getErrorMessage,
  getReflection,
  listReflectionBacklinks,
  listReflections,
  saveReflection,
} from "@/lib/api-client";
import { documentSaveLimitError } from "@/lib/note-limits";
import type {
  DocumentBacklinkDto,
  ReflectionDetailDto,
  ReflectionSummaryDto,
} from "@/lib/types";

const REFLECTION_HEADING_ID_PREFIX = "vali-reflection-heading-";
const REMARK_FEATURES = ["gfm", "typst-math"] as const;
type ValiResolvedWikilink = ResolvedWikilink & { date?: string };

function localToday(): string {
  const now = new Date();
  return [
    String(now.getFullYear()).padStart(4, "0"),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatWeekday(date: string): string {
  return new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(
    new Date(`${date}T00:00:00`),
  );
}

function validDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

export function ReflectionWorkspace({ initialDate }: { initialDate: string | null }) {
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const stagedRef = useRef<StagedImage[]>([]);
  const dirtyRef = useRef(false);
  const [today, setToday] = useState(initialDate ?? "");
  const [selectedDate, setSelectedDate] = useState(initialDate ?? "");
  const [dateDraft, setDateDraft] = useState(initialDate ?? "");
  const [summaries, setSummaries] = useState<ReflectionSummaryDto[]>([]);
  const [detail, setDetail] = useState<ReflectionDetailDto | null>(null);
  const [backlinks, setBacklinks] = useState<DocumentBacklinkDto[]>([]);
  const [content, setContent] = useState("");
  const [stagedImages, setStagedImages] = useState<StagedImage[]>([]);
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [indexLoading, setIndexLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const dirty = content !== (detail?.contentMd ?? "") || stagedImages.length > 0;
  const savedDates = useMemo(() => new Set(summaries.map(({ date }) => date)), [summaries]);
  const visibleDates = useMemo(() => {
    const dates = new Set(summaries.map(({ date }) => date));
    if (today) dates.add(today);
    return [...dates].sort((left, right) => right.localeCompare(left));
  }, [summaries, today]);
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
    let active = true;
    listReflections()
      .then((next) => {
        if (!active) return;
        const localDate = localToday();
        setToday(localDate);
        if (!initialDate) {
          setSelectedDate(localDate);
          setDateDraft(localDate);
        }
        setSummaries(next);
      })
      .catch((caught) => {
        if (active) setError(getErrorMessage(caught));
      })
      .finally(() => {
        if (active) setIndexLoading(false);
      });
    return () => {
      active = false;
    };
  }, [initialDate]);

  useEffect(() => {
    if (!selectedDate || indexLoading) return;
    let active = true;
    if (!savedDates.has(selectedDate)) {
      void Promise.resolve().then(() => {
        if (!active) return;
        setDetail(null);
        setBacklinks([]);
        setContent("");
        setMode("edit");
        setDetailLoading(false);
      });
    } else {
      Promise.all([getReflection(selectedDate), listReflectionBacklinks(selectedDate)])
        .then(([nextDetail, nextBacklinks]) => {
          if (!active) return;
          setDetail(nextDetail);
          setContent(nextDetail.contentMd);
          setBacklinks(nextBacklinks);
          setMode("view");
        })
        .catch((caught) => {
          if (active) setError(getErrorMessage(caught));
        })
        .finally(() => {
          if (active) setDetailLoading(false);
        });
    }
    return () => {
      active = false;
    };
  }, [indexLoading, savedDates, selectedDate]);

  useEffect(() => {
    stagedRef.current = stagedImages;
    dirtyRef.current = dirty;
  }, [dirty, stagedImages]);

  useEffect(() => {
    function beforeUnload(event: BeforeUnloadEvent) {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = true;
    }
    function beforeNavigate(event: Event) {
      if (dirtyRef.current && !window.confirm("Discard your unsaved reflection changes?")) {
        event.preventDefault();
      }
    }
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener(BEFORE_NAVIGATE_EVENT, beforeNavigate);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener(BEFORE_NAVIGATE_EVENT, beforeNavigate);
      for (const image of stagedRef.current) URL.revokeObjectURL(image.previewUrl);
    };
  }, []);

  const confirmDiscard = useCallback(() => (
    !dirtyRef.current || window.confirm("Discard your unsaved reflection changes?")
  ), []);

  const openDate = useCallback((date: string) => {
    if (!validDate(date) || date === selectedDate || !confirmDiscard()) return;
    setSelectedDate(date);
    setDateDraft(date);
    setDetail(null);
    setBacklinks([]);
    setContent("");
    setStagedImages([]);
    setDetailLoading(true);
    setError("");
    window.history.replaceState(window.history.state, "", `/reflection?date=${encodeURIComponent(date)}`);
  }, [confirmDiscard, selectedDate]);

  const navigateWikilink = useCallback((target: ResolvedWikilink) => {
    const date = "date" in target && typeof target.date === "string" ? target.date : null;
    if (target.kind === "reflection" && date) {
      openDate(date);
      return;
    }
    if (!confirmDiscard()) return;
    window.location.assign(`/notes?note=${target.id}`);
  }, [confirmDiscard, openDate]);

  const resolveWikilink = useCallback(
    (titleKey: string): ResolvedWikilink | null => wikilinkTargets.get(titleKey) ?? null,
    [wikilinkTargets],
  );

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
    if (pending || !selectedDate) return;
    if (limitError) {
      setError(limitError);
      return;
    }
    setPending(true);
    setError("");
    try {
      const saved = await saveReflection(selectedDate, content, stagedImages);
      for (const image of stagedImages) URL.revokeObjectURL(image.previewUrl);
      setStagedImages([]);
      setDetail(saved);
      setContent(saved.contentMd);
      setMode("view");
      setSummaries((current) => [
        saved,
        ...current.filter(({ date }) => date !== saved.date),
      ].sort((left, right) => right.date.localeCompare(left.date)));
      setBacklinks(await listReflectionBacklinks(saved.date));
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  function createFromWikilink(wikilink: Wikilink) {
    const date = wikilink.titleRaw.trim();
    if (!validDate(date)) return;
    openDate(date);
  }

  function renderReflectionReader(
    date: string,
    readerDocument: Document,
    live: boolean,
  ) {
    const headingIdPrefix = `${REFLECTION_HEADING_ID_PREFIX}reader-`;
    return (
      <article aria-label={live ? "Live reflection reader" : "Reflection reader"}>
        <header className="document-header">
          <div>
            <span className="eyebrow">Daily reflection</span>
            <h1>{date}</h1>
            {live ? (
              <p className="document-meta">Live draft. Save changes in the editor.</p>
            ) : null}
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
        headingIdPrefix={REFLECTION_HEADING_ID_PREFIX}
      />
      <OutlinePanel
        content={content}
        mode="edit"
        textareaRef={textareaRef}
        headingIdPrefix={REFLECTION_HEADING_ID_PREFIX}
      />
    </div>
  );

  return (
    <div className={`reflection-workspace${dirty ? " has-unsaved" : ""}`}>
      <aside className="reflection-index workspace-panel" aria-label="Reflection dates">
        <div className="panel-heading">
          <div>
            <div id="babel-detached-reader-trigger-target" className="reader-trigger-slot" />
            <span className="eyebrow">Daily unit</span>
            <h1>Reflection</h1>
          </div>
          <div className="reflection-heading-actions">
            <span className="count-badge">{summaries.length}</span>
          </div>
        </div>
        <form
          className="reflection-date-picker"
          onSubmit={(event) => {
            event.preventDefault();
            openDate(dateDraft);
          }}
        >
          <label className="sr-only" htmlFor="reflection-date">Reflection date</label>
          <input
            id="reflection-date"
            type="date"
            min="0001-01-01"
            value={dateDraft}
            onChange={(event) => setDateDraft(event.target.value)}
          />
          <button type="submit" disabled={!validDate(dateDraft)}>Open</button>
        </form>
        {indexLoading ? <p className="panel-status">Loading dates...</p> : null}
        <ol className="reflection-date-list">
          {visibleDates.map((date) => (
            <li key={date}>
              <button
                className={date === selectedDate ? "selected" : undefined}
                type="button"
                aria-current={date === selectedDate ? "date" : undefined}
                onClick={() => openDate(date)}
              >
                <strong>{date}</strong>
                <span>{date === today ? "Today" : formatWeekday(date)}</span>
                {!savedDates.has(date) ? <small>Not saved</small> : null}
              </button>
            </li>
          ))}
        </ol>
      </aside>

      <main className="reflection-detail detail-panel">
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {!error && limitError ? <p className="form-error" role="alert">{limitError}</p> : null}
        {detailLoading || !selectedDate ? (
          <div className="standalone-status">Loading reflection...</div>
        ) : mode === "edit" ? (
          <form ref={formRef} onSubmit={submit}>
            <header className="document-header form-header">
              <div>
                <DetachedReaderWindow
                  title={`${selectedDate} - Reflection reader`}
                  windowKey={`vali-reflection-${selectedDate}`}
                  buttonLabel="Read"
                  buttonPortalTargetId="babel-detached-reader-trigger-target"
                  disabled={pending}
                >
                  {({ document: readerDocument }) =>
                    renderReflectionReader(selectedDate, readerDocument, true)}
                </DetachedReaderWindow>
                <span className="eyebrow">{detail ? "Edit reflection" : "New reflection"}</span>
                <h1>{selectedDate}</h1>
              </div>
              <div className="document-actions">
                {detail ? (
                  <button data-babel-command="cancel" type="button" onClick={() => {
                    if (!confirmDiscard()) return;
                    setContent(detail.contentMd);
                    setStagedImages([]);
                    setMode("view");
                  }}>Cancel</button>
                ) : null}
                <button
                  data-babel-command="save"
                  className="primary-button"
                  type="submit"
                  disabled={pending || Boolean(limitError)}
                  title={limitError || "Save reflection"}
                >
                  {pending ? "Saving..." : "Save"}
                </button>
              </div>
            </header>
            {detail ? (
              <DetachedEditorWindow
                title={`${selectedDate} - Reflection editor`}
                windowKey={`vali-reflection-${selectedDate}`}
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
                  title={`${selectedDate} - Reflection reader`}
                  windowKey={`vali-reflection-${selectedDate}`}
                  buttonLabel="Read"
                  buttonPortalTargetId="babel-detached-reader-trigger-target"
                >
                  {({ document: readerDocument }) =>
                    renderReflectionReader(selectedDate, readerDocument, false)}
                </DetachedReaderWindow>
                <span className="eyebrow">Daily reflection</span>
                <h1>{selectedDate}</h1>
                {detail ? <p className="document-meta">Updated {formatDate(detail.updatedAt)}</p> : null}
              </div>
              <div className="document-actions">
                <button
                  data-babel-command="edit"
                  type="button"
                  onClick={(event) => {
                    prepareDetachedEditorWindow({
                      title: `${selectedDate} - Reflection editor`,
                      windowKey: `vali-reflection-${selectedDate}`,
                      anchorElement: event.currentTarget.closest<HTMLElement>(".detail-panel"),
                    });
                    setMode("edit");
                  }}
                >
                  Edit
                </button>
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
                  headingIdPrefix={REFLECTION_HEADING_ID_PREFIX}
                />
              </section>
              <OutlinePanel
                content={content}
                mode="read"
                headingIdPrefix={REFLECTION_HEADING_ID_PREFIX}
              />
            </div>
            <section className="linked-mentions" aria-labelledby="reflection-backlinks-heading">
              <h2 id="reflection-backlinks-heading">Linked mentions ({backlinks.length})</h2>
              {backlinks.length === 0 ? <p className="empty-copy">No documents link here yet.</p> : (
                <ul>
                  {backlinks.map((backlink) => (
                    <li key={backlink.kind === "note" ? `note:${backlink.id}` : `reflection:${backlink.date}`}>
                      <button type="button" onClick={() => {
                        if (backlink.kind === "reflection") {
                          openDate(backlink.date);
                        } else if (confirmDiscard()) {
                          window.location.assign(`/notes?folder=${backlink.folderId}&note=${backlink.id}`);
                        }
                      }}>
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
    </div>
  );
}
