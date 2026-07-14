export interface Wikilink {
  titleRaw: string;
  titleKey: string;
  alias: string | null;
}

export interface PreprocessWikilinksOptions {
  targetKind?: string | ((wikilink: Wikilink) => string | null | undefined);
  /** Reports the rewritten output span for occurrence-aware renderers. */
  onWikilink?: (
    wikilink: Wikilink,
    occurrence: { index: number; start: number; end: number },
  ) => void;
}

interface WikilinkMatch extends Wikilink {
  start: number;
  end: number;
}

type FenceContainer =
  | { kind: "blockquote" }
  | { kind: "list"; contentIndent: number };

type MarkdownContainer =
  | { kind: "blockquote" }
  | { kind: "list"; contentIndent: number; id: number };

interface ContainerState {
  containers: MarkdownContainer[];
  nextListId: number;
}

interface FenceState {
  character: "`" | "~";
  length: number;
  containers: FenceContainer[];
}

interface ParsedListOpening {
  characters: number;
  contentIndent: number;
  orderedStart: number | null;
}

interface BacktickRun {
  start: number;
  end: number;
  escaped: boolean;
}

/**
 * Normalizes a note title into the deterministic key used by link indexes.
 * This is Unicode lowercasing, not full Unicode case folding.
 */
export function normalizeTitleKey(title: string): string {
  return title.trim().replace(/\s+/gu, " ").toLowerCase();
}

/**
 * Returns one byte per UTF-16 code unit. A value of 1 marks fenced or inline code.
 */
export function maskCodeRegions(markdown: string): Uint8Array {
  const mask = maskFencedCodeRegions(markdown);
  markInlineCode(markdown, mask);
  return mask;
}

/** Returns one byte per UTF-16 code unit, marking fenced code only. */
export function maskFencedCodeRegions(markdown: string): Uint8Array {
  const mask = new Uint8Array(markdown.length);
  markFencedCode(markdown, mask);
  return mask;
}

export function extractWikilinks(markdown: string): Wikilink[] {
  return findWikilinks(markdown).map(({ titleRaw, titleKey, alias }) => ({
    titleRaw,
    titleKey,
    alias,
  }));
}

export function preprocessWikilinks(
  markdown: string,
  options: PreprocessWikilinksOptions = {},
): string {
  const matches = findWikilinks(markdown);
  if (matches.length === 0) return markdown;

  let output = "";
  let cursor = 0;
  for (const [index, match] of matches.entries()) {
    const label = match.alias === null || match.alias === "" ? match.titleRaw : match.alias;
    const targetKind = typeof options.targetKind === "function"
      ? options.targetKind(match)
      : options.targetKind;
    const href = targetKind
      ? `babel-note://${encodeWikilinkSegment(targetKind)}/${encodeWikilinkSegment(match.titleKey)}`
      : `babel-note://${encodeWikilinkSegment(match.titleKey)}`;

    output += markdown.slice(cursor, match.start);
    const start = output.length;
    output += `[${escapeMarkdownLabel(label)}](${href})`;
    options.onWikilink?.(
      { titleRaw: match.titleRaw, titleKey: match.titleKey, alias: match.alias },
      { index, start, end: output.length },
    );
    cursor = match.end;
  }
  return output + markdown.slice(cursor);
}

