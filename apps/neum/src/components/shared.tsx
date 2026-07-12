"use client";

import { type ReactNode, useRef, useState } from "react";

import type { EntryKind, FolderDto } from "@/lib/types";

export function Tags({ tags }: { tags: readonly string[] }) {
  if (tags.length === 0) return <span className="muted no-tags">No tags</span>;

  return (
    <ul className="tag-list" aria-label="Tags">
      {tags.map((tag) => (
        <li key={tag.toLocaleLowerCase("en-US")}>{tag}</li>
      ))}
    </ul>
  );
}

interface ConfirmButtonProps {
  children: ReactNode;
  title: string;
  description: string;
  confirmLabel?: string;
  className?: string;
  disabled?: boolean;
  onConfirm: () => Promise<void> | void;
}

export function ConfirmButton({
  children,
  title,
  description,
  confirmLabel = "Delete",
  className,
  disabled,
  onConfirm,
}: ConfirmButtonProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function confirm() {
    setPending(true);
    setError("");
    try {
      await onConfirm();
      dialogRef.current?.close();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        className={className}
        type="button"
        disabled={disabled}
        onClick={() => dialogRef.current?.showModal()}
      >
        {children}
      </button>
      <dialog ref={dialogRef} className="dialog">
        <div className="dialog-body">
          <p className="eyebrow">Please confirm</p>
          <h2>{title}</h2>
          <p>{description}</p>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="dialog-actions">
            <button type="button" onClick={() => dialogRef.current?.close()}>
              Cancel
            </button>
            <button className="danger-button" type="button" disabled={pending} onClick={confirm}>
              {pending ? "Working…" : confirmLabel}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}

export function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

export function parseTags(value: string): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();

  for (const candidate of value.split(/[,;\n]/)) {
    const tag = candidate.trim();
    const normalized = tag.toLocaleLowerCase("en-US");
    if (!tag || seen.has(normalized)) continue;
    seen.add(normalized);
    tags.push(tag);
  }

  return tags;
}

export function entryKindLabel(kind: EntryKind): string {
  return kind === "snippet" ? "Code snippet" : "Knowledge note";
}

export function folderPath(folderId: number, folders: ReadonlyMap<number, FolderDto>): FolderDto[] {
  const path: FolderDto[] = [];
  const seen = new Set<number>();
  let current = folders.get(folderId);

  while (current && !seen.has(current.id)) {
    path.unshift(current);
    seen.add(current.id);
    current = current.parentId === null ? undefined : folders.get(current.parentId);
  }

  return path;
}

export function folderPathLabel(
  folderId: number,
  folders: ReadonlyMap<number, FolderDto>,
): string {
  return folderPath(folderId, folders)
    .map((folder) => folder.name)
    .join(" / ");
}
