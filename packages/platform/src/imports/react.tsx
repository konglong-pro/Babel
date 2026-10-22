"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  normalizeFolderImportTitle,
  preflightMarkdownFolder,
  type MarkdownFolderBrowserPreflight,
  type MarkdownFolderCommitManifest,
  type MarkdownFolderCommitResult,
  type MarkdownFolderReviewRecord,
  type MarkdownFolderTarget,
} from "./core";
import { useListKeyboardNavigation } from "../navigation/react";

export interface MarkdownFolderImportFolder {
  id: number;
  parentId: number | null;
  name: string;
}

export interface MarkdownFolderImportParentItem {
  id: number;
  folderId: number;
  title: string;
}

export interface MarkdownFolderImportDialogProps {
  files: readonly File[];
  folders: readonly MarkdownFolderImportFolder[];
  existingTitles: readonly string[];
  parentItems: readonly MarkdownFolderImportParentItem[];
  baseFolderId: number;
  endpoint?: string;
  itemLabel?: string;
  onCancel: () => void;
  onComplete: (result: MarkdownFolderCommitResult) => Promise<void> | void;
}

interface ReviewState {
  sourcePath: string;
  title: string;
  folderValue: string;
  parentValue: string;
  tags: string;
  linkDecisions: Record<string, string>;
}

interface ReviewValidation {
  bySourcePath: Map<string, string[]>;
  global: string[];
}

const mappedPrefix = "mapped:";
const existingPrefix = "existing:";