function markFencedCode(markdown: string, mask: Uint8Array): void {
  let fence: FenceState | null = null;
  const state: ContainerState = { containers: [], nextListId: 1 };
  let paragraphOpen = false;
  let lineStart = 0;

  while (lineStart < markdown.length) {
    const newline = markdown.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? markdown.length : newline;
    const lineWithPossibleCr = markdown.slice(lineStart, lineEnd);
    const line = lineWithPossibleCr.endsWith("\r")
      ? lineWithPossibleCr.slice(0, -1)
      : lineWithPossibleCr;

    if (fence !== null) {
      const contentOffset = matchFenceContainers(line, fence.containers);
      if (contentOffset !== null) {
        const closingMarker = fenceClosingMarker(
          line.slice(contentOffset),
          fence.character,
        );
        const closesFence = closingMarker !== undefined && closingMarker.length >= fence.length;
        mask.fill(1, lineStart, newline === -1 ? lineEnd : lineEnd + 1);
        if (closesFence) fence = null;
        if (newline === -1) break;
        lineStart = newline + 1;
        continue;
      }
      fence = null;
    }

    const contentOffset = containerContentOffset(line, state, { paragraphOpen });
    const contentLine = line.slice(contentOffset);
    const explicitOpening = parseExplicitFenceOpening(line, paragraphOpen);
    const stateMarker = fenceOpeningMarker(contentLine);
    const marker = explicitOpening?.marker ?? stateMarker;
    if (marker !== undefined) {
      const stateContainers: FenceContainer[] = state.containers.map(
        (container): FenceContainer => container.kind === "blockquote"
          ? { kind: "blockquote" }
          : { kind: "list", contentIndent: container.contentIndent },
      );
      const useImplicitContainers = stateMarker !== undefined && stateContainers.length > 0;
      mask.fill(1, lineStart, newline === -1 ? lineEnd : lineEnd + 1);
      fence = {
        character: marker[0] as "`" | "~",
        length: marker.length,
        containers: useImplicitContainers
          ? stateContainers
          : (explicitOpening?.containers ?? stateContainers),
      };
      paragraphOpen = false;
    } else if (/^[ \t]*$/u.test(contentLine) || isStandaloneInlineBlock(contentLine, paragraphOpen)) {
      paragraphOpen = false;
    } else {
      paragraphOpen = true;
    }

    if (newline === -1) break;
    lineStart = newline + 1;
  }
}

function parseExplicitFenceOpening(
  line: string,
  paragraphOpen: boolean,
): { marker: string; containers: FenceContainer[] } | null {
  const containers: FenceContainer[] = [];
  let offset = 0;
  let canStartNonOneOrderedList = !paragraphOpen;

  while (offset < line.length) {
    const remaining = line.slice(offset);
    const blockquote = /^ {0,3}>[ \t]?/u.exec(remaining)?.[0];
    if (blockquote !== undefined) {
      containers.push({ kind: "blockquote" });
      offset += blockquote.length;
      continue;
    }

    const list = parseListOpening(remaining);
    if (
      list !== null &&
      (list.orderedStart === null || list.orderedStart === 1 || canStartNonOneOrderedList)
    ) {
      containers.push({ kind: "list", contentIndent: list.contentIndent });
      offset += list.characters;
      canStartNonOneOrderedList = true;
      continue;
    }
    break;
  }

  const marker = fenceOpeningMarker(line.slice(offset));
  return marker === undefined ? null : { marker, containers };
}

function fenceOpeningMarker(value: string): string | undefined {
  return /^ {0,3}(`{3,})(?:[^`]*)$/u.exec(value)?.[1] ??
    /^ {0,3}(~{3,}).*$/u.exec(value)?.[1];
}

