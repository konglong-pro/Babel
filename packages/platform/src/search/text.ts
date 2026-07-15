export interface SearchTextPart {
  text: string;
  highlighted: boolean;
}

export interface SearchTextSnippet {
  parts: SearchTextPart[];
  truncatedStart: boolean;
  truncatedEnd: boolean;
}

const graphemeSegmenter = new Intl.Segmenter("und", { granularity: "grapheme" });

export function asciiFold(value: string): string {
  return value.replace(/[A-Z]/g, (character) => character.toLowerCase());
}

export function literalIndexOf(value: string, query: string, fromIndex = 0): number {
  return asciiFold(value).indexOf(asciiFold(query), fromIndex);
}

export function literalTextPosition(value: string, query: string): number {
  const codeUnitIndex = literalIndexOf(value, query);
  return codeUnitIndex < 0 ? -1 : [...value.slice(0, codeUnitIndex)].length;
}

export function countLiteralOccurrences(value: string, query: string): number {
  if (!query) return 0;

  let count = 0;
  let cursor = 0;
  let match = literalIndexOf(value, query, cursor);
  while (match >= 0) {
    count += 1;
    cursor = match + query.length;
    match = literalIndexOf(value, query, cursor);
  }
  return count;
}

export function createTextSnippet(
  value: string,
  query: string,
  maxCharacters = 180,
): SearchTextSnippet {
  const text = value.replace(/\s+/gu, " ").trim();
  const displayQuery = query.replace(/\s+/gu, " ").trim();
  const characters = graphemes(text);
  const limit = Math.max(1, maxCharacters);
  if (characters.length <= limit) {
    return {
      parts: highlightLiteral(text, displayQuery),
      truncatedStart: false,
      truncatedEnd: false,
    };
  }

  const matchIndex = literalIndexOf(text, displayQuery);
  const matchStart = matchIndex < 0
    ? 0
    : graphemeBoundaryAt(characters, matchIndex, "start");
  const matchEnd = matchIndex < 0
    ? 0
    : graphemeBoundaryAt(characters, matchIndex + displayQuery.length, "end");
  const targetLength = Math.max(limit, matchEnd - matchStart);
  const start = Math.max(
    0,
    matchStart - Math.floor((targetLength - (matchEnd - matchStart)) / 2),
  );
  const end = Math.min(characters.length, start + targetLength);
  const balancedStart = Math.max(0, end - targetLength);
  const boundaryStart = nearestTextBoundary(characters, balancedStart, "start");
  const boundaryEnd = nearestTextBoundary(characters, end, "end");
  const adjustedStart = Math.min(boundaryStart, matchStart);
  const adjustedEnd = Math.max(boundaryEnd, matchEnd);

  return {
    parts: highlightLiteral(characters.slice(adjustedStart, adjustedEnd).join(""), displayQuery),
    truncatedStart: adjustedStart > 0,
    truncatedEnd: adjustedEnd < characters.length,
  };
}

export function createCodeSnippet(
  value: string,
  query: string,
  maxLines = 3,
  maxCharacters = 360,
): SearchTextSnippet {
  const lineLimit = Math.max(1, Math.floor(maxLines));
  const matchIndex = literalIndexOf(value, query);
  const matchEnd = matchIndex < 0 ? 0 : matchIndex + query.length;
  const lines = codeLines(value);
  const firstMatchLine = lineIndexAt(value, Math.max(0, matchIndex));
  const lastMatchLine = lineIndexAt(value, Math.max(0, matchEnd - 1));
  const matchedLineCount = lastMatchLine - firstMatchLine + 1;
  let firstLine = matchedLineCount >= lineLimit
    ? firstMatchLine
    : Math.max(0, firstMatchLine - Math.floor((lineLimit - matchedLineCount) / 2));
  const lastLine = Math.min(lines.length - 1, firstLine + lineLimit - 1);
  firstLine = Math.max(0, lastLine - lineLimit + 1);

  let window = "";
  for (let index = firstLine; index <= lastLine; index += 1) {
    window += lines[index]!.text;
    if (index < lastLine) window += lines[index]!.separator;
  }
  const bounded = createRawSnippet(window, query, Math.max(1, maxCharacters));
  return {
    parts: highlightLiteral(bounded.text, query),
    truncatedStart: firstLine > 0 || bounded.truncatedStart,
    truncatedEnd: lastLine < lines.length - 1 || bounded.truncatedEnd,
  };
}

