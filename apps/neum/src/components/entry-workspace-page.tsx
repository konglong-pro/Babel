import { EntriesWorkspace } from "@/components/entries-workspace";
import { entrySearchFocusFromParams } from "@/lib/search-focus";
import type { EntryKind } from "@/lib/types";

interface EntryWorkspacePageProps {
  kind: EntryKind;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function numberParam(value: string | string[] | undefined): number | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate) return null;
  const parsed = Number(candidate);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function EntryWorkspacePage({
  kind,
  searchParams,
}: EntryWorkspacePageProps) {
  const params = await searchParams;
  const folderId = numberParam(params.folder);
  const entryId = numberParam(params.entry);
  const searchFocus = entryId === null ? null : entrySearchFocusFromParams(params);

  return (
    <EntriesWorkspace
      key={`${kind}:folder:${folderId ?? "all"}:entry:${entryId ?? "none"}:search:${searchFocus?.field ?? "none"}:${searchFocus?.query ?? ""}`}
      kind={kind}
      initialFolderId={folderId}
      initialEntryId={entryId}
      initialSearchFocus={searchFocus}
    />
  );
}
