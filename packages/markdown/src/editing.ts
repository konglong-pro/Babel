import { maskFencedCodeRegions } from "./core";

export interface TextEditResult {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

export type InlineMarker = "**" | "*" | "`" | "~~";

interface SourceLine {
  text: string;
  start: number;
  end: number;
  newlineEnd: number;
}

interface ContinuationMarker {
  kind: "blockquote" | "list";
  start: number;
  markerStart: number;
  end: number;
  continuation: string;
  taskIndex: number | null;
}

interface Replacement {
  at: number;
  deleteCount: number;
  insert: string;
}

interface FenceMarker {
  prefix: string;
  sourcePrefix: string;
  marker: string;
  info: string;
  character: "`" | "~";
}

const INLINE_MARKERS = new Set<InlineMarker>(["**", "*", "`", "~~"]);
const LIST_INDENT = "  ";

export function continueListOnEnter(
  text: string,
  selectionStart: number,
  selectionEnd: number,
): TextEditResult | null {
  if (!validSelection(text, selectionStart, selectionEnd)) return null;
  const line = sourceLineAt(text, selectionStart);
  if (selectionEnd > line.end) return null;
  const codeMask = maskFencedCodeRegions(text);
  if (isFencedLine(text, codeMask, line)) return null;

  const markers = parseContinuationMarkers(line.text);
  const marker = markers.at(-1);
  if (marker === undefined) return null;

  const content = line.text.slice(marker.end);
  if (!content.trim() && selectionEnd === line.end) {
    const removeStart = line.start + marker.start;
    const removeEnd = line.start + marker.end;
    const nextText = text.slice(0, removeStart) + text.slice(removeEnd);
    return {
      text: nextText,
      selectionStart: removeStart,
      selectionEnd: removeStart,
    };
  }

  const eol = preferredEol(text);
  const insertion = eol + line.text.slice(0, marker.start) + marker.continuation;
  const nextText = text.slice(0, selectionStart) + insertion + text.slice(selectionEnd);
  const nextSelection = selectionStart + insertion.length;
  return {
    text: nextText,
    selectionStart: nextSelection,
    selectionEnd: nextSelection,
  };
}

export function continueFenceOnEnter(
  text: string,
  selectionStart: number,
  selectionEnd: number,
): TextEditResult | null {
  if (!validSelection(text, selectionStart, selectionEnd)) return null;
  const lines = sourceLines(text);
  const line = sourceLineAt(text, selectionStart);
  if (selectionEnd > line.end) return null;
  const lineIndex = lines.findIndex((candidate) => candidate.start === line.start);
  if (lineIndex === -1) return null;

  const codeMask = maskFencedCodeRegions(text);
  const marker = fenceMarker(line.text);
  const previousLineIsFenced = marker !== null && hasOpenFenceBefore(text, line, marker);
  const eol = preferredEol(text);

  if (marker !== null && !previousLineIsFenced && selectionEnd === line.end) {
    const nextLine = lines[lineIndex + 1];
    const nextMarker = nextLine === undefined ? null : fenceMarker(nextLine.text);
    const alreadyClosed = nextMarker !== null &&
      nextMarker.info.trim() === "" &&
      nextMarker.character === marker.character &&
      nextMarker.marker.length >= marker.marker.length &&
      nextMarker.prefix === marker.prefix;
    const insertion = alreadyClosed
      ? eol + marker.prefix
      : eol + marker.prefix + eol + marker.prefix + marker.marker;
    const nextText = text.slice(0, selectionStart) + insertion + text.slice(selectionEnd);
    const nextSelection = selectionStart + eol.length + marker.prefix.length;
    return {
      text: nextText,
      selectionStart: nextSelection,
      selectionEnd: nextSelection,
    };
  }

  const blankPrefix = blankFencePrefix(line.text);
  if (blankPrefix === null || !isFencedLine(text, codeMask, line)) return null;
  const previous = lines[lineIndex - 1];
  const next = lines[lineIndex + 1];
  if (previous === undefined || next === undefined) return null;
  const opening = fenceMarker(previous.text);
  const closing = fenceMarker(next.text);
  if (
    opening === null ||
    closing === null ||
    closing.info.trim() !== "" ||
    closing.character !== opening.character ||
    closing.marker.length < opening.marker.length ||
    opening.prefix !== blankPrefix ||
    closing.prefix !== blankPrefix
  ) {
    return null;
  }

  if (next.newlineEnd > next.end) {
    return {
      text,
      selectionStart: next.newlineEnd,
      selectionEnd: next.newlineEnd,
    };
  }
  const nextText = text + eol;
  return {
    text: nextText,
    selectionStart: nextText.length,
    selectionEnd: nextText.length,
  };
}

export function indentListItem(
  text: string,
  selectionStart: number,
  selectionEnd: number,
): TextEditResult | null {
  if (!validSelection(text, selectionStart, selectionEnd)) return null;
  const lines = selectedLines(text, selectionStart, selectionEnd);
  const codeMask = maskFencedCodeRegions(text);
  const replacements: Replacement[] = [];
  let foundList = false;

  for (const line of lines) {
    if (isFencedLine(text, codeMask, line)) return null;
    if (!line.text.trim()) {
      replacements.push({ at: line.start, deleteCount: 0, insert: LIST_INDENT });
      continue;
    }
    const marker = parseContinuationMarkers(line.text).find(({ kind }) => kind === "list");
    if (marker === undefined) return null;
    foundList = true;
    replacements.push({
      at: line.start + marker.start,
      deleteCount: 0,
      insert: LIST_INDENT,
    });
  }

  return foundList
    ? applyReplacements(text, selectionStart, selectionEnd, replacements)
    : null;
}

export function outdentListItem(
  text: string,
  selectionStart: number,
  selectionEnd: number,
): TextEditResult | null {
  if (!validSelection(text, selectionStart, selectionEnd)) return null;
  const lines = selectedLines(text, selectionStart, selectionEnd);
  const codeMask = maskFencedCodeRegions(text);
  const replacements: Replacement[] = [];

  for (const line of lines) {
    if (isFencedLine(text, codeMask, line)) return null;
    if (!line.text.trim()) continue;
    const marker = parseContinuationMarkers(line.text).find(({ kind }) => kind === "list");
    if (marker === undefined) return null;
    const indentation = line.text.slice(marker.start, marker.markerStart);
    const deleteCount = indentation.startsWith("\t")
      ? 1
      : Math.min(LIST_INDENT.length, /^ */u.exec(indentation)?.[0].length ?? 0);
    if (deleteCount > 0) {
      replacements.push({
        at: line.start + marker.start,
        deleteCount,
        insert: "",
      });
    }
  }

  return replacements.length === 0
    ? null
    : applyReplacements(text, selectionStart, selectionEnd, replacements);
}

export function toggleTaskListSelection(
  text: string,
  selectionStart: number,
  selectionEnd: number,
): TextEditResult | null {
  if (!validSelection(text, selectionStart, selectionEnd)) return null;
  const lines = selectedLines(text, selectionStart, selectionEnd);
  const codeMask = maskFencedCodeRegions(text);
  const parsed = lines.map((line) => ({
    line,
    markers: parseContinuationMarkers(line.text),
  }));
  if (parsed.some(({ line }) => isFencedLine(text, codeMask, line))) return null;

  const nonblank = parsed.filter(({ line }) => line.text.trim());
  if (nonblank.length === 0) return null;
  const removeTasks = nonblank.every(({ markers }) =>
    markers.some(({ kind, taskIndex }) => kind === "list" && taskIndex !== null));
  const replacements: Replacement[] = [];

  for (const { line, markers } of parsed) {
    if (!line.text.trim()) {
      if (!removeTasks) {
        replacements.push({ at: line.start, deleteCount: 0, insert: "- [ ] " });
      }
      continue;
    }

    const task = markers.findLast(({ kind, taskIndex }) => kind === "list" && taskIndex !== null);
    if (removeTasks && task !== undefined) {
      replacements.push({
        at: line.start + task.start,
        deleteCount: task.end - task.start,
        insert: "",
      });
      continue;
    }
    if (task !== undefined) continue;

    const list = markers.findLast(({ kind }) => kind === "list");
    if (list !== undefined) {
      replacements.push({ at: line.start + list.end, deleteCount: 0, insert: "[ ] " });
      continue;
    }
    const blockquote = markers.at(-1);
    const insertion = blockquote?.kind === "blockquote"
      ? blockquote.end
      : (/^[ \t]*/u.exec(line.text)?.[0].length ?? 0);
    replacements.push({
      at: line.start + insertion,
      deleteCount: 0,
      insert: "- [ ] ",
    });
  }

  return replacements.length === 0
    ? null
    : applyReplacements(text, selectionStart, selectionEnd, replacements);
}

export function wrapInlineSelection(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  marker: InlineMarker,
): TextEditResult | null {
  if (
    !validSelection(text, selectionStart, selectionEnd) ||
    !INLINE_MARKERS.has(marker) ||
    selectionTouchesFence(text, selectionStart, selectionEnd)
  ) {
    return null;
  }

  const markerLength = marker.length;
  const selected = text.slice(selectionStart, selectionEnd);
  if (selectionIncludesMarker(selected, marker)) {
    const inner = selected.slice(markerLength, -markerLength);
    const nextText = text.slice(0, selectionStart) + inner + text.slice(selectionEnd);
    return {
      text: nextText,
      selectionStart,
      selectionEnd: selectionStart + inner.length,
    };
  }

  if (markerSurroundsSelection(text, selectionStart, selectionEnd, marker)) {
    const nextText = text.slice(0, selectionStart - markerLength) +
      selected +
      text.slice(selectionEnd + markerLength);
    return {
      text: nextText,
      selectionStart: selectionStart - markerLength,
      selectionEnd: selectionEnd - markerLength,
    };
  }

  const replacement = marker + selected + marker;
  const nextText = text.slice(0, selectionStart) + replacement + text.slice(selectionEnd);
  return {
    text: nextText,
    selectionStart: selectionStart + markerLength,
    selectionEnd: selectionEnd + markerLength,
  };
}

export function linkFromPastedUrl(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  pastedText: string,
): TextEditResult | null {
  if (
    !validSelection(text, selectionStart, selectionEnd) ||
    selectionStart === selectionEnd ||
    !isHttpUrl(pastedText) ||
    selectionTouchesFence(text, selectionStart, selectionEnd)
  ) {
    return null;
  }

  const label = text.slice(selectionStart, selectionEnd);
  const replacement = `[${label}](${pastedText})`;
  const nextText = text.slice(0, selectionStart) + replacement + text.slice(selectionEnd);
  const nextSelection = selectionStart + replacement.length;
  return {
    text: nextText,
    selectionStart: nextSelection,
    selectionEnd: nextSelection,
  };
}

export function toggleTaskCheckbox(text: string, line: number): TextEditResult | null {
  if (!Number.isInteger(line) || line < 1) return null;
  const lines = sourceLines(text);
  const sourceLine = lines[line - 1];
  if (sourceLine === undefined) return null;
  const codeMask = maskFencedCodeRegions(text);
  if (isFencedLine(text, codeMask, sourceLine)) return null;

  const marker = parseContinuationMarkers(sourceLine.text)
    .findLast(({ taskIndex }) => taskIndex !== null);
  if (marker?.taskIndex === null || marker === undefined) return null;
  const taskIndex = sourceLine.start + marker.taskIndex;
  const checked = text[taskIndex].toLowerCase() === "x";
  const nextText = text.slice(0, taskIndex) + (checked ? " " : "x") + text.slice(taskIndex + 1);
  return {
    text: nextText,
    selectionStart: taskIndex + 1,
    selectionEnd: taskIndex + 1,
  };
}

function parseContinuationMarkers(line: string): ContinuationMarker[] {
  const markers: ContinuationMarker[] = [];
  let cursor = 0;

  while (cursor < line.length) {
    const start = cursor;
    const indentation = /^[ \t]*/u.exec(line.slice(cursor))?.[0] ?? "";
    const markerStart = cursor + indentation.length;
    const remaining = line.slice(markerStart);

    const blockquote = /^(>)([ \t]?)/u.exec(remaining);
    if (blockquote !== null) {
      const markerText = indentation + blockquote[1] + blockquote[2];
      cursor = markerStart + blockquote[0].length;
      markers.push({
        kind: "blockquote",
        start,
        markerStart,
        end: cursor,
        continuation: markerText,
        taskIndex: null,
      });
      continue;
    }

    const list = /^(?:([-+*])|(\d{1,9})([.)]))([ \t]+)/u.exec(remaining);
    if (list === null) break;
    let markerText = list[1] ?? `${Number(list[2]) + 1}${list[3]}`;
    markerText += list[4];
    cursor = markerStart + list[0].length;
    let taskIndex: number | null = null;
    const task = /^\[([ xX])\]([ \t]+|$)/u.exec(line.slice(cursor));
    if (task !== null) {
      taskIndex = cursor + 1;
      markerText += `[ ]${task[2]}`;
      cursor += task[0].length;
    }
    markers.push({
      kind: "list",
      start,
      markerStart,
      end: cursor,
      continuation: indentation + markerText,
      taskIndex,
    });
  }

