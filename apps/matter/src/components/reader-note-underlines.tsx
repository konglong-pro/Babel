"use client";

import {
  ReaderAnnotationLayer,
  type ReaderUnderline,
  type ReaderUnderlineAnchor,
} from "@babel-apps/markdown/react";
import { type ReactNode, useCallback, useEffect, useState } from "react";

import { listKnowledge } from "@/lib/api-client";

interface ReaderSourceUnderlinesProps {
  noteId?: number | null;
  sourceKind?: string;
  sourceId?: string | number | null;
  fieldKey?: string;
  enabled: boolean;
  notes: readonly { id: number; title: string }[];
  onCreateLinkedNote: (underlineId: number) => void;
  onEditLinkedNote: (noteId: number) => void;
  children: ReactNode;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const message = payload && typeof payload === "object" && "error" in payload &&
      typeof payload.error === "object" && payload.error !== null &&
      "message" in payload.error && typeof payload.error.message === "string"
      ? payload.error.message
      : `Reader underline request failed (${response.status}).`;
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function attachReaderUnderlineNote(underlineId: number, noteId: number): Promise<void> {
  await request(`/api/reader-underlines/${underlineId}/notes`, {
    method: "POST",
    body: JSON.stringify({ noteId }),
  });
  window.dispatchEvent(new Event("reader-underlines-updated"));
}

export function ReaderSourceUnderlines({
  noteId = null,
  sourceKind = "note",
  sourceId,
  fieldKey = "content",
  enabled,
  notes,
  onCreateLinkedNote,
  onEditLinkedNote,
  children,
}: ReaderSourceUnderlinesProps) {
  const [annotations, setAnnotations] = useState<ReaderUnderline[]>([]);
  const [error, setError] = useState("");
  const resolvedSourceId = sourceId ?? noteId;

  const refresh = useCallback(async () => {
    if (!enabled || resolvedSourceId === null) {
      return;
    }
    const query = new URLSearchParams({ sourceKind, sourceId: String(resolvedSourceId) });
    const next = await request<ReaderUnderline[]>(`/api/reader-underlines?${query}`);
    setAnnotations(next);
  }, [enabled, resolvedSourceId, sourceKind]);

  useEffect(() => {
    let active = true;
    if (!enabled || resolvedSourceId === null) return;
    void Promise.resolve().then(refresh).catch((caught) => {
      if (active) setError(caught instanceof Error ? caught.message : String(caught));
    });
    return () => { active = false; };
  }, [enabled, resolvedSourceId, refresh]);

  useEffect(() => {
    const onUpdated = () => { void refresh().catch((caught) => {
      setError(caught instanceof Error ? caught.message : String(caught));
    }); };
    window.addEventListener("reader-underlines-updated", onUpdated);
    return () => window.removeEventListener("reader-underlines-updated", onUpdated);
  }, [refresh]);

  async function mutate(action: () => Promise<unknown>) {
    setError("");
    await action();
    await refresh();
  }

  return (
    <>
      {error ? <p role="alert" className="form-error">{error}</p> : null}
      <ReaderAnnotationLayer
        fieldKey={fieldKey}
        annotations={enabled ? annotations : []}
        enabled={enabled && resolvedSourceId !== null}
        availableNotes={notes}
        onAdd={(anchor: ReaderUnderlineAnchor, color: string) => mutate(() =>
          request("/api/reader-underlines", {
            method: "POST",
            body: JSON.stringify({
              sourceKind,
              sourceId: resolvedSourceId,
              fieldKey,
              anchor,
              color,
            }),
          }))}
        onRecolor={(id: number, color: string) => mutate(() =>
          request(`/api/reader-underlines/${id}`, {
            method: "PATCH",
            body: JSON.stringify({ color }),
          }))}
        onRemove={(id: number) => mutate(() =>
          request(`/api/reader-underlines/${id}`, { method: "DELETE" }))}
        onCreateNote={onCreateLinkedNote}
        onLinkNote={(underlineId: number, targetNoteId: number) => mutate(() =>
          attachReaderUnderlineNote(underlineId, targetNoteId))}
        onEditNote={onEditLinkedNote}
      >
        {children}
      </ReaderAnnotationLayer>
    </>
  );
}

export const ReaderNoteUnderlines = ReaderSourceUnderlines;

export function useReaderKnowledgeOptions(): Array<{ id: number; title: string }> {
  const [notes, setNotes] = useState<Array<{ id: number; title: string }>>([]);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void listKnowledge().then((items) => {
        if (active) setNotes(items.map(({ id, title }) => ({ id, title })));
      }).catch(() => undefined);
    };
    refresh();
    window.addEventListener("reader-underlines-updated", refresh);
    return () => {
      active = false;
      window.removeEventListener("reader-underlines-updated", refresh);
    };
  }, []);
  return notes;
}
