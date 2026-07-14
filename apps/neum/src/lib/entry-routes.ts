import type { EntryKind } from "@/lib/types";

export type EntryUnitPath = "/knowledge" | "/code";

export function entryUnitPath(kind: EntryKind): EntryUnitPath {
  return kind === "snippet" ? "/code" : "/knowledge";
}

export function entryUnitLabel(kind: EntryKind): "Knowledge" | "Code" {
  return kind === "snippet" ? "Code" : "Knowledge";
}

export function entryWorkspaceHref(
  kind: EntryKind,
  input: {
    folderId?: number | null;
    entryId?: number | null;
    trashId?: number | null;
  } = {},
): string {
  const params = new URLSearchParams();
  if (input.trashId !== undefined) {
    params.set("view", "trash");
    if (input.trashId !== null) params.set("trash", String(input.trashId));
  } else {
    if (input.folderId !== null && input.folderId !== undefined) {
      params.set("folder", String(input.folderId));
    }
    if (input.entryId !== null && input.entryId !== undefined) {
      params.set("entry", String(input.entryId));
    }
  }
  const query = params.toString();
  const path = entryUnitPath(kind);
  return query ? `${path}?${query}` : path;
}