function fenceClosingMarker(value: string, character: "`" | "~"): string | undefined {
  const match = /^ {0,3}(`{3,}|~{3,})[ \t]*$/u.exec(value)?.[1];
  return match?.[0] === character ? match : undefined;
}

function matchFenceContainers(line: string, containers: readonly FenceContainer[]): number | null {
  let offset = 0;
  for (const container of containers) {
    const remaining = line.slice(offset);
    if (container.kind === "blockquote") {
      const marker = /^ {0,3}>[ \t]?/u.exec(remaining)?.[0];
      if (marker === undefined) return null;
      offset += marker.length;
      continue;
    }

    const indentation = leadingIndent(remaining);
    if (/^[ \t]*$/u.test(remaining)) return line.length;
    if (indentation.columns < container.contentIndent) return null;
    offset += characterOffsetForIndent(remaining, container.contentIndent);
  }
  return offset;
}

function containerContentOffset(
  line: string,
  state: ContainerState,
  options: { allowLazyContinuation?: boolean; paragraphOpen?: boolean } = {},
): number {
  let offset = 0;
  let matchedContainers = 0;

  for (const container of state.containers) {
    const remaining = line.slice(offset);
    if (container.kind === "blockquote") {
      const marker = /^ {0,3}>[ \t]?/u.exec(remaining)?.[0];
      if (marker === undefined) {
        if (!options.allowLazyContinuation || !canLazyContinueBlockquote(remaining)) break;
      } else {
        offset += marker.length;
      }
      matchedContainers += 1;
      continue;
    }

    if (/^[ \t]*$/u.test(remaining)) {
      offset = line.length;
      matchedContainers += 1;
      continue;
    }
    const indentation = leadingIndent(remaining);
    if (indentation.columns < container.contentIndent) {
      if (!options.allowLazyContinuation || !canLazyContinueList(remaining)) break;
      matchedContainers += 1;
      continue;
    }
    offset += characterOffsetForIndent(remaining, container.contentIndent);
    matchedContainers += 1;
  }

  const containers = state.containers.slice(0, matchedContainers);
  let canStartNonOneOrderedList = !options.paragraphOpen ||
    matchedContainers < state.containers.length;
  while (offset < line.length) {
    const remaining = line.slice(offset);
    const blockquote = /^ {0,3}>[ \t]?/u.exec(remaining)?.[0];
    if (blockquote !== undefined) {
      containers.push({ kind: "blockquote" });
      offset += blockquote.length;
      canStartNonOneOrderedList = true;
      continue;
    }

    const list = parseListOpening(remaining);
    if (
      list === null ||
      (list.orderedStart !== null &&
        list.orderedStart !== 1 &&
        !canStartNonOneOrderedList)
    ) {
      break;
    }
    containers.push({
      kind: "list",
      contentIndent: list.contentIndent,
      id: state.nextListId,
    });
    state.nextListId += 1;
    offset += list.characters;
    canStartNonOneOrderedList = true;
  }

  state.containers = containers;
  return offset;
}

function parseListOpening(value: string): ParsedListOpening | null {
  const indentation = leadingIndent(value);
  if (indentation.columns > 3) return null;
  const markerText = value.slice(indentation.index);
  const marker = /^(?:[*+-]|\d{1,9}[.)])(?=[ \t]|$)/u.exec(markerText)?.[0];
  if (marker === undefined) return null;
  const spacingStart = indentation.index + marker.length;
  const spacing = /^[ \t]+/u.exec(value.slice(spacingStart))?.[0] ?? "";
  const spacingIndent = leadingIndent(spacing);
  const usedSpacingColumns = spacingIndent.columns >= 1 && spacingIndent.columns <= 4
    ? spacingIndent.columns
    : 1;
  const usedSpacingCharacters = spacingIndent.columns >= 1 && spacingIndent.columns <= 4
    ? spacing.length
    : Math.min(spacing.length, 1);
  const ordered = /^(\d{1,9})[.)]$/u.exec(marker);
  return {
    characters: spacingStart + usedSpacingCharacters,
    contentIndent: indentation.columns + marker.length + usedSpacingColumns,
    orderedStart: ordered === null ? null : Number(ordered[1]),
  };
}

function canLazyContinueBlockquote(line: string): boolean {
  return !/^[ \t]*$/u.test(line) &&
    !/^ {0,3}(?:#{1,6}(?:[ \t]+|$)|>|`{3,}|~{3,}|(?:[*+-]|1[.)])(?=[ \t]))/u.test(line) &&
    !/^ {0,3}(?:(?:\*[ \t]*){3,}|(?:_[ \t]*){3,}|(?:-[ \t]*){3,})$/u.test(line);
}

