import { maskCodeRegions } from "@babel-apps/markdown/core";

import {
  ENTRY_NEW_IMAGE_MAX_COUNT,
  ENTRY_NOTES_MAX_BYTES,
} from "@/lib/entry-limits";

const MARKDOWN_EXTENSION = /\.md$/i;
const REMOTE_IMAGE_PATTERN = /^(?:https?:)?\/\//i;
const URL_SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const WINDOWS_DRIVE_PATTERN = /^[A-Za-z]:[\\/]/;
const MARKDOWN_ESCAPE_PATTERN = /\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g;

export type MarkdownImportErrorCode =
  | "INVALID_FILE_TYPE"
  | "FILE_TOO_LARGE"
  | "INVALID_UTF8"
  | "UNSAFE_IMAGE_PATH"
  | "TOO_MANY_IMAGES";

export class MarkdownImportError extends Error {
  constructor(
    readonly code: MarkdownImportErrorCode,
    message: string,
    readonly path?: string,
  ) {
    super(message);
    this.name = "MarkdownImportError";
  }
}

export interface ImportedImageReference {
  path: string;
  basename: string;
  token: string;
}

export interface MarkdownImportDraft {
  title: string;
  contentMd: string;
  imageReferences: ImportedImageReference[];
}

export interface ImportedImageMatch<TFile extends { name: string }> {
  reference: ImportedImageReference;
  file: TFile;
}

export interface ImportedImageMatchResult<TFile extends { name: string }> {
  matches: ImportedImageMatch<TFile>[];
  unresolved: ImportedImageReference[];
  unmatchedFiles: TFile[];
}

interface DestinationSpan {
  destination: string;
  start: number;
  end: number;
}

interface Replacement {
  start: number;
  end: number;
  value: string;
}

export function parseMarkdownImport(
  fileName: string,
  bytes: Uint8Array,
): MarkdownImportDraft {
  const leafName = fileName.replace(/^.*[\\/]/, "");
  if (!MARKDOWN_EXTENSION.test(leafName)) {
    throw new MarkdownImportError(
      "INVALID_FILE_TYPE",
      "Choose a Markdown file with a .md extension.",
    );
  }
  if (bytes.byteLength > ENTRY_NOTES_MAX_BYTES) {
    throw new MarkdownImportError(
      "FILE_TOO_LARGE",
      "Markdown files must not exceed 10 MiB.",
    );
  }

  let contentMd: string;
  try {
    contentMd = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new MarkdownImportError(
      "INVALID_UTF8",
      "The Markdown file is not valid UTF-8.",
    );
  }
  if (contentMd.startsWith("\uFEFF")) contentMd = contentMd.slice(1);

  const rewritten = rewriteImportedImages(contentMd);
  if (rewritten.imageReferences.length > ENTRY_NEW_IMAGE_MAX_COUNT) {
    throw new MarkdownImportError(
      "TOO_MANY_IMAGES",
      `An entry can import at most ${ENTRY_NEW_IMAGE_MAX_COUNT} local images at once.`,
    );
  }
  return {
    title: leafName.replace(MARKDOWN_EXTENSION, ""),
    contentMd: rewritten.contentMd,
    imageReferences: rewritten.imageReferences,
  };
}

export function rewriteImportedImages(contentMd: string): Pick<
  MarkdownImportDraft,
  "contentMd" | "imageReferences"
> {
  const codeMask = maskCodeRegions(contentMd);
  markIndentedCodeRegions(contentMd, codeMask);
  const inlineDestinations: DestinationSpan[] = [];
  const referenceLabels = new Set<string>();

  for (let index = 0; index < contentMd.length; index += 1) {
    if (
      codeMask[index] ||
      contentMd[index] !== "!" ||
      contentMd[index + 1] !== "[" ||
      isEscaped(contentMd, index)
    ) {
      continue;
    }
    const labelEnd = findClosingBracket(contentMd, index + 1);
    if (labelEnd === -1) continue;
    const label = contentMd.slice(index + 2, labelEnd);
    const next = contentMd[labelEnd + 1];
    if (next === "(") {
      const destination = parseInlineDestination(contentMd, labelEnd + 2);
      if (destination !== null && !codeMask[destination.start]) {
        inlineDestinations.push(destination);
        index = destination.end;
      }
      continue;
    }
    if (next === "[") {
      const referenceEnd = findClosingBracket(contentMd, labelEnd + 1);
      if (referenceEnd !== -1) {
        const explicit = contentMd.slice(labelEnd + 2, referenceEnd);
        referenceLabels.add(normalizeReferenceLabel(explicit || label));
        index = referenceEnd;
      }
      continue;
    }
    referenceLabels.add(normalizeReferenceLabel(label));
    index = labelEnd;
  }

  const definitions = referenceDefinitions(contentMd, codeMask);
  const referencedDestinations = [...referenceLabels].flatMap((label) => {
    const definition = definitions.get(label);
    return definition === undefined ? [] : [definition];
  });
  const referencesByPath = new Map<string, ImportedImageReference>();
  const replacements: Replacement[] = [];

  for (const destination of [...inlineDestinations, ...referencedDestinations]) {
    const raw = unescapeMarkdownDestination(destination.destination.trim());
    if (REMOTE_IMAGE_PATTERN.test(raw)) continue;
    const local = normalizeLocalImagePath(raw);
    let reference = referencesByPath.get(local.path);
    if (reference === undefined) {
      reference = { ...local, token: stableImageToken(local.path) };
      referencesByPath.set(local.path, reference);
    }
    replacements.push({
      start: destination.start,
      end: destination.end,
      value: `neum-upload://${reference.token}`,
    });
  }

  let rewritten = contentMd;
  replacements
    .sort((left, right) => right.start - left.start)
    .forEach(({ start, end, value }) => {
      rewritten = `${rewritten.slice(0, start)}${value}${rewritten.slice(end)}`;
    });
  return { contentMd: rewritten, imageReferences: [...referencesByPath.values()] };
}

