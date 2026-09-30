import type { Metadata } from "next";

import { NotesWorkspace } from "@/components/notes-workspace";
import { valiSearchFocusFromParams } from "@/lib/search-focus";

export const metadata: Metadata = {
  title: "Notes",
};

interface NotesPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function numberParam(value: string | string[] | undefined): number | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate) return null;
  const parsed = Number(candidate);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export default async function NotesPage({ searchParams }: NotesPageProps) {
  const params = await searchParams;
  const folderId = numberParam(params.folder);
  const noteId = numberParam(params.note);
  const searchFocus = noteId === null ? null : valiSearchFocusFromParams(params);
  return (
    <NotesWorkspace
      key={`folder:${folderId ?? "all"}:note:${noteId ?? "none"}:search:${searchFocus?.field ?? "none"}:${searchFocus?.query ?? ""}`}
      initialFolderId={folderId}
      initialNoteId={noteId}
      initialSearchFocus={searchFocus}
    />
  );
}
