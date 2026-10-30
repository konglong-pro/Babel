import type { PdfFolder } from "@babel-apps/platform/pdf/core";

export interface PdfFolderEntry {
  folder: PdfFolder;
  path: string;
  depth: number;
  children: PdfFolderEntry[];
}

export function isPdfFolder(value: unknown): value is PdfFolder {
  if (!value || typeof value !== "object") return false;
  const folder = value as Partial<PdfFolder>;
  return typeof folder.id === "string" && /^[0-9a-f-]{36}$/u.test(folder.id) &&
    typeof folder.name === "string" && (folder.parentId === null || typeof folder.parentId === "string") &&
    typeof folder.createdAt === "string" && typeof folder.updatedAt === "string";
}

/** Keep the server's sibling order while deriving paths for navigation and fields. */
export function pdfFolderEntries(folders: readonly PdfFolder[]): PdfFolderEntry[] {
  const ids = new Set(folders.map((folder) => folder.id));
  const children = new Map<string | null, PdfFolder[]>();
  for (const folder of folders) {
    const parent = folder.parentId !== folder.id && ids.has(folder.parentId ?? "") ? folder.parentId : null;
    const siblings = children.get(parent) ?? [];
    siblings.push(folder);
    children.set(parent, siblings);
  }
  const seen = new Set<string>();
  const result: PdfFolderEntry[] = [];
  function append(folder: PdfFolder, parent?: PdfFolderEntry): PdfFolderEntry | null {
    if (seen.has(folder.id)) return null;
    seen.add(folder.id);
    const entry: PdfFolderEntry = {
      folder, path: parent ? `${parent.path} / ${folder.name}` : folder.name,
      depth: parent ? parent.depth + 1 : 0, children: [],
    };
    result.push(entry);
    for (const child of children.get(folder.id) ?? []) {
      const node = append(child, entry);
      if (node) entry.children.push(node);
    }
    return entry;
  }
  for (const folder of children.get(null) ?? []) append(folder);
  // A stale or malformed response must still be navigable without recursive cycles.
  for (const folder of folders) if (!seen.has(folder.id)) append(folder);
  return result;
}

export function pdfFolderSubtreeIds(folders: readonly PdfFolder[], id: string): Set<string> {
  const result = new Set([id]);
  const children = new Map<string, string[]>();
  for (const folder of folders) {
    if (folder.parentId === null) continue;
    const siblings = children.get(folder.parentId) ?? [];
    siblings.push(folder.id);
    children.set(folder.parentId, siblings);
  }
  const queue = [id];
  for (let index = 0; index < queue.length; index += 1) {
    for (const child of children.get(queue[index]) ?? []) {
      if (!result.has(child)) { result.add(child); queue.push(child); }
    }
  }
  return result;
}