export function matchImportedImagesByBasename<TFile extends { name: string }>(
  references: readonly ImportedImageReference[],
  files: readonly TFile[],
): ImportedImageMatchResult<TFile> {
  const referencesByName = groupByName(references, ({ basename }) => basename);
  const filesByName = groupByName(files, ({ name }) => name);
  const matches: ImportedImageMatch<TFile>[] = [];
  const matchedReferences = new Set<ImportedImageReference>();
  const matchedFiles = new Set<TFile>();

  for (const [key, matchingReferences] of referencesByName) {
    const matchingFiles = filesByName.get(key) ?? [];
    if (matchingReferences.length !== 1 || matchingFiles.length !== 1) continue;
    matches.push({ reference: matchingReferences[0], file: matchingFiles[0] });
    matchedReferences.add(matchingReferences[0]);
    matchedFiles.add(matchingFiles[0]);
  }
  return {
    matches,
    unresolved: references.filter((reference) => !matchedReferences.has(reference)),
    unmatchedFiles: files.filter((file) => !matchedFiles.has(file)),
  };
}

function groupByName<T>(
  values: readonly T[],
  name: (value: T) => string,
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const value of values) {
    const key = name(value).normalize("NFC").toLocaleLowerCase("en-US");
    grouped.set(key, [...(grouped.get(key) ?? []), value]);
  }
  return grouped;
}

function markIndentedCodeRegions(markdown: string, mask: Uint8Array): void {
  let activeListIndent: number | null = null;
  let previousQuoteDepth = 0;
  let lineStart = 0;

  while (lineStart < markdown.length) {
    const newline = markdown.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? markdown.length : newline;
    const line = markdown.slice(lineStart, lineEnd).replace(/\r$/, "");
    const quote = blockquotePrefix(line);
    if (quote.depth !== previousQuoteDepth) activeListIndent = null;
    previousQuoteDepth = quote.depth;
    const content = line.slice(quote.offset);
    if (!/^[ \t]*$/.test(content)) {
      const indentation = leadingIndent(content);
      const marker = /^(?:[*+-]|\d{1,9}[.)])(?=[ \t]|$)/.exec(
        content.slice(indentation.index),
      )?.[0];
      if (marker !== undefined) {
        const spacing = /^[ \t]+/.exec(
          content.slice(indentation.index + marker.length),
        )?.[0] ?? " ";
        activeListIndent = indentation.columns + marker.length + leadingIndent(spacing).columns;
      } else {
        if (activeListIndent !== null && indentation.columns < activeListIndent) {
          activeListIndent = null;
        }
        const codeIndent = activeListIndent === null ? 4 : activeListIndent + 4;
        if (indentation.columns >= codeIndent) {
          mask.fill(1, lineStart + quote.offset, lineEnd);
        }
      }
    }
    if (newline === -1) break;
    lineStart = newline + 1;
  }
}

function blockquotePrefix(line: string): { depth: number; offset: number } {
  let depth = 0;
  let offset = 0;
  while (offset < line.length) {
    const marker = /^ {0,3}>[ \t]?/.exec(line.slice(offset))?.[0];
    if (marker === undefined) break;
    offset += marker.length;
    depth += 1;
  }
  return { depth, offset };
}

function leadingIndent(value: string): { columns: number; index: number } {
  let columns = 0;
  let index = 0;
  while (index < value.length) {
    if (value[index] === " ") columns += 1;
    else if (value[index] === "\t") columns += 4 - (columns % 4);
    else break;
    index += 1;
  }
  return { columns, index };
}