  return markers;
}

function sourceLines(text: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;
  while (start < text.length) {
    const newline = text.indexOf("\n", start);
    const newlineEnd = newline === -1 ? text.length : newline + 1;
    let end = newline === -1 ? text.length : newline;
    if (end > start && text[end - 1] === "\r") end -= 1;
    lines.push({ text: text.slice(start, end), start, end, newlineEnd });
    start = newlineEnd;
  }
  if (text.length === 0 || text.endsWith("\n")) {
    lines.push({ text: "", start: text.length, end: text.length, newlineEnd: text.length });
  }
  return lines;
}

function sourceLineAt(text: string, position: number): SourceLine {
  const bounded = Math.max(0, Math.min(position, text.length));
  const searchFrom = bounded === 0 ? -1 : bounded - 1;
  const start = text.lastIndexOf("\n", searchFrom) + 1;
  const newline = text.indexOf("\n", bounded);
  const newlineEnd = newline === -1 ? text.length : newline + 1;
  let end = newline === -1 ? text.length : newline;
  if (end > start && text[end - 1] === "\r") end -= 1;
  return { text: text.slice(start, end), start, end, newlineEnd };
}

function selectedLines(text: string, selectionStart: number, selectionEnd: number): SourceLine[] {
  const first = sourceLineAt(text, selectionStart);
  const effectiveEnd = selectionEnd > selectionStart ? selectionEnd - 1 : selectionEnd;
  const last = sourceLineAt(text, effectiveEnd);
  return sourceLines(text).filter(({ start }) => start >= first.start && start <= last.start);
}

