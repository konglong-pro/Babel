import { maskFencedCodeRegions, preprocessWikilinks } from "./core";

export interface OutlineItem {
  level: number;
  text: string;
  /** One-based source line, matching Markdown AST positions. */
  line: number;
  /** Zero-based UTF-16 offset of the heading's source line. */
  offset: number;
}

interface SourceLine {
  text: string;
  start: number;
  end: number;
  newlineEnd: number;
  number: number;
}

type OutlineContainer =
  | { kind: "blockquote" }
  | { kind: "list"; contentIndent: number; id: number };

interface OutlineContainerState {
  containers: OutlineContainer[];
  nextListId: number;
}

interface ParsedOutlineLine extends SourceLine {
  content: string;
  containerKey: string;
  fenced: boolean;
  referenceDefinition: boolean;
}

export function extractOutline(markdown: string): OutlineItem[] {
  const codeMask = maskFencedCodeRegions(markdown);
  const lines = parseOutlineLines(markdown, codeMask);
  const outline: OutlineItem[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.fenced) continue;

    const atx = atxHeading(line.content);
    if (atx !== null) {
      const rawText = (atx[2] ?? "").replace(/[ \t]+#+[ \t]*$/u, "");
      outline.push({
        level: atx[1].length,
        text: stripInlineMarkdown(rawText),
        line: line.number,
        offset: line.start,
      });
      continue;
    }

    const underline = setextUnderline(line.content);
    if (underline === null) continue;

    const paragraph = setextParagraph(lines, index);
    const first = paragraph[0];
    if (first === undefined) continue;

    outline.push({
      level: underline[1][0] === "=" ? 1 : 2,
      text: stripInlineMarkdown(paragraph.map(({ content }) => content.trim()).join("\n")),
      line: first.number,
      offset: first.start,
    });
  }

  return outline;
}

export function outlineSlugs(outline: readonly OutlineItem[]): string[] {
  const counts = new Map<string, number>();
  return outline.map(({ text }) => {
    const base = slugBase(text);
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  });
}

function sourceLines(markdown: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;
  let number = 1;

  while (start < markdown.length) {
    const newline = markdown.indexOf("\n", start);
    const newlineEnd = newline === -1 ? markdown.length : newline + 1;
    let end = newline === -1 ? markdown.length : newline;
    if (end > start && markdown[end - 1] === "\r") end -= 1;
    lines.push({
      text: markdown.slice(start, end),
      start,
      end,
      newlineEnd,
      number,
    });
    start = newlineEnd;
    number += 1;
  }

  return lines;
}

function parseOutlineLines(
  markdown: string,
  codeMask: Uint8Array,
): ParsedOutlineLine[] {
  const source = sourceLines(markdown);
  const state: OutlineContainerState = { containers: [], nextListId: 1 };
  const parsed: ParsedOutlineLine[] = [];
  let paragraphOpen = false;
  let referenceDefinitionEnd = -1;

  for (let index = 0; index < source.length; index += 1) {
    const line = source[index];
    const contentOffset = containerContentOffset(line.text, state, {
      allowLazyContinuation: paragraphOpen,
      paragraphOpen,
    });
    const content = line.text.slice(contentOffset);
    const fenced = isFencedLine(markdown, codeMask, line);
    const containerKey = state.containers.map((container) => (
      container.kind === "blockquote" ? "q" : `l${container.id}`
    )).join("/");
    let referenceDefinition = !fenced && index <= referenceDefinitionEnd;

    if (!fenced && !paragraphOpen && !referenceDefinition) {
      const candidates = referenceDefinitionCandidates(
        source,
        index,
        state,
        containerKey,
        markdown,
        codeMask,
      );
      const lineCount = linkReferenceDefinitionLineCount(candidates);
      if (lineCount > 0) {
        referenceDefinition = true;
        referenceDefinitionEnd = index + lineCount - 1;
      }
    }

    if (fenced) {
      paragraphOpen = false;
      state.containers = [];
    } else if (referenceDefinition) {
      paragraphOpen = false;
    } else {
      paragraphOpen = !isParagraphBoundary(content);
    }
    parsed.push({
      ...line,
      content,
      containerKey,
      fenced,
      referenceDefinition,
    });
  }

  return parsed;
}

function isFencedLine(markdown: string, mask: Uint8Array, line: SourceLine): boolean {
  const newline = line.newlineEnd - 1;
  if (newline >= line.end && markdown[newline] === "\n") return mask[newline] === 1;
  return line.end > line.start && mask[line.start] === 1 && mask[line.end - 1] === 1;
}

