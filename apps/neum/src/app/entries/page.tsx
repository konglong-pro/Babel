import { redirect } from "next/navigation";

import { entryWorkspaceHref } from "@/lib/entry-routes";
import type { EntryKind } from "@/lib/types";

interface EntriesPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function positiveIntegerParam(value: string | string[] | undefined): number | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate) return null;
  const parsed = Number(candidate);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export default async function EntriesPage({ searchParams }: EntriesPageProps) {
  const params = await searchParams;
  const requestedKind = Array.isArray(params.kind) ? params.kind[0] : params.kind;
  const kind: EntryKind = requestedKind === "snippet" ? "snippet" : "knowledge";
  const folderId = positiveIntegerParam(params.folder);
  const entryId = positiveIntegerParam(params.entry);

  redirect(entryWorkspaceHref(kind, { folderId, entryId }));
}
