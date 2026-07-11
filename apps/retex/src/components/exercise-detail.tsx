"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";

import {
  createExercise,
  deleteExercise,
  getErrorMessage,
  listKnowledge,
  updateExercise,
  uploadExerciseImage,
} from "@/lib/api-client";
import { imageUrl, type ExerciseDetailDto, type KnowledgeSummaryDto } from "@/lib/types";
import { MarkdownEditor, MarkdownRenderer } from "@/components/markdown";
import {
  ConfirmButton,
  formatDate,
  parseTags,
  RelationPicker,
  Tags,
} from "@/components/shared";

interface ExerciseDetailProps {
  detail: ExerciseDetailDto | null;
  mode: "view" | "edit" | "create";
  folderId: number | null;
  loading?: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSaved: (detail: ExerciseDetailDto) => void;
  onDeleted: () => void;
}

export function ExerciseDetail({
  detail,
  mode,
  folderId,
  loading,
  onEdit,
  onCancel,
  onSaved,
  onDeleted,
}: ExerciseDetailProps) {
  if (loading) {
    return <section className="detail-panel panel-status">Loading exercise…</section>;
  }

  if (mode === "create" || mode === "edit") {
    return (
      <ExerciseForm
        detail={mode === "edit" ? detail : null}
        folderId={folderId}
        onCancel={onCancel}
        onSaved={onSaved}
      />
    );
  }

  if (!detail) {
    return (
      <section className="detail-panel empty-state" aria-label="Exercise details">
        <span aria-hidden="true">∫</span>
        <h2>Archive the Problems Worth Keeping</h2>
        <p>Select an exercise on the left, or create a new Exercise inside a folder.</p>
      </section>
    );
  }

  return (
    <article className="detail-panel document-view">
      <header className="document-header">
        <div>
          <span className="eyebrow">Exercise</span>
          <h1>{detail.title}</h1>
          <p className="document-meta">Updated {formatDate(detail.updatedAt)}</p>
        </div>
        <div className="document-actions">
          <button type="button" onClick={onEdit}>
            Edit
          </button>
          <ConfirmButton
            className="danger-ghost"
            title="Delete Archived Exercise"
            description={`Delete “${detail.title}”? Its Scratch work will also be deleted.`}
            onConfirm={async () => {
              await deleteExercise(detail.id);
              onDeleted();
            }}
          >
            Delete
          </ConfirmButton>
        </div>
      </header>

      <figure className="exercise-image-frame">
        {/* The image comes from the local managed upload directory; its dimensions are not known before upload. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl(detail.imagePath)}
          alt={`${detail.title} problem image`}
          loading="lazy"
          decoding="async"
        />
        <figcaption>
          <a href={imageUrl(detail.imagePath)} target="_blank" rel="noreferrer">
            View Full Image
          </a>
        </figcaption>
      </figure>

      <div className="exercise-tags">
        <Tags tags={detail.tags} />
      </div>

      <div className="exercise-sections">
        <details>
          <summary>Archived Answer</summary>
          <MarkdownRenderer content={detail.answerMd} emptyText="No archived answer yet." />
        </details>
        <details>
          <summary>Archived Solution</summary>
          <MarkdownRenderer content={detail.solutionMd} emptyText="No archived solution yet." />
        </details>
      </div>

      <Link className="scratch-link" href={`/exercise/${detail.id}/scratch`}>
        <span aria-hidden="true">✎</span>
        <span>
          <strong>Solve Again</strong>
          <small>Open the single temporary workspace for this exercise</small>
        </span>
      </Link>

      <section className="related-section">
        <h2>Related Knowledge</h2>
        {detail.relatedKnowledge.length === 0 ? (
          <p className="muted">No related Knowledge yet.</p>
        ) : (
          <ul className="related-list">
            {detail.relatedKnowledge.map((knowledge) => (
              <li key={knowledge.id}>
                <Link href={`/knowledge?item=${knowledge.id}`}>{knowledge.title}</Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}

interface ExerciseFormProps {
  detail: ExerciseDetailDto | null;
  folderId: number | null;
  onCancel: () => void;
  onSaved: (detail: ExerciseDetailDto) => void;
}

function ExerciseForm({ detail, folderId, onCancel, onSaved }: ExerciseFormProps) {
  const [title, setTitle] = useState(detail?.title ?? "");
  const [tags, setTags] = useState(detail?.tags.join(", ") ?? "");
  const [answer, setAnswer] = useState(detail?.answerMd ?? "");
  const [solution, setSolution] = useState(detail?.solutionMd ?? "");
  const [image, setImage] = useState<File | null>(null);
  const [knowledgeIds, setKnowledgeIds] = useState(
    detail?.relatedKnowledge.map((item) => item.id) ?? [],
  );
  const [knowledge, setKnowledge] = useState<KnowledgeSummaryDto[]>([]);
  const [relationsLoading, setRelationsLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    listKnowledge()
      .then((items) => {
        if (active) setKnowledge(items);
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
    if (folderId === null) {
      setError("Select a folder first.");
      return;
    }
    if (!detail && !image) {
      setError("A new Exercise requires a problem image.");
      return;
    }

    setPending(true);
    setError("");
    try {
      let imagePath = detail?.imagePath ?? "";
      if (image) {
        const uploaded = await uploadExerciseImage(image);
        imagePath = uploaded.imagePath;
      }
      const input = {
        folderId,
        title: title.trim(),
        imagePath,
        answerMd: answer,
        solutionMd: solution,
        tags: parseTags(tags),
        knowledgeIds,
      };
      const saved = detail
        ? await updateExercise(detail.id, input)
        : await createExercise(input);
      onSaved(saved);
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="detail-panel form-view">
      <form onSubmit={submit}>
        <header className="document-header">
          <div>
            <span className="eyebrow">{detail ? "Edit Exercise" : "New Exercise"}</span>
            <h1>{detail ? detail.title : "Archive a Classic Problem"}</h1>
          </div>
          <div className="document-actions">
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
            <button className="primary-button" type="submit" disabled={pending || !title.trim()}>
              {pending ? (image ? "Uploading and Saving…" : "Saving…") : "Save"}
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
              placeholder="integrals, parity, classic problem…"
              onChange={(event) => setTags(event.target.value)}
            />
            <small>Separate tags with commas.</small>
          </label>
        </div>

        <label className="upload-field">
          <span>{detail ? "Replace Problem Image (Optional)" : "Problem Image"}</span>
          {detail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl(detail.imagePath)}
              alt="Current problem image preview"
              loading="lazy"
              decoding="async"
            />
          ) : null}
          <input
            name="image"
            type="file"
            required={!detail}
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(event) => setImage(event.target.files?.[0] ?? null)}
          />
          <small>{image ? `Selected: ${image.name}` : "Supports PNG, JPEG, WebP, and GIF."}</small>
        </label>

        <MarkdownEditor
          label="Archived Answer"
          name="answerMd"
          rows={10}
          value={answer}
          onChange={setAnswer}
          placeholder="Record the final answer from your first archive pass…"
        />
        <MarkdownEditor
          label="Your Solution"
          name="solutionMd"
          value={solution}
          onChange={setSolution}
          placeholder="Record the key insight, full derivation, and reminders for your future self…"
        />

        <RelationPicker
          legend="Link Knowledge"
          items={knowledge}
          selectedIds={knowledgeIds}
          loading={relationsLoading}
          onChange={setKnowledgeIds}
        />
      </form>
    </section>
  );
}
