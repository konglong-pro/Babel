import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { writeLegacyJsonFiles } from "./json-writer";
import type { VaultSnapshot } from "./types";

type SnapshotEntry = VaultSnapshot["entries"][number];
type SnapshotTrash = VaultSnapshot["trash"][number];

export interface PlannedTrashMarkdownFile {
  fileName: string;
  sourceIndex: number;
  trash: SnapshotTrash;
  content: string;
}

export function serializeEntryMarkdown(entry: SnapshotEntry): string {
  return serializeEntryDocument(entry, []);
}

function serializeTrashMarkdown(trash: SnapshotTrash): string {
  const provenance =
    trash.deletedAt === null
      ? []
      : [`deletedAt: ${formatScalar(trash.deletedAt)}`];
  return serializeEntryDocument(trash.entry, provenance);
}

function serializeEntryDocument(
  entry: SnapshotEntry,
  extraFrontmatter: readonly string[],
): string {
  const frontmatter = [
    "---",
    `id: ${formatScalar(entry.id)}`,
    `title: ${formatScalar(entry.title)}`,
    "aliases:",
    ...entry.aliases.map((alias) => `  - ${formatScalar(alias)}`),
    `categoryId: ${formatScalar(entry.categoryId)}`,
    `order: ${entry.order}`,
    `createdAt: ${formatScalar(entry.createdAt)}`,
    `updatedAt: ${formatScalar(entry.updatedAt)}`,
    ...extraFrontmatter,
    "---",
  ];

  // The separator is formatting. The body itself is appended byte-for-byte: no
  // trimming, newline conversion, or synthetic trailing newline.
  return `${frontmatter.join("\n")}\n\n${entry.content}`;
}

export function planTrashMarkdownFiles(
  trashItems: readonly SnapshotTrash[],
): PlannedTrashMarkdownFile[] {
  const usedNames = new Set<string>();
  const plannedNames = new Map<number, string>();

  for (const [index, trash] of trashItems.entries()) {
    if (trash.sourceName === null) {
      continue;
    }
    assertSafeMarkdownFileName(trash.sourceName, "trash sourceName");
    reserveFileName(usedNames, trash.sourceName, "trash sourceName");
    plannedNames.set(index, trash.sourceName);
  }

  const generated = trashItems
    .map((trash, index) => ({ index, trash }))
    .filter(({ trash }) => trash.sourceName === null)
    .sort((left, right) => compareGeneratedTrash(left, right));

  for (const { index, trash } of generated) {
    assertSafePathStem(trash.originalEntryId, "trash originalEntryId");
    const timestamp = deletionTimestampToken(trash.deletedAt);
    const baseName = `${trash.originalEntryId}_${timestamp}.md`;
    const fileName = availableFileName(usedNames, baseName);
    reserveFileName(usedNames, fileName, "generated trash filename");
    plannedNames.set(index, fileName);
  }

  return trashItems
    .map((trash, index) => ({
      fileName: requiredPlannedName(plannedNames, index),
      sourceIndex: index,
      trash,
      content: serializeTrashMarkdown(trash),
    }))
    .sort((left, right) => compareText(left.fileName, right.fileName));
}

export async function writeLegacyMarkdownFiles(
  snapshot: VaultSnapshot,
  destination: string,
): Promise<void> {
  const root = path.resolve(destination);
  const entriesRoot = path.join(root, "entries");
  const reflectionsRoot = path.join(root, "reflections");
  const trashRoot = path.join(root, "trash");

  await Promise.all([
    mkdir(entriesRoot, { recursive: true }),
    mkdir(reflectionsRoot, { recursive: true }),
    mkdir(trashRoot, { recursive: true }),
  ]);

  const entryFiles = planEntryFiles(snapshot.entries, entriesRoot);
  const reflectionFiles = planReflectionFiles(snapshot.reflections, reflectionsRoot);
  const trashFiles = planTrashMarkdownFiles(snapshot.trash).map((file) => ({
    path: path.join(trashRoot, file.fileName),
    content: file.content,
  }));

  await Promise.all(
    [...entryFiles, ...reflectionFiles, ...trashFiles].map((file) =>
      writeFile(file.path, file.content, "utf8"),
    ),
  );
}