function setextParagraph(
  lines: readonly ParsedOutlineLine[],
  underlineIndex: number,
): ParsedOutlineLine[] {
  const underline = lines[underlineIndex];
  const paragraph: ParsedOutlineLine[] = [];
  for (let index = underlineIndex - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (
      line.fenced ||
      line.referenceDefinition ||
      line.containerKey !== underline.containerKey ||
      !isSetextParagraphLine(line.content)
    ) {
      break;
    }
    paragraph.unshift(line);
  }
  return paragraph;
}

function referenceDefinitionCandidates(
  lines: readonly SourceLine[],
  startIndex: number,
  state: OutlineContainerState,
  containerKey: string,
  markdown: string,
  codeMask: Uint8Array,
): string[] {
  const first = lines[startIndex];
  const firstOffset = contentOffsetForContainers(first.text, state.containers);
  const candidates = [first.text.slice(firstOffset)];
  const lookaheadState: OutlineContainerState = {
    containers: state.containers.map((container) => ({ ...container })),
    nextListId: state.nextListId,
  };

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (isFencedLine(markdown, codeMask, line)) break;
    const offset = containerContentOffset(line.text, lookaheadState, {
      allowLazyContinuation: false,
      paragraphOpen: false,
    });
    const nextKey = lookaheadState.containers.map((container) => (
      container.kind === "blockquote" ? "q" : `l${container.id}`
    )).join("/");
    if (nextKey !== containerKey) break;
    candidates.push(line.text.slice(offset));
    if (!line.text.slice(offset).trim()) break;
  }

  return candidates;
}

function contentOffsetForContainers(
  line: string,
  containers: readonly OutlineContainer[],
): number {
  const state: OutlineContainerState = {
    containers: containers.map((container) => ({ ...container })),
    nextListId: 1,
  };
  return containerContentOffset(line, state, {
    allowLazyContinuation: false,
    paragraphOpen: false,
  });
}

function linkReferenceDefinitionLineCount(lines: readonly string[]): number {
  const first = lines[0];
  if (first === undefined) return 0;
  const opening = /^ {0,3}\[((?:\\.|[^\[\]\\]){1,999})\]:[ \t]*(.*)$/u.exec(first);
  if (opening === null || !/\S/u.test(opening[1])) return 0;

  const definitionLines = [opening[2], ...lines.slice(1)];
  let lineIndex = 0;
  let destinationLine = definitionLines[0];
  if (!destinationLine.trim()) {
    lineIndex += 1;
    destinationLine = definitionLines[lineIndex] ?? "";
    if (!destinationLine.trim() || startsReferenceContinuationBoundary(destinationLine)) {
      return 0;
    }
  }

  const destinationStart = /^[ \t]*/u.exec(destinationLine)?.[0].length ?? 0;
  const destinationEnd = linkDestinationEnd(destinationLine, destinationStart);
  if (destinationEnd === null) return 0;

  const tail = destinationLine.slice(destinationEnd);
  const separation = /^[ \t]*/u.exec(tail)?.[0] ?? "";
  const possibleTitle = tail.slice(separation.length);
  if (possibleTitle) {
    if (!separation) return 0;
    return linkTitleEndLine(
      definitionLines,
      lineIndex,
      destinationEnd + separation.length,
    ) ?? 0;
  }

  const nextLine = definitionLines[lineIndex + 1];
  if (nextLine !== undefined && !startsReferenceContinuationBoundary(nextLine)) {
    const titleStart = /^[ \t]*/u.exec(nextLine)?.[0].length ?? 0;
    const titleEnd = linkTitleEndLine(definitionLines, lineIndex + 1, titleStart);
    if (titleEnd !== null) return titleEnd;
  }
  return lineIndex + 1;
}