function isFencedLine(text: string, mask: Uint8Array, line: SourceLine): boolean {
  const newline = line.newlineEnd - 1;
  if (newline >= line.end && text[newline] === "\n") return mask[newline] === 1;
  return line.end > line.start && mask[line.start] === 1 && mask[line.end - 1] === 1;
}

function selectionTouchesFence(text: string, selectionStart: number, selectionEnd: number): boolean {
  const mask = maskFencedCodeRegions(text);
  return selectedLines(text, selectionStart, selectionEnd)
    .some((line) => isFencedLine(text, mask, line));
}

function fenceMarker(line: string): FenceMarker | null {
  let offset = 0;
  let prefix = "";
  while (offset < line.length) {
    const remaining = line.slice(offset);
    const blockquote = /^ {0,3}>[ \t]?/u.exec(remaining)?.[0];
    if (blockquote !== undefined) {
      prefix += blockquote;
      offset += blockquote.length;
      continue;
    }
    const list = fenceListOpening(remaining);
    if (list === null) break;
    prefix += " ".repeat(list.contentIndent);
    offset += list.characters;
  }

  const match = /^( {0,3})(`{3,}|~{3,})(.*)$/u.exec(line.slice(offset));
  if (match === null || (match[2][0] === "`" && match[3].includes("`"))) return null;
  return {
    prefix: prefix + match[1],
    sourcePrefix: line.slice(0, offset) + match[1],
    marker: match[2],
    info: match[3],
    character: match[2][0] as "`" | "~",
  };
}

