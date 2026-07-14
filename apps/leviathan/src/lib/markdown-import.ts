import {
  NOTE_CONTENT_MAX_BYTES,
  NOTE_NEW_IMAGE_MAX_COUNT,
} from "./note-limits";

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
  /** Decoded, slash-normalized relative path used to identify repeated references. */
  path: string;
  /** Decoded filename used by the browser image picker for matching. */
  basename: string;
  /** Stable token accepted by the note multipart API. */
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

interface ReferenceDefinition extends DestinationSpan {
  label: string;
}

interface Replacement {
  start: number;
  end: number;
  value: string;
}

interface LocalImagePath {
  path: string;
  basename: string;
}

interface ListContainer {
  contentIndent: number;
}

interface ContainerState {
  quoteDepth: number;
  listStack: ListContainer[];
}

/**
 * Decode one browser-selected Markdown file into an unsaved Leviathan draft.
 * The function deliberately accepts byte data so Node tests exercise the same
 * strict UTF-8 boundary as the browser integration.
 */
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
  if (bytes.byteLength > NOTE_CONTENT_MAX_BYTES) {
    throw new MarkdownImportError(
      "FILE_TOO_LARGE",
      "Markdown files must not exceed 10 MB.",
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
  if (rewritten.imageReferences.length > NOTE_NEW_IMAGE_MAX_COUNT) {
    throw new MarkdownImportError(
      "TOO_MANY_IMAGES",
      `A note can import at most ${NOTE_NEW_IMAGE_MAX_COUNT} local images at once.`,
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
  const codeMask = markdownCodeMask(contentMd);
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
      if (destination !== null) {
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

    // A shortcut reference is an image only when a matching definition exists.
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
    if (isRemoteImage(raw)) continue;

    const local = normalizeLocalImagePath(raw);
    let reference = referencesByPath.get(local.path);
    if (reference === undefined) {
      reference = {
        ...local,
        token: stableImageToken(local.path),
      };
      referencesByPath.set(local.path, reference);
    }
    replacements.push({
      start: destination.start,
      end: destination.end,
      value: `leviathan-upload://${reference.token}`,
    });
  }

  let rewritten = contentMd;
  replacements
    .sort((left, right) => right.start - left.start)
    .forEach(({ start, end, value }) => {
      rewritten = `${rewritten.slice(0, start)}${value}${rewritten.slice(end)}`;
    });

  return {
    contentMd: rewritten,
    imageReferences: [...referencesByPath.values()],
  };
}

/**
 * Match only unambiguous basename pairs. A duplicate reference basename or a
 * duplicate selected filename remains unresolved for explicit user choice.
 */
export function matchImportedImagesByBasename<TFile extends { name: string }>(
  references: readonly ImportedImageReference[],
  files: readonly TFile[],
): ImportedImageMatchResult<TFile> {
  const referencesByName = new Map<string, ImportedImageReference[]>();
  for (const reference of references) {
    const key = imageBasenameKey(reference.basename);
    referencesByName.set(key, [...(referencesByName.get(key) ?? []), reference]);
  }
  const filesByName = new Map<string, TFile[]>();
  for (const file of files) {
    const key = imageBasenameKey(file.name);
    filesByName.set(key, [...(filesByName.get(key) ?? []), file]);
  }

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

function imageBasenameKey(value: string): string {
  return value.normalize("NFC").toLocaleLowerCase("en-US");
}

function isRemoteImage(destination: string): boolean {
  return REMOTE_IMAGE_PATTERN.test(destination);
}

function normalizeLocalImagePath(destination: string): LocalImagePath {
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
  if (segments.some((segment) => segment === "..")) {
    throw unsafeImagePath(destination);
  }
  const normalizedSegments = segments.filter((segment) => segment && segment !== ".");
  const basename = normalizedSegments.at(-1);
  if (!basename) throw unsafeImagePath(destination);

  return {
    path: normalizedSegments.join("/"),
    basename,
  };
}

function unsafeImagePath(path: string): MarkdownImportError {
  return new MarkdownImportError(
    "UNSAFE_IMAGE_PATH",
    `The image path “${path}” is not a safe relative path.`,
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

function unescapeMarkdownDestination(destination: string): string {
  return destination.replace(MARKDOWN_ESCAPE_PATTERN, "$1");
}

function referenceDefinitions(
  markdown: string,
  codeMask: Uint8Array,
): Map<string, ReferenceDefinition> {
  const definitions = new Map<string, ReferenceDefinition>();
  const pattern = /^([ \t]{0,3}\[([^\]\r\n]+)\]:[ \t]*)(?:<([^>\r\n]+)>|([^\s]+))/;
  const state: ContainerState = { quoteDepth: 0, listStack: [] };
  let lineStart = 0;
  while (lineStart < markdown.length) {
    const newline = markdown.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? markdown.length : newline;
    const line = markdown.slice(lineStart, lineEnd).replace(/\r$/, "");
    const contentOffset = containerContentOffset(line, state);
    const match = pattern.exec(line.slice(contentOffset));
    if (match === null) {
      lineStart = lineEnd + 1;
      continue;
    }
    const matchIndex = lineStart + contentOffset;
    if (codeMask[matchIndex]) {
      lineStart = lineEnd + 1;
      continue;
    }
    const label = normalizeReferenceLabel(match[2]);
    if (definitions.has(label)) {
      lineStart = lineEnd + 1;
      continue;
    }
    const angleDestination = match[3];
    const destination = angleDestination ?? match[4];
    const start = matchIndex + match[1].length + (angleDestination === undefined ? 0 : 1);
    definitions.set(label, {
      label,
      destination,
      start,
      end: start + destination.length,
    });
    lineStart = lineEnd + 1;
  }
  return definitions;
}

function normalizeReferenceLabel(label: string): string {
  return label
    .replace(MARKDOWN_ESCAPE_PATTERN, "$1")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-US");
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

/** Marks fenced, indented, and inline code without modifying source offsets. */
function markdownCodeMask(markdown: string): Uint8Array {
  const mask = new Uint8Array(markdown.length);
  let fence: {
    marker: string;
    length: number;
    quoteDepth: number;
    listDepth: number;
  } | null = null;
  const state: ContainerState = { quoteDepth: 0, listStack: [] };
  let lineStart = 0;

  while (lineStart < markdown.length) {
    const newline = markdown.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? markdown.length : newline;
    const line = markdown.slice(lineStart, lineEnd).replace(/\r$/, "");
    const contentOffset = containerContentOffset(line, state);
    const contentLine = line.slice(contentOffset);
    if (
      fence !== null &&
      (
        state.quoteDepth < fence.quoteDepth ||
        state.listStack.length < fence.listDepth
      )
    ) {
      fence = null;
    }
    const marker = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(contentLine)?.[1];
    const closesFence =
      fence !== null &&
      marker !== undefined &&
      marker[0] === fence.marker &&
      marker.length >= fence.length;

    if (fence !== null || marker !== undefined || /^(?: {4}|\t)/.test(contentLine)) {
      mask.fill(1, lineStart, lineEnd);
    }

    if (fence === null && marker !== undefined) {
      fence = {
        marker: marker[0],
        length: marker.length,
        quoteDepth: state.quoteDepth,
        listDepth: state.listStack.length,
      };
    } else if (closesFence) {
      fence = null;
    }
    lineStart = lineEnd + 1;
  }

  markInlineCode(markdown, mask);
  return mask;
}

function containerContentOffset(line: string, state: ContainerState): number {
  const blockquote = blockquoteContentOffset(line);
  if (blockquote.depth !== state.quoteDepth) {
    state.quoteDepth = blockquote.depth;
    state.listStack.length = 0;
  }
  return blockquote.offset + listContentOffset(
    line.slice(blockquote.offset),
    state.listStack,
  );
}

function blockquoteContentOffset(line: string): { depth: number; offset: number } {
  let depth = 0;
  let offset = 0;
  while (offset < line.length) {
    let marker = offset;
    let spaces = 0;
    while (spaces < 3 && line[marker] === " ") {
      marker += 1;
      spaces += 1;
    }
    if (line[marker] !== ">") break;
    offset = marker + 1;
    if (line[offset] === " " || line[offset] === "\t") offset += 1;
    depth += 1;
  }
  return { depth, offset };
}

function listContentOffset(line: string, stack: ListContainer[]): number {
  const indentation = leadingIndent(line);
  if (indentation.index === line.length) return line.length;

  while (
    stack.length > 0 &&
    indentation.columns < stack[stack.length - 1].contentIndent
  ) {
    stack.pop();
  }

  const baseIndent = stack.at(-1)?.contentIndent ?? 0;
  const markerText = line.slice(indentation.index);
  const marker = /^(?:[*+-]|\d{1,9}[.)])(?=[ \t]|$)/.exec(markerText)?.[0];
  if (marker !== undefined && indentation.columns - baseIndent <= 3) {
    const spacingStart = indentation.index + marker.length;
    const spacing = /^[ \t]+/.exec(line.slice(spacingStart))?.[0] ?? "";
    const spacingIndent = leadingIndent(spacing);
    const usedSpacingColumns = spacingIndent.columns >= 1 && spacingIndent.columns <= 4
      ? spacingIndent.columns
      : 1;
    const usedSpacingCharacters = spacingIndent.columns >= 1 && spacingIndent.columns <= 4
      ? spacing.length
      : Math.min(spacing.length, 1);
    const contentIndent = indentation.columns + marker.length + usedSpacingColumns;
    stack.push({ contentIndent });
    return spacingStart + usedSpacingCharacters;
  }

  return characterOffsetForIndent(line, baseIndent);
}

function leadingIndent(value: string): { columns: number; index: number } {
  let columns = 0;
  let index = 0;
  while (index < value.length) {
    if (value[index] === " ") {
      columns += 1;
    } else if (value[index] === "\t") {
      columns += 4 - (columns % 4);
    } else {
      break;
    }
    index += 1;
  }
  return { columns, index };
}

function characterOffsetForIndent(value: string, targetColumns: number): number {
  let columns = 0;
  let index = 0;
  while (index < value.length && columns < targetColumns) {
    if (value[index] === " ") {
      columns += 1;
    } else if (value[index] === "\t") {
      columns += 4 - (columns % 4);
    } else {
      break;
    }
    index += 1;
  }
  return index;
}

function markInlineCode(markdown: string, mask: Uint8Array): void {
  let index = 0;
  while (index < markdown.length) {
    if (mask[index] || markdown[index] !== "`" || isEscaped(markdown, index)) {
      index += 1;
      continue;
    }

    let runEnd = index;
    while (runEnd < markdown.length && markdown[runEnd] === "`") runEnd += 1;
    const runLength = runEnd - index;
    let close = runEnd;
    while (close < markdown.length) {
      if (mask[close] || markdown[close] !== "`") {
        close += 1;
        continue;
      }
      let closeEnd = close;
      while (closeEnd < markdown.length && markdown[closeEnd] === "`") closeEnd += 1;
      if (closeEnd - close === runLength) break;
      close = closeEnd;
    }
    if (close >= markdown.length) {
      index = runEnd;
      continue;
    }
    mask.fill(1, index, close + runLength);
    index = close + runLength;
  }
}