export function MarkdownFolderImportDialog({
  files,
  folders,
  existingTitles,
  parentItems,
  baseFolderId,
  endpoint = "/api/imports/markdown-folder",
  itemLabel = "note",
  onCancel,
  onComplete,
}: MarkdownFolderImportDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [preflight, setPreflight] = useState<MarkdownFolderBrowserPreflight | null>(null);
  const [reviews, setReviews] = useState<ReviewState[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState("");
  const [requestError, setRequestError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    let active = true;
    void preflightMarkdownFolder(files)
      .then((next) => {
        if (!active) return;
        const nextReviews = next.notes.map((note): ReviewState => ({
          sourcePath: note.sourcePath,
          title: note.defaultTitle,
          folderValue: `${mappedPrefix}${note.sourceDirectory}`,
          parentValue: "none",
          tags: "",
          linkDecisions: {},
        }));
        setPreflight(next);
        setReviews(nextReviews);
        setSelectedPath(nextReviews[0]?.sourcePath ?? "");
      })
      .catch((error: unknown) => {
        if (active) setRequestError(errorMessage(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [files]);

  const folderMap = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder])),
    [folders],
  );
  const mappedDirectories = useMemo(() => {
    const paths = new Set<string>([""]);
    for (const note of preflight?.notes ?? []) {
      let current = "";
      for (const segment of note.sourceDirectory.split("/").filter(Boolean)) {
        current = current ? `${current}/${segment}` : segment;
        paths.add(current);
      }
    }
    return [...paths].sort((left, right) =>
      left.split("/").length - right.split("/").length || left.localeCompare(right, "en-US"));
  }, [preflight]);
  const validations = useMemo(
    () => validateReview(preflight, reviews, folders, existingTitles, parentItems, baseFolderId),
    [baseFolderId, existingTitles, folders, parentItems, preflight, reviews],
  );
  const currentReview = reviews.find(({ sourcePath }) => sourcePath === selectedPath) ?? null;
  const currentNote = preflight?.notes.find(({ sourcePath }) => sourcePath === selectedPath) ?? null;
  const currentErrors = currentReview
    ? validations.bySourcePath.get(currentReview.sourcePath) ?? []
    : [];
  const blockingCount = validations.global.length + [...validations.bySourcePath.values()]
    .reduce((sum, errors) => sum + errors.length, 0);
  const canSubmit = !loading && !pending && reviews.length > 0 && blockingCount === 0;
  const fileNavigation = useListKeyboardNavigation({
    items: reviews.map(({ sourcePath }) => ({ id: sourcePath, label: sourcePath })),
    selectedId: selectedPath || null,
    onActivate: setSelectedPath,
    onFocusChange: setSelectedPath,
    label: "Markdown files",
  });

  function updateCurrent(changes: Partial<ReviewState>) {
    setReviews((current) => current.map((review) =>
      review.sourcePath === selectedPath ? { ...review, ...changes } : review));
  }

  async function submit() {
    if (!preflight || !canSubmit) return;
    setPending(true);
    setRequestError("");
    let sessionId: string | null = null;
    try {
      setProgress("Creating secure staging session…");
      const session = await requestJson<{ id: string }>(`${endpoint}/sessions`, {
        method: "POST",
      });
      sessionId = session.id;
      for (const [index, upload] of preflight.uploads.entries()) {
        setProgress(`Staging ${index + 1} of ${preflight.uploads.length}: ${upload.path}`);
        const formData = new FormData();
        formData.set("path", upload.path);
        formData.set("kind", upload.kind);
        formData.set("file", upload.file as unknown as File, upload.file.name);
        await requestJson(`${endpoint}/sessions/${sessionId}`, {
          method: "PUT",
          body: formData,
        });
      }
      setProgress(`Committing ${reviews.length} ${plural(itemLabel, reviews.length)} atomically…`);
      const manifest = reviewManifest(baseFolderId, reviews);
      const result = await requestJson<MarkdownFolderCommitResult>(
        `${endpoint}/sessions/${sessionId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(manifest),
        },
      );
      sessionId = null;
      await onComplete(result);
    } catch (error) {
      setRequestError(errorMessage(error));
    } finally {
      if (sessionId) {
        await fetch(`${endpoint}/sessions/${sessionId}`, { method: "DELETE" }).catch(() => null);
      }
      setPending(false);
      setProgress("");
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="babel-folder-import-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        if (pending) event.preventDefault();
        else onCancel();
      }}
      onClose={() => {
        if (!pending) onCancel();
      }}
    >
      <div className="babel-folder-import-shell">
        <header className="babel-folder-import-header">
          <div>
            <span className="babel-folder-import-eyebrow">Import Markdown folder</span>
            <h2 id={titleId}>{preflight?.rootName ?? "Review files"}</h2>
            <p>
              {preflight
                ? `${preflight.notes.length} Markdown ${plural("file", preflight.notes.length)} · ${formatBytes(preflight.totalMarkdownBytes)} · ${preflight.assets.length} referenced ${plural("image", preflight.assets.length)}`
                : "Reading selected files…"}
            </p>
          </div>
          <div className="babel-folder-import-actions">
            <button
              data-babel-command="cancel"
              data-babel-escape="overlay"
              type="button"
              disabled={pending}
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              className="primary-button"
              type="button"
              disabled={!canSubmit}
              onClick={() => void submit()}
            >
              {pending ? "Importing…" : `Import ${reviews.length || ""}`.trim()}
            </button>
          </div>
        </header>

        <div className="babel-folder-import-banners">
          {requestError ? <p className="babel-folder-import-banner error-banner">{requestError}</p> : null}
          {progress ? <p className="babel-folder-import-banner" role="status">{progress}</p> : null}
          {validations.global.map((message) => (
            <p key={message} className="babel-folder-import-banner error-banner">{message}</p>
          ))}
        </div>

        <div className="babel-folder-import-grid" aria-busy={loading || pending}>
          <aside className="babel-folder-import-files" aria-label="Files to import">
            {loading ? <p className="muted">Reading Markdown files sequentially…</p> : null}
            <div {...fileNavigation.listboxProps}>
              {reviews.map((review) => {
                const errors = validations.bySourcePath.get(review.sourcePath) ?? [];
                return (
                  <button
                    key={review.sourcePath}
                    type="button"
                    {...fileNavigation.getOptionProps(review.sourcePath)}
                    className={review.sourcePath === selectedPath ? "selected" : undefined}
                    onClick={() => setSelectedPath(review.sourcePath)}
                  >
                    <span>{review.sourcePath}</span>
                    <small className={errors.length ? "has-error" : "is-ready"}>
                      {errors.length ? `${errors.length} ${plural("issue", errors.length)}` : "Ready"}
                    </small>
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="babel-folder-import-review" aria-label="File metadata">
            {currentReview && currentNote ? (
              <>
                <div className="babel-folder-import-file-meta">
                  <span><strong>Source</strong>{currentNote.sourcePath}</span>
                  <span><strong>Size</strong>{formatBytes(currentNote.size)}</span>
                  <span><strong>Images</strong>{currentNote.imagePaths.length}</span>
                  <span><strong>Links</strong>{currentNote.linkCount}</span>
                </div>

                {currentErrors.length ? (
                  <ul className="babel-folder-import-errors" aria-label="File issues">
                    {currentErrors.map((message) => <li key={message}>{message}</li>)}
                  </ul>
                ) : null}

                <div className="babel-folder-import-form">
                  <label className="field">
                    <span>Title</span>
                    <input
                      value={currentReview.title}
                      disabled={pending}
                      onChange={(event) => updateCurrent({ title: event.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span>Folder</span>
                    <select
                      value={currentReview.folderValue}
                      disabled={pending}
                      onChange={(event) => updateCurrent({
                        folderValue: event.target.value,
                        parentValue: "none",
                      })}
                    >
                      <optgroup label="Source folder mapping">
                        {mappedDirectories.map((directory) => (
                          <option key={`mapped-${directory}`} value={`${mappedPrefix}${directory}`}>
                            {mappedFolderLabel(directory, baseFolderId, folderMap)}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Existing folders">
                        {folders.map((folder) => (
                          <option key={folder.id} value={`${existingPrefix}${folder.id}`}>
                            {folderLabel(folder.id, folderMap)}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                  </label>
                  <label className="field">
                    <span>Parent page</span>
                    <select
                      value={currentReview.parentValue}
                      disabled={pending}
                      onChange={(event) => updateCurrent({ parentValue: event.target.value })}
                    >
                      <option value="none">No parent (root page)</option>
                      {parentOptions(
                        currentReview,
                        reviews,
                        folders,
                        parentItems,
                        baseFolderId,
                      ).map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field babel-folder-import-tags">
                    <span>Tags</span>
                    <input
                      value={currentReview.tags}
                      disabled={pending}
                      placeholder="Separate tags with commas"
                      onChange={(event) => updateCurrent({ tags: event.target.value })}
                    />
                  </label>
                </div>

                {currentNote.linkIssues.length ? (
                  <section className="babel-folder-import-links" aria-label="Ambiguous links">
                    <h3>Link decisions</h3>
                    {currentNote.linkIssues.map((linkIssue) => (
                      <label className="field" key={linkIssue.id}>
                        <span>[[{linkIssue.target}]]</span>
                        <select
                          value={currentReview.linkDecisions[linkIssue.id] ?? ""}
                          disabled={pending}
                          onChange={(event) => updateCurrent({
                            linkDecisions: {
                              ...currentReview.linkDecisions,
                              [linkIssue.id]: event.target.value,
                            },
                          })}
                        >
                          <option value="">Choose a target…</option>
                          {linkIssue.candidateSourcePaths.map((sourcePath) => (
                            <option key={sourcePath} value={sourcePath}>{sourcePath}</option>
                          ))}
                          <option value="preserve">Preserve unchanged</option>
                        </select>
                      </label>
                    ))}
                  </section>
                ) : null}
              </>
            ) : (
              <p className="muted">No Markdown file selected.</p>
            )}
          </section>
        </div>
        <footer className="babel-folder-import-footer">
          <span>{blockingCount ? `${blockingCount} blocking ${plural("issue", blockingCount)}` : "All files are ready"}</span>
          <span>Source files are never renamed or modified.</span>
        </footer>
      </div>
    </dialog>
  );
}

function validateReview(
  preflight: MarkdownFolderBrowserPreflight | null,
  reviews: readonly ReviewState[],
  folders: readonly MarkdownFolderImportFolder[],
  existingTitles: readonly string[],
  parentItems: readonly MarkdownFolderImportParentItem[],
  baseFolderId: number,
): ReviewValidation {
  const bySourcePath = new Map<string, string[]>();
  const global = preflight?.issues.filter(({ blocking }) => blocking).map(({ message }) => message) ?? [];
  const occupied = new Set(existingTitles.map(normalizeFolderImportTitle));
  const importedTitles = new Map<string, string>();
  const reviewByPath = new Map(reviews.map((review) => [review.sourcePath, review]));

  for (const review of reviews) {
    const errors = [
      ...(preflight?.notes.find(({ sourcePath }) => sourcePath === review.sourcePath)
        ?.issues.filter(({ blocking }) => blocking).map(({ message }) => message) ?? []),
    ];
    const key = normalizeFolderImportTitle(review.title);
    if (!key) errors.push("Title is required.");
    else if (occupied.has(key)) errors.push(`Title “${review.title.trim()}” already exists.`);
    else if (importedTitles.has(key)) {
      const duplicatePath = importedTitles.get(key)!;
      errors.push(`Title duplicates ${duplicatePath}.`);
      bySourcePath.get(duplicatePath)?.push(`Title duplicates ${review.sourcePath}.`);
    } else importedTitles.set(key, review.sourcePath);

    const target = decodeTarget(review.folderValue);
    const resolution = canonicalTarget(target, folders, baseFolderId);
    if (resolution.error) errors.push(resolution.error);

    const note = preflight?.notes.find(({ sourcePath }) => sourcePath === review.sourcePath);
    for (const linkIssue of note?.linkIssues ?? []) {
      const decision = review.linkDecisions[linkIssue.id];
      if (!decision) errors.push(`Choose a target or preserve [[${linkIssue.target}]].`);
    }
    bySourcePath.set(review.sourcePath, errors);
  }

  for (const review of reviews) {
    const errors = bySourcePath.get(review.sourcePath)!;
    const targetKey = canonicalTarget(decodeTarget(review.folderValue), folders, baseFolderId).key;
    const parent = decodeParent(review.parentValue);
    if (parent?.kind === "existing") {
      const existing = parentItems.find(({ id }) => id === parent.id);
      if (!existing) errors.push("The selected existing parent no longer exists.");
      else if (targetKey !== `existing:${existing.folderId}`) {
        errors.push("Parent page must be in the same destination folder.");
      }
    }
    if (parent?.kind === "batch") {
      const candidate = reviewByPath.get(parent.sourcePath);
      if (!candidate) errors.push("The selected batch parent no longer exists.");
      else {
        const parentTarget = canonicalTarget(
          decodeTarget(candidate.folderValue),
          folders,
          baseFolderId,
        ).key;
        if (targetKey !== parentTarget) errors.push("Parent page must be in the same destination folder.");
      }
    }
  }

  for (const cyclePath of parentCycles(reviews)) {
    bySourcePath.get(cyclePath)?.push("Parent-page selection creates a cycle.");
  }
  return { bySourcePath, global: [...new Set(global)] };
}

function parentCycles(reviews: readonly ReviewState[]): Set<string> {
  const parents = new Map<string, string>();
  for (const review of reviews) {
    const parent = decodeParent(review.parentValue);
    if (parent?.kind === "batch") parents.set(review.sourcePath, parent.sourcePath);
  }
  const cycles = new Set<string>();
  for (const sourcePath of parents.keys()) {
    const chain: string[] = [];
    const positions = new Map<string, number>();
    let cursor: string | undefined = sourcePath;
    while (cursor && parents.has(cursor)) {
      const position = positions.get(cursor);
      if (position !== undefined) {
        chain.slice(position).forEach((path) => cycles.add(path));
        break;
      }
      positions.set(cursor, chain.length);
      chain.push(cursor);
      cursor = parents.get(cursor);
    }
  }
  return cycles;
}

function parentOptions(
  current: ReviewState,
  reviews: readonly ReviewState[],
  folders: readonly MarkdownFolderImportFolder[],
  parentItems: readonly MarkdownFolderImportParentItem[],
  baseFolderId: number,
): Array<{ value: string; label: string }> {
  const targetKey = canonicalTarget(decodeTarget(current.folderValue), folders, baseFolderId).key;
  return [
    ...parentItems
      .filter(({ folderId }) => targetKey === `existing:${folderId}`)
      .map((item) => ({ value: `existing:${item.id}`, label: item.title })),
    ...reviews
      .filter((review) => review.sourcePath !== current.sourcePath)
      .filter((review) => canonicalTarget(
        decodeTarget(review.folderValue),
        folders,
        baseFolderId,
      ).key === targetKey)
      .map((review) => ({
        value: `batch:${review.sourcePath}`,
        label: `${review.title.trim() || review.sourcePath} (this import)`,
      })),
  ];
}

function canonicalTarget(
  target: MarkdownFolderTarget,
  folders: readonly MarkdownFolderImportFolder[],
  baseFolderId: number,
): { key: string; error: string | null } {
  if (target.kind === "existing") {
    return folders.some(({ id }) => id === target.folderId)
      ? { key: `existing:${target.folderId}`, error: null }
      : { key: `existing:${target.folderId}`, error: "Destination folder no longer exists." };
  }
  if (!target.path) return { key: `existing:${baseFolderId}`, error: null };
  let parentId = baseFolderId;
  const traversed: string[] = [];
  for (const segment of target.path.split("/")) {
    traversed.push(segment);
    const matches = folders.filter((folder) =>
      folder.parentId === parentId && normalizeFolderImportTitle(folder.name) === normalizeFolderImportTitle(segment));
    if (matches.length > 1) {
      return {
        key: `mapped:${target.path}`,
        error: `Folder mapping “${traversed.join(" / ")}” is ambiguous. Choose an existing folder explicitly.`,
      };
    }
    if (matches.length === 0) return { key: `mapped:${target.path}`, error: null };
    parentId = matches[0].id;
  }
  return { key: `existing:${parentId}`, error: null };
}

function reviewManifest(
  baseFolderId: number,
  reviews: readonly ReviewState[],
): MarkdownFolderCommitManifest {
  return {
    baseFolderId,
    records: reviews.map((review): MarkdownFolderReviewRecord => ({
      sourcePath: review.sourcePath,
      title: review.title.trim(),
      folder: decodeTarget(review.folderValue),
      parent: decodeParent(review.parentValue),
      tags: review.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      linkDecisions: review.linkDecisions,
    })),
  };
}

function decodeTarget(value: string): MarkdownFolderTarget {
  if (value.startsWith(existingPrefix)) {
    return { kind: "existing", folderId: Number(value.slice(existingPrefix.length)) };
  }
  return { kind: "mapped", path: value.slice(mappedPrefix.length) };
}

function decodeParent(value: string): MarkdownFolderReviewRecord["parent"] {
  if (value === "none") return null;
  if (value.startsWith(existingPrefix)) {
    return { kind: "existing", id: Number(value.slice(existingPrefix.length)) };
  }
  return { kind: "batch", sourcePath: value.slice("batch:".length) };
}

function mappedFolderLabel(
  directory: string,
  baseFolderId: number,
  folders: ReadonlyMap<number, MarkdownFolderImportFolder>,
): string {
  const base = folderLabel(baseFolderId, folders);
  return directory ? `${base} / ${directory.replaceAll("/", " / ")} (map)` : `${base} (selected)`;
}

function folderLabel(
  folderId: number,
  folders: ReadonlyMap<number, MarkdownFolderImportFolder>,
): string {
  const names: string[] = [];
  const visited = new Set<number>();
  let cursor = folders.get(folderId);
  while (cursor && !visited.has(cursor.id)) {
    visited.add(cursor.id);
    names.unshift(cursor.name);
    cursor = cursor.parentId === null ? undefined : folders.get(cursor.parentId);
  }
  return names.join(" / ") || `Folder ${folderId}`;
}

async function requestJson<T = unknown>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => null) as {
    error?: { message?: string };
  } | T | null;
  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body
      ? body.error?.message
      : undefined;
    throw new Error(message || `Folder import failed (${response.status}).`);
  }
  return body as T;
}

function plural(value: string, count: number): string {
  return count === 1 ? value : `${value}s`;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Folder import failed.";
}