function hasOpenFenceBefore(
  text: string,
  line: SourceLine,
  marker: FenceMarker,
): boolean {
  // Probe the current container using the same CommonMark-aware fence masker.
  // A fence in a blockquote/list closes when that container ends, even without
  // an explicit closing marker, so counting marker pairs globally is incorrect.
  const probeStart = line.start;
  const probe = `${text.slice(0, probeStart)}${marker.sourcePrefix}fence-probe`;
  return maskFencedCodeRegions(probe)[probeStart] === 1;
}

function blankFencePrefix(line: string): string | null {
  let offset = 0;
  while (offset < line.length) {
    const blockquote = /^ {0,3}>[ \t]?/u.exec(line.slice(offset))?.[0];
    if (blockquote === undefined) break;
    offset += blockquote.length;
  }
  return /^[ \t]*$/u.test(line.slice(offset)) ? line : null;
}

function fenceListOpening(value: string): { characters: number; contentIndent: number } | null {
  const indentation = leadingIndent(value);
  if (indentation.columns > 3) return null;
  const markerText = value.slice(indentation.index);
  const marker = /^(?:[*+-]|\d{1,9}[.)])(?=[ \t]|$)/u.exec(markerText)?.[0];
  if (marker === undefined) return null;
  const spacingStart = indentation.index + marker.length;
  const spacing = /^[ \t]+/u.exec(value.slice(spacingStart))?.[0] ?? "";
  const spacingIndent = leadingIndent(spacing);
  const useFullSpacing = spacingIndent.columns >= 1 && spacingIndent.columns <= 4;
  return {
    characters: spacingStart + (useFullSpacing ? spacing.length : Math.min(spacing.length, 1)),
    contentIndent: indentation.columns + marker.length +
      (useFullSpacing ? spacingIndent.columns : 1),
  };
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