function startsReferenceContinuationBoundary(value: string): boolean {
  const trimmed = value.trimStart();
  return !trimmed ||
    atxHeading(value) !== null ||
    isThematicBreak(value) ||
    /^(?:>|`{3,}|~{3,}|(?:[*+-]|\d{1,9}[.)])(?=[ \t]))/u.test(trimmed);
}

function linkDestinationEnd(value: string, start: number): number | null {
  if (value[start] === "<") {
    for (let index = start + 1; index < value.length; index += 1) {
      if (value[index] === "\\") {
        index += 1;
        continue;
      }
      if (value[index] === "<") return null;
      if (value[index] === ">") return index + 1;
    }
    return null;
  }

  let depth = 0;
  let index = start;
  for (; index < value.length && !/[ \t]/u.test(value[index]); index += 1) {
    if (value[index] === "\\") {
      index += 1;
      continue;
    }
    if (value[index] === "(") depth += 1;
    if (value[index] === ")") {
      if (depth === 0) return null;
      depth -= 1;
    }
  }
  return index > start && depth === 0 ? index : null;
}

function linkTitleEndLine(
  lines: readonly string[],
  startLine: number,
  start: number,
): number | null {
  const opener = lines[startLine]?.[start];
  const closer = opener === "(" ? ")" : opener;
  if (closer !== "\"" && closer !== "'" && closer !== ")") return null;

  for (let lineIndex = startLine; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (lineIndex > startLine && !line.trim()) return null;
    const from = lineIndex === startLine ? start + 1 : 0;
    for (let index = from; index < line.length; index += 1) {
      if (line[index] === "\\") {
        index += 1;
        continue;
      }
      if (line[index] === closer) {
        return line.slice(index + 1).trim() ? null : lineIndex + 1;
      }
    }
  }
  return null;
}

function atxHeading(content: string): RegExpExecArray | null {
  return /^ {0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/u.exec(content);
}

function setextUnderline(content: string): RegExpExecArray | null {
  return /^ {0,3}(=+|-+)[ \t]*$/u.exec(content);
}

function isSetextParagraphLine(content: string): boolean {
  return Boolean(content.trim()) &&
    leadingIndent(content).columns <= 3 &&
    atxHeading(content) === null &&
    setextUnderline(content) === null &&
    !isThematicBreak(content);
}

function isParagraphBoundary(content: string): boolean {
  return !content.trim() ||
    leadingIndent(content).columns > 3 ||
    atxHeading(content) !== null ||
    setextUnderline(content) !== null ||
    isThematicBreak(content);
}

function isThematicBreak(content: string): boolean {
  return /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:_[ \t]*){3,}|(?:-[ \t]*){3,})$/u.test(content);
}

function containerContentOffset(
  line: string,
  state: OutlineContainerState,
  options: { allowLazyContinuation: boolean; paragraphOpen: boolean },
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

function parseListOpening(value: string): {
  characters: number;
  contentIndent: number;
  orderedStart: number | null;
} | null {
  const indentation = leadingIndent(value);
  if (indentation.columns > 3) return null;
  const markerText = value.slice(indentation.index);
  const marker = /^(?:[*+-]|\d{1,9}[.)])(?=[ \t]|$)/u.exec(markerText)?.[0];
  if (marker === undefined) return null;
  const spacingStart = indentation.index + marker.length;
  const spacing = /^[ \t]+/u.exec(value.slice(spacingStart))?.[0] ?? "";
  const spacingIndent = leadingIndent(spacing);
  const useFullSpacing = spacingIndent.columns >= 1 && spacingIndent.columns <= 4;
  const ordered = /^(\d{1,9})[.)]$/u.exec(marker);
  return {
    characters: spacingStart + (useFullSpacing ? spacing.length : Math.min(spacing.length, 1)),
    contentIndent: indentation.columns + marker.length +
      (useFullSpacing ? spacingIndent.columns : 1),
    orderedStart: ordered === null ? null : Number(ordered[1]),
  };
}

function canLazyContinueBlockquote(line: string): boolean {
  return !/^[ \t]*$/u.test(line) &&
    !/^ {0,3}(?:#{1,6}(?:[ \t]+|$)|>|`{3,}|~{3,}|(?:[*+-]|1[.)])(?=[ \t]))/u.test(line) &&
    !isThematicBreak(line);
}

