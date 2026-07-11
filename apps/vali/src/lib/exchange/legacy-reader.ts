import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";

import type { Category, Entry, Reflection } from "../vali/types";
import type {
  TrashSnapshot,
  VaultConfig,
  VaultSnapshot,
} from "./types";

export async function readLegacyVault(root: string): Promise<VaultSnapshot> {
  await validateRootLayout(root);
  const config = parseConfig(await readJson(join(root, "vali.json"), "vali.json"));
  const categories = parseCategories(
    await readJson(join(root, "categories.json"), "categories.json"),
  );
  const entries = await readEntries(join(root, "entries"));
  const reflections = await readReflections(join(root, "reflections"));
  const trash = await readTrash(join(root, "trash"));
  const snapshot = { config, categories, entries, reflections, trash };

  validateRelationships(snapshot);
  return snapshot;
}

async function validateRootLayout(root: string): Promise<void> {
  const expectedFiles = new Set(["vali.json", "categories.json"]);
  const expectedDirectories = new Set(["entries", "reflections", "trash"]);
  const found = new Set<string>();

  for (const item of await readdir(root, { withFileTypes: true })) {
    found.add(item.name);
    if (
      (expectedFiles.has(item.name) && item.isFile()) ||
      (expectedDirectories.has(item.name) && item.isDirectory())
    ) {
      continue;
    }
    throw new Error(`Unexpected vault item: ${item.name}`);
  }

  for (const name of [...expectedFiles, ...expectedDirectories]) {
    if (!found.has(name)) {
      throw new Error(`Legacy vault is missing ${name}`);
    }
  }
}

async function readJson(path: string, label: string): Promise<unknown> {
  const source = await readUtf8(path, label);
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error });
  }
}

async function readUtf8(path: string, label: string): Promise<string> {
  const bytes = await readFile(path);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new Error(`${label} must not contain a UTF-8 BOM`);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error(`${label} is not valid UTF-8`, { cause: error });
  }
}

function parseConfig(value: unknown): VaultConfig {
  const record = expectRecord(value, "vali.json");
  assertKnownKeys(
    record,
    new Set(["name", "version", "createdAt", "defaultCategoryId"]),
    "vali.json",
  );
  return {
    name: expectString(record.name, "vali.json.name"),
    version: expectInteger(record.version, "vali.json.version"),
    createdAt: expectString(record.createdAt, "vali.json.createdAt"),
    defaultCategoryId: expectString(
      record.defaultCategoryId,
      "vali.json.defaultCategoryId",
    ),
  };
}

function parseCategories(value: unknown): Category[] {
  if (!Array.isArray(value)) {
    throw new Error("categories.json must contain an array");
  }

  return value.map((item, index) => {
    const label = `categories.json[${index}]`;
    const record = expectRecord(item, label);
    assertKnownKeys(
      record,
      new Set(["id", "name", "order", "content", "createdAt", "updatedAt"]),
      label,
    );
    return {
      id: expectString(record.id, `${label}.id`),
      name: expectString(record.name, `${label}.name`),
      order: expectInteger(record.order, `${label}.order`),
      content:
        record.content === undefined
          ? ""
          : expectString(record.content, `${label}.content`),
      createdAt: expectString(record.createdAt, `${label}.createdAt`),
      updatedAt: expectString(record.updatedAt, `${label}.updatedAt`),
    };
  });
}

async function readEntries(directory: string): Promise<Entry[]> {
  const names = await markdownNames(directory);
  return Promise.all(
    names.map(async (name) => {
      const entry = parseEntryMarkdown(
        await readUtf8(join(directory, name), `entries/${name}`),
        `entries/${name}`,
      );
      if (name !== `${entry.id}.md`) {
        throw new Error(`Entry filename does not match its id: ${name}`);
      }
      return entry;
    }),
  );
}

async function readReflections(directory: string): Promise<Reflection[]> {
  const names = await markdownNames(directory);
  return Promise.all(
    names
      .sort()
      .reverse()
      .map(async (name) => ({
        date: basename(name, ".md"),
        content: normalizeNewlines(
          await readUtf8(join(directory, name), `reflections/${name}`),
        ),
      })),
  );
}

async function readTrash(directory: string): Promise<TrashSnapshot[]> {
  const names = await markdownNames(directory);
  return Promise.all(
    names.map(async (sourceName) => {
      const { entry, deletedAt } = parseTrashMarkdown(
        await readUtf8(join(directory, sourceName), `trash/${sourceName}`),
        `trash/${sourceName}`,
      );
      const plainName = `${entry.id}.md`;
      const suffixedName = new RegExp(
        `^${escapeRegExp(entry.id)}_\\d{14}(?:_(?:[2-9]|[1-9]\\d+))?\\.md$`,
      );
      if (sourceName !== plainName && !suffixedName.test(sourceName)) {
        throw new Error(`Trash filename does not match its entry id: ${sourceName}`);
      }
      return {
        sourceName,
        originalEntryId: entry.id,
        deletedAt,
        entry,
      };
    }),
  );
}