function selectionIncludesMarker(selected: string, marker: InlineMarker): boolean {
  if (selected.length < marker.length * 2) return false;
  if (marker !== "*") return selected.startsWith(marker) && selected.endsWith(marker);
  return edgeRunLength(selected, 0, 1, "*") % 2 === 1 &&
    edgeRunLength(selected, selected.length - 1, -1, "*") % 2 === 1;
}

function markerSurroundsSelection(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  marker: InlineMarker,
): boolean {
  if (marker !== "*") {
    return text.slice(selectionStart - marker.length, selectionStart) === marker &&
      text.slice(selectionEnd, selectionEnd + marker.length) === marker;
  }
  return edgeRunLength(text, selectionStart - 1, -1, "*") % 2 === 1 &&
    edgeRunLength(text, selectionEnd, 1, "*") % 2 === 1;
}

function edgeRunLength(
  value: string,
  start: number,
  direction: 1 | -1,
  character: string,
): number {
  let length = 0;
  for (
    let index = start;
    index >= 0 && index < value.length && value[index] === character;
    index += direction
  ) {
    length += 1;
  }
  return length;
}

function preferredEol(text: string): "\r\n" | "\n" {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function validSelection(text: string, selectionStart: number, selectionEnd: number): boolean {
  return Number.isInteger(selectionStart) &&
    Number.isInteger(selectionEnd) &&
    selectionStart >= 0 &&
    selectionEnd >= selectionStart &&
    selectionEnd <= text.length;
}

function isHttpUrl(value: string): boolean {
  if (!/^https?:\/\/\S+$/u.test(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function applyReplacements(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  replacements: readonly Replacement[],
): TextEditResult {
  const ordered = [...replacements].sort((left, right) => left.at - right.at);
  let nextText = text;
  for (const replacement of [...ordered].reverse()) {
    nextText = nextText.slice(0, replacement.at) +
      replacement.insert +
      nextText.slice(replacement.at + replacement.deleteCount);
  }

  return {
    text: nextText,
    selectionStart: mapPosition(selectionStart, ordered),
    selectionEnd: mapPosition(selectionEnd, ordered),
  };
}

function mapPosition(position: number, replacements: readonly Replacement[]): number {
  let delta = 0;
  for (const replacement of replacements) {
    if (position < replacement.at) break;
    const replacementEnd = replacement.at + replacement.deleteCount;
    if (position <= replacementEnd) {
      return replacement.at + delta + replacement.insert.length;
    }
    delta += replacement.insert.length - replacement.deleteCount;
  }
  return position + delta;
}