function canLazyContinueList(line: string): boolean {
  return !/^[ \t]*$/u.test(line) &&
    !/^ {0,3}(?:#{1,6}(?:[ \t]+|$)|>|`{3,}|~{3,}|(?:[*+-]|\d{1,9}[.)])(?=[ \t]))/u.test(line) &&
    !isThematicBreak(line);
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

function characterOffsetForIndent(value: string, targetColumns: number): number {
  let columns = 0;
  let index = 0;
  while (index < value.length && columns < targetColumns) {
    if (value[index] === " ") columns += 1;
    else if (value[index] === "\t") columns += 4 - (columns % 4);
    else break;
    index += 1;
  }
  return index;
}

function stripInlineMarkdown(value: string): string {
  const codeSpans: string[] = [];
  const protectedValue = preprocessWikilinks(value)
    .replace(/(`+)([\s\S]*?)\1/gu, (_match, _ticks: string, content: string) => {
      const index = codeSpans.push(content) - 1;
      return `\u0000${index}\u0000`;
    });

  return stripEmphasisDelimiters(protectedValue
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/<([A-Za-z][A-Za-z\d+.-]{1,31}:[^<>\s]*)>/gu, "$1")
    .replace(/<([A-Za-z\d.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z\d](?:[A-Za-z\d.-]*[A-Za-z\d])?)>/gu, "$1")
    .replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<![A-Z][^>]*>/gu, "")
    .replace(/<\/?[A-Za-z][A-Za-z\d-]*(?:[ \t\r\n]+[A-Za-z_:][A-Za-z\d_.:-]*(?:[ \t\r\n]*=[ \t\r\n]*(?:[^ \t\r\n"'=<>`]+|'[^']*'|"[^"]*"))?)*[ \t\r\n]*\/?>/gu, "")
    .replace(/(?<!\\)~~/gu, ""))
    .replace(/\\([\\`*{}\[\]()#+\-.!_>~])/gu, "$1")
    .replace(/\u0000(\d+)\u0000/gu, (_match, index: string) => codeSpans[Number(index)] ?? "")
    .replace(/[ \t\r\n]+/gu, " ")
    .trim();
}

interface EmphasisRun {
  marker: "*" | "_";
  start: number;
  length: number;
  remaining: number;
  openRemoved: number;
  closeRemoved: number;
  canOpen: boolean;
  canClose: boolean;
}

function stripEmphasisDelimiters(value: string): string {
  const runs = emphasisRuns(value);
  const removed = new Set<number>();
  const openers: EmphasisRun[] = [];

  for (const run of runs) {
    while (run.canClose && run.remaining > 0) {
      const opener = [...openers].reverse().find((candidate) => (
        candidate.marker === run.marker &&
        candidate.remaining > 0 &&
        canPairEmphasis(candidate, run)
      ));
      if (opener === undefined) break;
      const count = opener.remaining >= 2 && run.remaining >= 2 ? 2 : 1;
      for (let index = 0; index < count; index += 1) {
        removed.add(opener.start + opener.length - 1 - opener.openRemoved);
        opener.openRemoved += 1;
        removed.add(run.start + run.closeRemoved);
        run.closeRemoved += 1;
      }
      opener.remaining -= count;
      run.remaining -= count;
      const openerIndex = openers.indexOf(opener);
      openers.splice(openerIndex + 1);
    }
    if (run.canOpen && run.remaining > 0) openers.push(run);
  }

  return value.split("").filter((_character, index) => !removed.has(index)).join("");
}

function emphasisRuns(value: string): EmphasisRun[] {
  const runs: EmphasisRun[] = [];
  for (let index = 0; index < value.length;) {
    const marker = value[index];
    if ((marker !== "*" && marker !== "_") || isEscaped(value, index)) {
      index += 1;
      continue;
    }
    let end = index + 1;
    while (value[end] === marker) end += 1;
    const previous = value[index - 1];
    const next = value[end];
    const leftFlanking = !isMarkdownWhitespace(next) &&
      (!isMarkdownPunctuation(next) ||
        isMarkdownWhitespace(previous) ||
        isMarkdownPunctuation(previous));
    const rightFlanking = !isMarkdownWhitespace(previous) &&
      (!isMarkdownPunctuation(previous) ||
        isMarkdownWhitespace(next) ||
        isMarkdownPunctuation(next));
    const canOpen = marker === "*"
      ? leftFlanking
      : leftFlanking && (!rightFlanking || isMarkdownPunctuation(previous));
    const canClose = marker === "*"
      ? rightFlanking
      : rightFlanking && (!leftFlanking || isMarkdownPunctuation(next));
    runs.push({
      marker,
      start: index,
      length: end - index,
      remaining: end - index,
      openRemoved: 0,
      closeRemoved: 0,
      canOpen,
      canClose,
    });
    index = end;
  }
  return runs;
}

function canPairEmphasis(opener: EmphasisRun, closer: EmphasisRun): boolean {
  if ((!opener.canClose && !closer.canOpen) ||
    (opener.remaining + closer.remaining) % 3 !== 0) {
    return true;
  }
  return opener.remaining % 3 === 0 && closer.remaining % 3 === 0;
}

function isMarkdownWhitespace(value: string | undefined): boolean {
  return value === undefined || /\s/u.test(value);
}

function isMarkdownPunctuation(value: string | undefined): boolean {
  return value !== undefined && /[\p{P}\p{S}]/u.test(value);
}

function isEscaped(value: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

function slugBase(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}_\-\s]/gu, "")
    .replace(/\s+/gu, "-");
  return slug || "section";
}