export function highlightLiteral(value: string, query: string): SearchTextPart[] {
  if (!query) return [{ text: value, highlighted: false }];

  const parts: SearchTextPart[] = [];
  let cursor = 0;
  let match = literalIndexOf(value, query, cursor);
  while (match >= 0) {
    if (match > cursor) parts.push({ text: value.slice(cursor, match), highlighted: false });
    parts.push({ text: value.slice(match, match + query.length), highlighted: true });
    cursor = match + query.length;
    match = literalIndexOf(value, query, cursor);
  }
  if (cursor < value.length || parts.length === 0) {
    parts.push({ text: value.slice(cursor), highlighted: false });
  }
  return parts;
}

function graphemes(value: string): string[] {
  return [...graphemeSegmenter.segment(value)].map(({ segment }) => segment);
}

function createRawSnippet(
  value: string,
  query: string,
  maxCharacters: number,
): { text: string; truncatedStart: boolean; truncatedEnd: boolean } {
  const characters = graphemes(value);
  if (characters.length <= maxCharacters) {
    return { text: value, truncatedStart: false, truncatedEnd: false };
  }

  const matchIndex = literalIndexOf(value, query);
  const matchStart = matchIndex < 0
    ? 0
    : graphemeBoundaryAt(characters, matchIndex, "start");
  const matchEnd = matchIndex < 0
    ? 0
    : graphemeBoundaryAt(characters, matchIndex + query.length, "end");
  const targetLength = Math.max(maxCharacters, matchEnd - matchStart);
  const start = Math.max(
    0,
    matchStart - Math.floor((targetLength - (matchEnd - matchStart)) / 2),
  );
  const end = Math.min(characters.length, start + targetLength);
  const balancedStart = Math.max(0, end - targetLength);
  return {
    text: characters.slice(balancedStart, end).join(""),
    truncatedStart: balancedStart > 0,
    truncatedEnd: end < characters.length,
  };
}

function lineIndexAt(value: string, index: number): number {
  let line = 0;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (value[cursor] === "\r") {
      if (value[cursor + 1] === "\n") cursor += 1;
      line += 1;
    } else if (value[cursor] === "\n") {
      line += 1;
    }
  }
  return line;
}

function codeLines(value: string): Array<{ text: string; separator: string }> {
  const lines: Array<{ text: string; separator: string }> = [];
  const separators = /\r\n|\r|\n/g;
  let cursor = 0;
  let match = separators.exec(value);
  while (match) {
    lines.push({ text: value.slice(cursor, match.index), separator: match[0] });
    cursor = match.index + match[0].length;
    match = separators.exec(value);
  }
  lines.push({ text: value.slice(cursor), separator: "" });
  return lines;
}

function graphemeBoundaryAt(
  characters: readonly string[],
  codeUnitIndex: number,
  edge: "start" | "end",
): number {
  let offset = 0;
  for (let index = 0; index < characters.length; index += 1) {
    if (codeUnitIndex === offset) return index;
    const nextOffset = offset + characters[index]!.length;
    if (codeUnitIndex < nextOffset) return edge === "start" ? index : index + 1;
    offset = nextOffset;
  }
  return characters.length;
}

function nearestTextBoundary(
  characters: readonly string[],
  target: number,
  edge: "start" | "end",
): number {
  if (target <= 0 || target >= characters.length) return target;

  for (let distance = 0; distance <= 24; distance += 1) {
    const before = target - distance;
    const after = target + distance;
    if (before > 0 && isTextBoundary(characters, before, edge)) return before;
    if (after < characters.length && isTextBoundary(characters, after, edge)) return after;
  }
  return target;
}

function isTextBoundary(
  characters: readonly string[],
  index: number,
  edge: "start" | "end",
): boolean {
  const before = characters[index - 1];
  const after = characters[index];
  if (edge === "start") return before !== undefined && isBreakCharacter(before);
  return (after !== undefined && /\s/u.test(after))
    || (before !== undefined && isPunctuation(before));
}

function isBreakCharacter(character: string): boolean {
  return /\s/u.test(character) || isPunctuation(character);
}

function isPunctuation(character: string): boolean {
  return /[,.!?;:、。，！？；：—–…》〉】）」』]/u.test(character);
}
