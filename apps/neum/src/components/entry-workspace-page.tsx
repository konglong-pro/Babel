import { EntriesWorkspace } from "@/components/entries-workspace";
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
  const view = Array.isArray(params.view) ? params.view[0] : params.view;
  const initialTrash = view === "trash";
  const trashId = initialTrash ? numberParam(params.trash) : null;

  return (
    <EntriesWorkspace
      key={`${kind}:${initialTrash
        ? `trash:${trashId ?? "none"}`
        : `folder:${folderId ?? "all"}:entry:${entryId ?? "none"}`}`}
      kind={kind}
      initialFolderId={folderId}
      initialEntryId={entryId}
      initialTrash={initialTrash}
      initialTrashId={trashId}
    />
  );
}
