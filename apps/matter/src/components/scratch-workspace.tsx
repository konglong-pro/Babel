"use client";

import {
  DetachedReaderWindow,
  MarkdownRenderer,
  OutlinePanel,
} from "@babel-apps/markdown/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  PageDeckPage,
  usePageSessionHistoryGuard,
  usePageSessionLifecycle,
  usePageSessions,
} from "@babel-apps/platform/pages/react";

import {
  deleteScratch,
  getErrorMessage,
  getExercise,
  getScratch,
  saveScratch,
} from "@/lib/api-client";
import { navigationAllowed } from "@/components/app-header";
import type { ExerciseDetailDto } from "@/lib/types";
import { MarkdownEditor } from "@/components/markdown-editor";
import { ConfirmButton, formatDate, Tags } from "@/components/shared";

const SCRATCH_HEADING_ID_PREFIX = "matter-scratch-heading-";
const REMARK_FEATURES = ["gfm", "formula-math"] as const;

export function ScratchWorkspace({ exerciseId }: { exerciseId: number }) {
  const router = useRouter();
  const pageKey = `scratch:${exerciseId}`;
  const readerTriggerId = `matter-scratch-${exerciseId}-reader-trigger`;
  const { openPage, setPageStatus, updatePage } = usePageSessions();
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const savingRef = useRef(false);
  const [exercise, setExercise] = useState<ExerciseDetailDto | null>(null);
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const dirty = content !== savedContent;

  useEffect(() => {
    openPage({
      key: pageKey,
      kind: "Scratch",
      title: `Scratch ${exerciseId}`,
      href: `/exercise/${exerciseId}/scratch`,
    });
  }, [exerciseId, openPage, pageKey]);

  useEffect(() => {
    setPageStatus(pageKey, { dirty, pending: saving });
  }, [dirty, pageKey, saving, setPageStatus]);

  usePageSessionLifecycle(pageKey, {
    save: () => {
      if (!dirty && !saving) return true;
      formRef.current?.requestSubmit();
      return false;
    },
    discard: () => setSavedContent(content),
  });
  usePageSessionHistoryGuard();

  useEffect(() => {
    let active = true;
    Promise.all([getExercise(exerciseId), getScratch(exerciseId)])
      .then(([nextExercise, scratch]) => {
        if (!active) return;
        setExercise(nextExercise);
        updatePage(pageKey, {
          title: `${nextExercise.title} — Scratch`,
          href: `/exercise/${exerciseId}/scratch`,
        });
        const nextContent = scratch?.contentMd ?? "";
        setContent(nextContent);
        setSavedContent(nextContent);
        setUpdatedAt(scratch?.updatedAt ?? null);
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
  }, [exerciseId, pageKey, updatePage]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const scratch = await saveScratch(exerciseId, content);
      setSavedContent(content);
      setUpdatedAt(scratch.updatedAt);
      setMessage("Scratch saved. Previous content was replaced.");
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <PageDeckPage pageKey={pageKey}>
        <div className="standalone-status">Opening Scratch…</div>
      </PageDeckPage>
    );
  }

  if (error && !exercise) {
    return (
      <PageDeckPage pageKey={pageKey}>
        <div className="standalone-status error-state" role="alert">
          <h1>Couldn’t Open Scratch</h1>
          <p>{error}</p>
          <Link href="/exercise">Back to Exercise</Link>
        </div>
      </PageDeckPage>
    );
  }

  if (!exercise) return null;

  return (
    <PageDeckPage pageKey={pageKey}>
      <div className="scratch-page">
      <header className="scratch-header">
        <div>
          <Link
            href={`/exercise?folder=${exercise.folderId}&item=${exercise.id}`}
            onClick={(event) => {
              if (
                !event.metaKey &&
                !event.ctrlKey &&
                !event.shiftKey &&
                !event.altKey &&
                !navigationAllowed(
                  `/exercise?folder=${exercise.folderId}&item=${exercise.id}`,
                  () => router.push(
                    `/exercise?folder=${exercise.folderId}&item=${exercise.id}`,
                  ),
                )
              ) {
                event.preventDefault();
              }
            }}
          >
            ← Back to Exercise
          </Link>
          <DetachedReaderWindow
            title={`${exercise.title} - Scratch reader`}
            windowKey={`matter-scratch-${exercise.id}`}
            buttonLabel="Read"
            buttonPortalTargetId={readerTriggerId}
            disabled={saving}
          >
            {({ document: readerDocument }) => {
              const headingIdPrefix = `${SCRATCH_HEADING_ID_PREFIX}reader-`;
              return (
                <article className="document-view" aria-label="Live Scratch reader">
                  <header className="document-header">
                    <div>
                      <span className="eyebrow">Scratch - Temporary Work</span>
                      <h1>{exercise.title}</h1>
                      <Tags tags={exercise.tags} />
                      <p className="document-meta">Live draft. Save changes in the editor.</p>
                    </div>
                  </header>
                  <section className="exercise-problem" aria-labelledby="reader-scratch-problem-heading">
                    <h2 id="reader-scratch-problem-heading">Problem</h2>
                    <div className="document-content">
                      <MarkdownRenderer
                        content={exercise.problemMd}
                        emptyText="No archived problem yet."
                        uploadScheme="matter-upload"
                        remarkFeatures={REMARK_FEATURES}
                        defaultWikilinkKind="knowledge"
                      />
                    </div>
                  </section>
                  <section aria-labelledby="reader-scratch-work-heading">
                    <h2 id="reader-scratch-work-heading">Current work</h2>
                    <div className="document-outline-layout">
                      <div className="document-content">
                        <MarkdownRenderer
                          content={content}
                          emptyText="No scratch work yet."
                          uploadScheme="matter-upload"
                          remarkFeatures={REMARK_FEATURES}
                          defaultWikilinkKind="knowledge"
                          headingIdPrefix={headingIdPrefix}
                        />
                      </div>
                      <OutlinePanel
                        content={content}
                        mode="read"
                        ownerDocument={readerDocument}
                        headingIdPrefix={headingIdPrefix}
                      />
                    </div>
                  </section>
                </article>
              );
            }}
          </DetachedReaderWindow>
          <span className="eyebrow">Scratch · Temporary Work</span>
          <h1>{exercise.title}</h1>
        </div>
        <div className="scratch-actions">
          {updatedAt ? <small>Last saved: {formatDate(updatedAt)}</small> : <small>Not saved yet</small>}
          <ConfirmButton
            className="danger-ghost"
            title="Clear Scratch"
            description="This deletes the current temporary work without changing the archived answer or solution."
            disabled={!updatedAt && !content}
            onConfirm={async () => {
              await deleteScratch(exerciseId);
              setContent("");
              setSavedContent("");
              setUpdatedAt(null);
              setMessage("Scratch cleared.");
            }}
          >
            Clear
          </ConfirmButton>
          <button
            data-babel-command="save"
            className="primary-button"
            type="button"
            disabled={saving}
            onClick={() => formRef.current?.requestSubmit()}
          >
            {saving ? "Saving…" : "Save Scratch"}
          </button>
          <div id={readerTriggerId} className="reader-trigger-slot" />
        </div>
      </header>

      <form ref={formRef} data-dirty={dirty} onSubmit={submit}>
        <div className="status-line" aria-live="polite">
          {error ? <span className="form-error">{error}</span> : message}
        </div>

        <div className="scratch-grid">
          <section className="scratch-problem" aria-labelledby="scratch-problem-heading">
            <h2 id="scratch-problem-heading">Problem</h2>
            <MarkdownRenderer
              content={exercise.problemMd}
              emptyText="No archived problem yet."
              uploadScheme="matter-upload"
              remarkFeatures={REMARK_FEATURES}
              defaultWikilinkKind="knowledge"
            />
          </section>
          <section className="scratch-editor" aria-label="Temporary work editor">
            <div className="editor-outline-layout">
              <MarkdownEditor
                label="Work It Out Again"
                name="contentMd"
                value={content}
                onChange={(value) => {
                  setContent(value);
                  setMessage("");
                }}
                rows={24}
                placeholder="Start from scratch. This space always holds only your current derivation…"
                textareaRef={textareaRef}
                headingIdPrefix={SCRATCH_HEADING_ID_PREFIX}
              />
              <OutlinePanel
                content={content}
                mode="edit"
                textareaRef={textareaRef}
                headingIdPrefix={SCRATCH_HEADING_ID_PREFIX}
              />
            </div>
          </section>
        </div>
      </form>
      </div>
    </PageDeckPage>
  );
}