async function markdownNames(directory: string): Promise<string[]> {
  const names: string[] = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (item.isFile() && item.name === ".gitkeep") {
      continue;
    }
    if (item.isFile() && item.name.endsWith(".md")) {
      names.push(item.name);
      continue;
    }
    throw new Error(`Unexpected vault item: ${item.name}`);
  }
  return names.sort();
}

interface ParsedEntryDocument {
  entry: Entry;
  deletedAt: string | null;
}

function parseEntryMarkdown(source: string, label: string): Entry {
  return parseEntryDocument(source, label, false).entry;
}

function parseTrashMarkdown(source: string, label: string): ParsedEntryDocument {
  return parseEntryDocument(source, label, true);
}

function parseEntryDocument(
  source: string,
  label: string,
  allowDeletedAt: boolean,
): ParsedEntryDocument {
  const lines = normalizeNewlines(source).split("\n");
  if (lines[0]?.trim() !== "---") {
    throw new Error(`${label} is missing frontmatter`);
  }

  const endIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (endIndex === -1) {
    throw new Error(`${label} frontmatter is not closed`);
  }

  const metadata: Record<string, string | string[]> = {};
  const knownKeys = new Set([
    "id",
    "title",
    "aliases",
    "categoryId",
    "order",
    "createdAt",
    "updatedAt",
  ]);
  if (allowDeletedAt) {
    knownKeys.add("deletedAt");
  }
  const seenKeys = new Set<string>();
  let index = 1;
  while (index < endIndex) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (line.startsWith("aliases:")) {
      assertFrontmatterKey("aliases", knownKeys, seenKeys, label);
      const aliases: string[] = [];
      index += 1;
      while (index < endIndex && lines[index].startsWith("  -")) {
        aliases.push(parseScalar(lines[index].slice(lines[index].indexOf("-") + 1)));
        index += 1;
      }
      metadata.aliases = aliases;
      continue;
    }

    const separator = line.indexOf(":");
    if (separator === -1) {
      throw new Error(`${label} has an invalid frontmatter line`);
    }
    const key = line.slice(0, separator).trim();
    assertFrontmatterKey(key, knownKeys, seenKeys, label);
    metadata[key] = parseScalar(line.slice(separator + 1));
    index += 1;
  }

  const aliases = metadata.aliases ?? [];
  if (!Array.isArray(aliases)) {
    throw new Error(`${label}.aliases must be a list`);
  }

  return {
    entry: {
      id: expectString(metadata.id, `${label}.id`),
      title: expectString(metadata.title, `${label}.title`),
      aliases,
      categoryId: expectString(metadata.categoryId, `${label}.categoryId`),
      order:
        metadata.order === undefined
          ? 0
          : parseIntegerString(metadata.order, `${label}.order`),
      content: lines.slice(endIndex + 1).join("\n").replace(/^\n/, ""),
      createdAt: expectString(metadata.createdAt, `${label}.createdAt`),
      updatedAt: expectString(metadata.updatedAt, `${label}.updatedAt`),
    },
    deletedAt:
      allowDeletedAt && metadata.deletedAt !== undefined
        ? expectString(metadata.deletedAt, `${label}.deletedAt`)
        : null,
  };
}