export async function writeLegacyVault(
  snapshot: VaultSnapshot,
  destination: string,
): Promise<void> {
  await Promise.all([
    writeLegacyJsonFiles(snapshot, destination),
    writeLegacyMarkdownFiles(snapshot, destination),
  ]);
}

function planEntryFiles(
  entries: readonly SnapshotEntry[],
  entriesRoot: string,
): Array<{ path: string; content: string }> {
  const names = new Set<string>();
  return entries
    .map((entry) => {
      assertSafePathStem(entry.id, "entry id");
      const fileName = `${entry.id}.md`;
      reserveFileName(names, fileName, "entry id");
      return {
        path: path.join(entriesRoot, fileName),
        content: serializeEntryMarkdown(entry),
      };
    })
    .sort((left, right) => compareText(left.path, right.path));
}

function planReflectionFiles(
  reflections: readonly VaultSnapshot["reflections"][number][],
  reflectionsRoot: string,
): Array<{ path: string; content: string }> {
  const names = new Set<string>();
  return reflections
    .map((reflection) => {
      if (!isValidCalendarDate(reflection.date)) {
        throw new Error(`Invalid reflection date for export: ${reflection.date}`);
      }
      const fileName = `${reflection.date}.md`;
      reserveFileName(names, fileName, "reflection date");
      return { path: path.join(reflectionsRoot, fileName), content: reflection.content };
    })
    .sort((left, right) => compareText(left.path, right.path));
}

function compareGeneratedTrash(
  left: { index: number; trash: SnapshotTrash },
  right: { index: number; trash: SnapshotTrash },
): number {
  return (
    compareText(left.trash.originalEntryId, right.trash.originalEntryId) ||
    compareText(left.trash.deletedAt ?? "", right.trash.deletedAt ?? "") ||
    compareText(entryKey(left.trash.entry), entryKey(right.trash.entry)) ||
    left.index - right.index
  );
}

function entryKey(entry: SnapshotEntry): string {
  return JSON.stringify({
    id: entry.id,
    title: entry.title,
    aliases: entry.aliases,
    categoryId: entry.categoryId,
    order: entry.order,
    content: entry.content,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  });
}

function deletionTimestampToken(deletedAt: string | null): string {
  if (deletedAt === null) {
    return "00000000000000";
  }
  const digits = deletedAt.replace(/\D/g, "").slice(0, 14);
  return digits.length === 14 ? digits : "00000000000000";
}

function availableFileName(usedNames: ReadonlySet<string>, preferred: string): string {
  if (!usedNames.has(canonicalFileName(preferred))) {
    return preferred;
  }
  const stem = preferred.slice(0, -3);
  let suffix = 2;
  while (usedNames.has(canonicalFileName(`${stem}_${suffix}.md`))) {
    suffix += 1;
  }
  return `${stem}_${suffix}.md`;
}

function reserveFileName(names: Set<string>, name: string, field: string): void {
  const canonical = canonicalFileName(name);
  if (names.has(canonical)) {
    throw new Error(`Duplicate ${field} export filename: ${name}`);
  }
  names.add(canonical);
}

function canonicalFileName(name: string): string {
  return name.toLowerCase();
}

function requiredPlannedName(names: ReadonlyMap<number, string>, index: number): string {
  const name = names.get(index);
  if (name === undefined) {
    throw new Error(`Trash item ${index} has no planned filename`);
  }
  return name;
}

function assertSafeMarkdownFileName(name: string, field: string): void {
  assertSafePathComponent(name, field);
  if (!name.toLowerCase().endsWith(".md")) {
    throw new Error(`${field} must end in .md: ${name}`);
  }
}

function assertSafePathStem(value: string, field: string): void {
  assertSafePathComponent(value, field);
}

function assertSafePathComponent(value: string, field: string): void {
  const invalidWindowsName = /[<>:"/\\|?*\u0000-\u001f]/.test(value);
  const reservedWindowsName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value);
  if (
    !value ||
    value === "." ||
    value === ".." ||
    value.endsWith(".") ||
    value.endsWith(" ") ||
    invalidWindowsName ||
    reservedWindowsName ||
    path.posix.basename(value) !== value ||
    path.win32.basename(value) !== value
  ) {
    throw new Error(`Unsafe ${field} for export: ${value}`);
  }
}

function isValidCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function formatScalar(value: string): string {
  return JSON.stringify(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
