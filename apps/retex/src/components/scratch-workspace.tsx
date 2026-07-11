"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  deleteScratch,
  getErrorMessage,
  getExercise,
  getScratch,
  saveScratch,
} from "@/lib/api-client";
import { imageUrl, type ExerciseDetailDto } from "@/lib/types";
import { MarkdownEditor } from "@/components/markdown";
import { ConfirmButton, formatDate } from "@/components/shared";

export function ScratchWorkspace({ exerciseId }: { exerciseId: number }) {
  const [exercise, setExercise] = useState<ExerciseDetailDto | null>(null);
  const [content, setContent] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    Promise.all([getExercise(exerciseId), getScratch(exerciseId)])
      .then(([nextExercise, scratch]) => {
        if (!active) return;
        setExercise(nextExercise);
        setContent(scratch?.contentMd ?? "");
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
  }, [exerciseId]);

  async function save() {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const scratch = await saveScratch(exerciseId, content);
      setUpdatedAt(scratch.updatedAt);
      setMessage("Scratch saved. Previous content was replaced.");
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="standalone-status">Opening Scratch…</div>;
  }

  if (error && !exercise) {
    return (
      <div className="standalone-status error-state" role="alert">
        <h1>Couldn’t Open Scratch</h1>
        <p>{error}</p>
        <Link href="/exercise">Back to Exercise</Link>
      </div>
    );
  }

  if (!exercise) return null;

  return (
    <div className="scratch-page">
      <header className="scratch-header">
        <div>
          <Link href={`/exercise?folder=${exercise.folderId}&item=${exercise.id}`}>← Back to Exercise</Link>
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
              setUpdatedAt(null);
              setMessage("Scratch cleared.");
            }}
          >
            Clear
          </ConfirmButton>
          <button className="primary-button" type="button" disabled={saving} onClick={save}>
            {saving ? "Saving…" : "Save Scratch"}
          </button>
        </div>
      </header>

      <div className="status-line" aria-live="polite">
        {error ? <span className="form-error">{error}</span> : message}
      </div>

      <div className="scratch-grid">
        <section className="scratch-image" aria-label="Problem image">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl(exercise.imagePath)} alt={`${exercise.title} problem image`} />
        </section>
        <section className="scratch-editor" aria-label="Temporary work editor">
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
          />
        </section>
      </div>
    </div>
  );
}