function canLazyContinueList(line: string): boolean {
  return !/^[ \t]*$/u.test(line) &&
    !/^ {0,3}(?:#{1,6}(?:[ \t]+|$)|>|`{3,}|~{3,}|(?:[*+-]|\d{1,9}[.)])(?=[ \t]))/u.test(line) &&
    !/^ {0,3}(?:(?:\*[ \t]*){3,}|(?:_[ \t]*){3,}|(?:-[ \t]*){3,})$/u.test(line);
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
  const state: ContainerState = { containers: [], nextListId: 1 };
  let segmentStart = 0;
  let lineStart = 0;
  let segmentContainerKey: string | null = null;
  let paragraphOpen = false;
  let previousLineStart = -1;
  let previousContentLine = "";
  let previousContentOffset = 0;
  let previousContainerKey = "";
  let inGfmTable = false;

  while (lineStart < markdown.length) {
    const newline = markdown.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? markdown.length : newline;
    const line = markdown.slice(lineStart, lineEnd).replace(/\r$/u, "");
    const contentOffset = containerContentOffset(line, state, {
      allowLazyContinuation: paragraphOpen,
      paragraphOpen,
    });
    const contentLine = line.slice(contentOffset);
    const containerKey = state.containers.map((container) => (
      container.kind === "blockquote" ? "q" : `l${container.id}`
    )).join("/");
    const containerChanged = segmentContainerKey !== null && containerKey !== segmentContainerKey;
    if (containerChanged) {
      markInlineCodeSegment(markdown, mask, segmentStart, lineStart);
      segmentStart = lineStart;
      paragraphOpen = false;
      inGfmTable = false;
    }
    segmentContainerKey = containerKey;

    const nextLineStart = newline === -1 ? markdown.length : newline + 1;
    const delimiterColumns = gfmTableDelimiterColumns(contentLine);
    const startsTable = delimiterColumns !== null &&
      previousLineStart >= segmentStart &&
      previousContainerKey === containerKey &&
      gfmTableColumns(previousContentLine) === delimiterColumns;
    if (startsTable) {
      markInlineCodeSegment(markdown, mask, segmentStart, previousLineStart);
      markInlineCodeTableRow(
        markdown,
        mask,
        previousLineStart + previousContentOffset,
        previousContentLine,
      );
      segmentStart = nextLineStart;
      paragraphOpen = false;
      inGfmTable = true;
      previousLineStart = lineStart;
      previousContentLine = contentLine;
      previousContentOffset = contentOffset;
      previousContainerKey = containerKey;
      if (newline === -1) break;
      lineStart = nextLineStart;
      continue;
    }
    if (inGfmTable) {
      if (
        !/^[ \t]*$/u.test(contentLine) &&
        gfmTableColumns(contentLine) !== null &&
        mask[lineStart] !== 1
      ) {
        markInlineCodeTableRow(markdown, mask, lineStart + contentOffset, contentLine);
        segmentStart = nextLineStart;
        previousLineStart = lineStart;
        previousContentLine = contentLine;
        previousContentOffset = contentOffset;
        previousContainerKey = containerKey;
        if (newline === -1) break;
        lineStart = nextLineStart;
        continue;
      }
      inGfmTable = false;
    }

    const isExcludedBoundary = /^[ \t]*$/u.test(contentLine) || mask[lineStart] === 1;
    if (isExcludedBoundary) {
      markInlineCodeSegment(markdown, mask, segmentStart, lineStart);
      segmentStart = nextLineStart;
      segmentContainerKey = null;
      paragraphOpen = false;
      if (mask[lineStart] === 1) {
        state.containers = [];
      }
    } else if (isStandaloneInlineBlock(contentLine, paragraphOpen)) {
      markInlineCodeSegment(markdown, mask, segmentStart, lineStart);
      markInlineCodeSegment(markdown, mask, lineStart, lineEnd);
      segmentStart = nextLineStart;
      segmentContainerKey = null;
      paragraphOpen = false;
    } else {
      paragraphOpen = true;
    }
    previousLineStart = lineStart;
    previousContentLine = contentLine;
    previousContentOffset = contentOffset;
    previousContainerKey = containerKey;
    if (newline === -1) break;
    lineStart = nextLineStart;
  }
  markInlineCodeSegment(markdown, mask, segmentStart, markdown.length);
}

function gfmTableDelimiterColumns(line: string): number | null {
  const cells = splitGfmTableCells(line);
  return cells !== null && cells.every((cell) => /^[ \t]*:?-+:?[ \t]*$/u.test(cell))
    ? cells.length
    : null;
}

function gfmTableColumns(line: string): number | null {
  return splitGfmTableCells(line)?.length ?? null;
}

function splitGfmTableCells(line: string): string[] | null {
  const ranges = gfmTableCellRanges(line);
  return ranges?.map(({ start, end }) => line.slice(start, end)) ?? null;
}

function gfmTableCellRanges(line: string): Array<{ start: number; end: number }> | null {
  const separators: number[] = [];
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === "|" && !isEscaped(line, index)) {
      separators.push(index);
    }
  }
  if (separators.length === 0) return null;

  const cells: Array<{ start: number; end: number }> = [];
  let start = 0;
  for (const separator of separators) {
    cells.push({ start, end: separator });
    start = separator + 1;
  }
  cells.push({ start, end: line.length });
  if (line.slice(cells[0].start, cells[0].end).trim() === "") cells.shift();
  const last = cells.at(-1);
  if (last !== undefined && line.slice(last.start, last.end).trim() === "") cells.pop();
  return cells.length === 0 ? null : cells;
}

function markInlineCodeTableRow(
  markdown: string,
  mask: Uint8Array,
  contentStart: number,
  contentLine: string,
): void {
  for (const cell of gfmTableCellRanges(contentLine) ?? []) {
    markInlineCodeSegment(
      markdown,
      mask,
      contentStart + cell.start,
      contentStart + cell.end,
    );
  }
}