function parseScalar(source: string): string {
  const value = source.trim();
  if (!value) {
    return "";
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed === null) {
      return "None";
    }
    if (parsed === true) {
      return "True";
    }
    if (parsed === false) {
      return "False";
    }
    if (typeof parsed === "number") {
      return /^-?\d+$/.test(value) ? BigInt(value).toString() : value;
    }
    return String(parsed);
  } catch {
    return value;
  }
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function validateRelationships(snapshot: VaultSnapshot): void {
  if (snapshot.config.version !== 1) {
    throw new Error("Legacy vault must use version 1");
  }
  assertTimestamp(snapshot.config.createdAt, "vault createdAt");

  const categoryIds = new Set<string>();
  const categoryNames = new Set<string>();
  for (const category of snapshot.categories) {
    if (!category.id.startsWith("cat_") || category.id.length === 4) {
      throw new Error(`Invalid category id prefix: ${category.id}`);
    }
    if (categoryIds.has(category.id)) {
      throw new Error(`Duplicate category id: ${category.id}`);
    }
    if (categoryNames.has(category.name)) {
      throw new Error(`Duplicate category name: ${category.name}`);
    }
    categoryIds.add(category.id);
    categoryNames.add(category.name);
    assertTimestamp(category.createdAt, `category ${category.id} createdAt`);
    assertTimestamp(category.updatedAt, `category ${category.id} updatedAt`);
  }

  if (!categoryIds.has(snapshot.config.defaultCategoryId)) {
    throw new Error(
      `Default category does not exist: ${snapshot.config.defaultCategoryId}`,
    );
  }

  const entryIds = new Set<string>();
  const titlesByCategory = new Map<string, Set<string>>();
  for (const entry of snapshot.entries) {
    if (!entry.id.startsWith("ent_") || entry.id.length === 4) {
      throw new Error(`Invalid entry id prefix: ${entry.id}`);
    }
    if (entryIds.has(entry.id)) {
      throw new Error(`Duplicate entry id: ${entry.id}`);
    }
    if (!categoryIds.has(entry.categoryId)) {
      throw new Error(`Entry references missing category: ${entry.categoryId}`);
    }

    const titles = titlesByCategory.get(entry.categoryId) ?? new Set<string>();
    if (titles.has(entry.title)) {
      throw new Error(
        `Duplicate entry title in category ${entry.categoryId}: ${entry.title}`,
      );
    }
    titles.add(entry.title);
    titlesByCategory.set(entry.categoryId, titles);
    entryIds.add(entry.id);
    validateAliases(entry.aliases, `entry ${entry.id}`);
    assertTimestamp(entry.createdAt, `entry ${entry.id} createdAt`);
    assertTimestamp(entry.updatedAt, `entry ${entry.id} updatedAt`);
  }

  for (const item of snapshot.trash) {
    if (!item.originalEntryId.startsWith("ent_") || item.originalEntryId.length === 4) {
      throw new Error(`Invalid entry id prefix: ${item.originalEntryId}`);
    }
    validateAliases(item.entry.aliases, `trash entry ${item.originalEntryId}`);
    assertTimestamp(item.entry.createdAt, `trash entry ${item.originalEntryId} createdAt`);
    assertTimestamp(item.entry.updatedAt, `trash entry ${item.originalEntryId} updatedAt`);
    if (item.deletedAt !== null) {
      assertTimestamp(item.deletedAt, `trash entry ${item.originalEntryId} deletedAt`);
    }
  }

  for (const reflection of snapshot.reflections) {
    if (!isValidDate(reflection.date)) {
      throw new Error(`Invalid reflection date: ${reflection.date}`);
    }
  }
}

function validateAliases(aliases: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const alias of aliases) {
    if (!alias || alias !== alias.trim()) {
      throw new Error(`${label} alias must be nonempty and trimmed`);
    }
    if (seen.has(alias)) {
      throw new Error(`${label} has duplicate alias: ${alias}`);
    }
    seen.add(alias);
  }
}

function assertTimestamp(value: string, label: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/.exec(value);
  if (
    !match ||
    !isValidDate(`${match[1]}-${match[2]}-${match[3]}`) ||
    Number(match[4]) > 23 ||
    Number(match[5]) > 59 ||
    Number(match[6]) > 59
  ) {
    throw new Error(`${label} is not a valid UTC timestamp: ${value}`);
  }
}

function isValidDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const days = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must contain an object`);
  }
  return value as Record<string, unknown>;
}

function assertKnownKeys(
  record: Record<string, unknown>,
  knownKeys: ReadonlySet<string>,
  label: string,
): void {
  for (const key of Object.keys(record)) {
    if (!knownKeys.has(key)) {
      throw new Error(`${label} has unknown field: ${key}`);
    }
  }
}

function assertFrontmatterKey(
  key: string,
  knownKeys: ReadonlySet<string>,
  seenKeys: Set<string>,
  label: string,
): void {
  if (!knownKeys.has(key)) {
    throw new Error(`${label} has unknown field: ${key}`);
  }
  if (seenKeys.has(key)) {
    throw new Error(`${label} has duplicate field: ${key}`);
  }
  seenKeys.add(key);
}

function expectString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  return value;
}

function expectInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`${label} must be an integer`);
  }
  return value;
}

function parseIntegerString(value: unknown, label: string): number {
  const source = expectString(value, label);
  if (!/^[+-]?\d+$/.test(source)) {
    throw new Error(`${label} must be an integer`);
  }
  const parsed = Number(source);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${label} must be a safe integer`);
  }
  return parsed;
}