function referenceDefinitions(
  markdown: string,
  codeMask: Uint8Array,
): Map<string, DestinationSpan> {
  const definitions = new Map<string, DestinationSpan>();
  let lineStart = 0;
  while (lineStart < markdown.length) {
    const newline = markdown.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? markdown.length : newline;
    const line = markdown.slice(lineStart, lineEnd).replace(/\r$/, "");
    const match = /^((?:[ \t]*>[ \t]*)*[ \t]*\[([^\]\r\n]+)\]:[ \t]*)(?:<([^>\r\n]+)>|([^\s]+))/.exec(line);
    if (match !== null) {
      const destination = match[3] ?? match[4];
      const start = lineStart + match[1].length + (match[3] === undefined ? 0 : 1);
      const label = normalizeReferenceLabel(match[2]);
      if (!codeMask[start] && !definitions.has(label)) {
        definitions.set(label, { destination, start, end: start + destination.length });
      }
    }
    if (newline === -1) break;
    lineStart = newline + 1;
  }
  return definitions;
}

function parseInlineDestination(markdown: string, startIndex: number): DestinationSpan | null {
  let index = startIndex;
  while (index < markdown.length && /[ \t\r\n]/.test(markdown[index])) index += 1;
  if (markdown[index] === "<") {
    const start = index + 1;
    const end = findUnescaped(markdown, ">", start);
    if (end === -1 || findUnescaped(markdown, ")", end + 1) === -1) return null;
    return { destination: markdown.slice(start, end), start, end };
  }

  const start = index;
  let nestedParentheses = 0;
  for (; index < markdown.length; index += 1) {
    const character = markdown[index];
    if (character === "\\" && index + 1 < markdown.length) {
      index += 1;
      continue;
    }
    if (character === "(") {
      nestedParentheses += 1;
      continue;
    }
    if (character === ")") {
      if (nestedParentheses === 0) {
        return index > start
          ? { destination: markdown.slice(start, index), start, end: index }
          : null;
      }
      nestedParentheses -= 1;
      continue;
    }
    if (/\s/.test(character)) {
      const close = findUnescaped(markdown, ")", index);
      return index > start && close !== -1
        ? { destination: markdown.slice(start, index), start, end: index }
        : null;
    }
  }
  return null;
}

function normalizeLocalImagePath(destination: string): {
  path: string;
  basename: string;
} {
  let decoded: string;
  try {
    decoded = decodeURIComponent(destination);
  } catch {
    throw unsafeImagePath(destination);
  }
  const pathOnly = decoded.split(/[?#]/, 1)[0];
  if (
    !pathOnly ||
    pathOnly.includes("\0") ||
    pathOnly.startsWith("/") ||
    pathOnly.startsWith("\\") ||
    WINDOWS_DRIVE_PATTERN.test(pathOnly) ||
    URL_SCHEME_PATTERN.test(pathOnly)
  ) {
    throw unsafeImagePath(destination);
  }
  const segments = pathOnly.replaceAll("\\", "/").split("/");
  if (segments.some((segment) => segment === "..")) throw unsafeImagePath(destination);
  const normalizedSegments = segments.filter((segment) => segment && segment !== ".");
  const basename = normalizedSegments.at(-1);
  if (!basename) throw unsafeImagePath(destination);
  return { path: normalizedSegments.join("/"), basename };
}

function unsafeImagePath(path: string): MarkdownImportError {
  return new MarkdownImportError(
    "UNSAFE_IMAGE_PATH",
    `The image path "${path}" is not a safe relative path.`,
    path,
  );
}

function stableImageToken(path: string): string {
  const bytes = new TextEncoder().encode(path);
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (const byte of bytes) {
    first = Math.imul(first ^ byte, 0x01000193) >>> 0;
    second = Math.imul(second ^ byte, 0x85ebca6b) >>> 0;
  }
  return `import-${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}

function normalizeReferenceLabel(label: string): string {
  return label
    .replace(MARKDOWN_ESCAPE_PATTERN, "$1")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-US");
}

function unescapeMarkdownDestination(destination: string): string {
  return destination.replace(MARKDOWN_ESCAPE_PATTERN, "$1");
}

function findClosingBracket(markdown: string, startIndex: number): number {
  let depth = 0;
  for (let index = startIndex; index < markdown.length; index += 1) {
    if (isEscaped(markdown, index)) continue;
    if (markdown[index] === "[") depth += 1;
    if (markdown[index] === "]") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function findUnescaped(markdown: string, target: string, startIndex: number): number {
  for (let index = startIndex; index < markdown.length; index += 1) {
    if (markdown[index] === target && !isEscaped(markdown, index)) return index;
  }
  return -1;
}

function isEscaped(markdown: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && markdown[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}
