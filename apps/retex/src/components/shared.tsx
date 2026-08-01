"use client";

import { type ReactNode, useMemo, useRef, useState } from "react";

import type { RelatedItemDto } from "@/lib/types";

export function Tags({ tags }: { tags: string[] }) {
  if (tags.length === 0) {
    return <span className="muted" data-search-field="tags">No tags</span>;
  }
  return (
    <ul className="tag-list" aria-label="Tags" data-search-field="tags">
      {tags.map((tag) => (
        <li key={tag}>{tag}</li>
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
        data-babel-command="delete"
        type="button"
        disabled={disabled}
        onClick={() => dialogRef.current?.showModal()}
      >
        {children}
      </button>
      <dialog ref={dialogRef} className="dialog">
        <div className="dialog-body">
          <h2>{title}</h2>
          <p>{description}</p>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="dialog-actions">
            <button data-babel-command="cancel" type="button" onClick={() => dialogRef.current?.close()}>
              Cancel
            </button>
            <button data-babel-command="confirm" className="danger-button" type="button" disabled={pending} onClick={confirm}>
              {pending ? "Working…" : confirmLabel}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}

interface RelationPickerProps {
  legend: string;
  items: RelatedItemDto[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  loading?: boolean;
}

export function RelationPicker({
  legend,
  items,
  selectedIds,
  onChange,
  loading,
}: RelationPickerProps) {
  const [filter, setFilter] = useState("");
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const visibleItems = useMemo(() => {
    const keyword = filter.trim().toLocaleLowerCase();
    return keyword
      ? items.filter((item) => item.title.toLocaleLowerCase().includes(keyword))
      : items;
  }, [filter, items]);

  function toggle(id: number, checked: boolean) {
    onChange(checked ? [...selectedIds, id] : selectedIds.filter((value) => value !== id));
  }

  return (
    <fieldset className="relation-picker">
      <legend>{legend}</legend>
      <label>
        <span className="sr-only">Filter {legend}</span>
        <input
          name="relationFilter"
          type="search"
          autoComplete="off"
          value={filter}
          placeholder="Filter by title…"
          onChange={(event) => setFilter(event.target.value)}
        />
      </label>
      <div className="relation-options">
        {loading ? <p className="muted">Loading…</p> : null}
        {!loading && visibleItems.length === 0 ? <p className="muted">No items available to link.</p> : null}
        {visibleItems.map((item) => (
          <label key={item.id} className="check-option">
            <input
              type="checkbox"
              checked={selected.has(item.id)}
              onChange={(event) => toggle(item.id, event.target.checked)}
            />
            <span>{item.title}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-US", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
}

export function parseTags(value: string): string[] {
  return [...new Set(value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean))];
}