function isStandaloneInlineBlock(line: string, paragraphOpen: boolean): boolean {
  return /^(?: {0,3})#{1,6}(?:[ \t]+|$)/u.test(line) ||
    /^(?: {0,3})(?:=+|-+)[ \t]*$/u.test(line) ||
    /^(?: {0,3})(?:(?:\*[ \t]*){3,}|(?:_[ \t]*){3,}|(?:-[ \t]*){3,})$/u.test(line) ||
    (!paragraphOpen && (
      /^(?: {4}|\t)/u.test(line) ||
      /^(?: {0,3})\[[^\]]+\]:/u.test(line) ||
      /^(?: {0,3})</u.test(line)
    ));
}

function markInlineCodeSegment(
  markdown: string,
  mask: Uint8Array,
  start: number,
  end: number,
): void {
  const runs: BacktickRun[] = [];
  let cursor = start;
  while (cursor < end) {
    if (mask[cursor] || markdown[cursor] !== "`") {
      cursor += 1;
      continue;
    }
    const runEnd = Math.min(endOfRun(markdown, cursor, "`"), end);
    runs.push({ start: cursor, end: runEnd, escaped: isEscaped(markdown, cursor) });
    cursor = runEnd;
  }

  const nextSameLength = new Int32Array(runs.length);
  nextSameLength.fill(-1);
  const nextByLength = new Map<number, number>();
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const length = runs[index].end - runs[index].start;
    nextSameLength[index] = nextByLength.get(length) ?? -1;
    nextByLength.set(length, index);
  }

  let runIndex = 0;
  while (runIndex < runs.length) {
    const opening = runs[runIndex];
    const closingIndex = nextSameLength[runIndex];
    if (opening.escaped || closingIndex === -1) {
      runIndex += 1;
      continue;
    }
    mask.fill(1, opening.start, runs[closingIndex].end);
    runIndex = closingIndex + 1;
  }
}

function findWikilinks(markdown: string): WikilinkMatch[] {
  const codeMask = maskCodeRegions(markdown);
  const matchingClose = new Int32Array(markdown.length);
  matchingClose.fill(-1);
  const bracketStack: number[] = [];
  const candidateStarts: number[] = [];
  const matches: WikilinkMatch[] = [];

  // Match individual brackets once. A wikilink is valid when both opening
  // brackets match an adjacent closing pair. Resetting at code and newlines
  // gives them the same hard-boundary behavior as the Markdown syntax.
  for (let index = 0; index < markdown.length; index += 1) {
    const character = markdown[index];
    if (codeMask[index] || character === "\r" || character === "\n") {
      bracketStack.length = 0;
      continue;
    }

    if (character === "[") {
      bracketStack.push(index);
      if (
        markdown[index + 1] === "[" &&
        !codeMask[index + 1] &&
        !isEscaped(markdown, index) &&
        !isObsidianEmbed(markdown, index)
      ) {
        candidateStarts.push(index);
      }
      continue;
    }

    if (character === "]" && bracketStack.length > 0) {
      const opening = bracketStack.pop();
      if (opening !== undefined) matchingClose[opening] = index;
    }
  }

  let consumedUntil = -1;
  for (const start of candidateStarts) {
    if (start < consumedUntil) continue;

    const firstClose = matchingClose[start + 1];
    const secondClose = matchingClose[start];
    if (firstClose === -1 || secondClose !== firstClose + 1) continue;

    const end = secondClose + 1;
    const body = markdown.slice(start + 2, end - 2);
    const separator = body.indexOf("|");
    const titleRaw = separator === -1 ? body : body.slice(0, separator);
    const titleKey = normalizeTitleKey(titleRaw);
    if (titleKey !== "") {
      matches.push({
        titleRaw,
        titleKey,
        alias: separator === -1 ? null : body.slice(separator + 1),
        start,
        end,
      });
    }
    // Even an empty outer link owns its nested bracket content.
    consumedUntil = end;
  }

  return matches;
}

function isObsidianEmbed(markdown: string, openingIndex: number): boolean {
  const bangIndex = openingIndex - 1;
  return bangIndex >= 0 && markdown[bangIndex] === "!" && !isEscaped(markdown, bangIndex);
}

function isEscaped(value: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function endOfRun(value: string, start: number, character: string): number {
  let end = start;
  while (end < value.length && value[end] === character) end += 1;
  return end;
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/[\\\[\]]/gu, "\\$&");
}

function encodeWikilinkSegment(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/gu, (character) => {
    return `%${character.charCodeAt(0).toString(16).toUpperCase()}`;
  });
}
