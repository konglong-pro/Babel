import { maskCodeRegions } from "./core";

export interface TypstMathOccurrence {
  source: string;
  display: "inline" | "block";
  sourceLine: number;
  sourceColumn: number;
  marker: string;
}

export interface PreparedTypstMath {
  content: string;
  occurrences: readonly TypstMathOccurrence[];
  markerPattern: RegExp;
}

interface MarkdownNode {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  data?: {
    hName?: string;
    hProperties?: Record<string, unknown>;
  };
}

/**
 * Extracts Babel's native Typst delimiters before Markdown interprets formula
 * punctuation. Only single dollars participate: `$x$` is inline and a whole
 * line written as `$ x $` is display math. Code and escaped dollars are left
 * untouched, and `$$...$$` deliberately has no compatibility behavior.
 */
export function prepareTypstMath(markdown: string): PreparedTypstMath {
  const codeMask = maskCodeRegions(markdown);
  const markerPrefix = unusedMarkerPrefix(markdown);
  const markerSuffix = "\uE001";
  const occurrences: TypstMathOccurrence[] = [];
  let output = "";
  let cursor = 0;
  let opening = nextDelimiter(markdown, codeMask, 0);

  while (opening !== -1) {
    const lineEnd = endOfLine(markdown, opening);
    const closing = nextDelimiter(markdown, codeMask, opening + 1, lineEnd);
    if (closing === -1) {
      opening = nextDelimiter(markdown, codeMask, opening + 1);
      continue;
    }

    const rawSource = markdown.slice(opening + 1, closing);
    const source = rawSource.trim();
    if (source === "") {
      opening = nextDelimiter(markdown, codeMask, closing + 1);
      continue;
    }

    const leadingWhitespace = rawSource.length - rawSource.trimStart().length;
    const sourceOffset = opening + 1 + leadingWhitespace;
    const marker = `${markerPrefix}${occurrences.length}${markerSuffix}`;
    const occurrence: TypstMathOccurrence = {
      source,
      display: isDisplayFormula(markdown, opening, closing, rawSource) ? "block" : "inline",
      ...lineAndColumn(markdown, sourceOffset),
      marker,
    };
    occurrences.push(occurrence);
    output += markdown.slice(cursor, opening) + marker;
    cursor = closing + 1;
    opening = nextDelimiter(markdown, codeMask, cursor);
  }

  output += markdown.slice(cursor);
  return {
    content: output,
    occurrences,
    markerPattern: new RegExp(
      `${escapeRegExp(markerPrefix)}(\\d+)${escapeRegExp(markerSuffix)}`,
      "gu",
    ),
  };
}

/** Creates a remark transformer for one prepared Markdown document. */
export function createRemarkTypstMath(
  prepared: Pick<PreparedTypstMath, "occurrences" | "markerPattern">,
): () => (tree: MarkdownNode) => void {
  return function remarkTypstMath() {
    return (tree) => replaceMarkers(tree, prepared);
  };
}

function replaceMarkers(
  node: MarkdownNode,
  prepared: Pick<PreparedTypstMath, "occurrences" | "markerPattern">,
): void {
  if (node.children === undefined) return;
  const nextChildren: MarkdownNode[] = [];

  for (const child of node.children) {
    if (child.type !== "text" || child.value === undefined) {
      replaceMarkers(child, prepared);
      nextChildren.push(child);
      continue;
    }

    let cursor = 0;
    prepared.markerPattern.lastIndex = 0;
    for (const match of child.value.matchAll(prepared.markerPattern)) {
      const start = match.index;
      if (start > cursor) {
        nextChildren.push({ type: "text", value: child.value.slice(cursor, start) });
      }
      const index = Number.parseInt(match[1], 10);
      if (prepared.occurrences[index] !== undefined) {
        nextChildren.push({
          type: "typstFormula",
          children: [],
          data: {
            hName: "typst-formula",
            hProperties: { formulaIndex: index },
          },
        });
      } else {
        nextChildren.push({ type: "text", value: match[0] });
      }
      cursor = start + match[0].length;
    }
    if (cursor < child.value.length) {
      nextChildren.push({ type: "text", value: child.value.slice(cursor) });
    }
  }

  node.children = nextChildren;
}

function nextDelimiter(
  markdown: string,
  codeMask: Uint8Array,
  from: number,
  before = markdown.length,
): number {
  for (let index = from; index < before; index += 1) {
    if (
      markdown[index] === "$" &&
      codeMask[index] === 0 &&
      markdown[index - 1] !== "$" &&
      markdown[index + 1] !== "$" &&
      !isEscaped(markdown, index)
    ) {
      return index;
    }
  }
  return -1;
}

function isEscaped(value: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

function isDisplayFormula(
  markdown: string,
  opening: number,
  closing: number,
  rawSource: string,
): boolean {
  if (!/^\s[\s\S]*\s$/u.test(rawSource)) return false;
  const lineStart = markdown.lastIndexOf("\n", opening - 1) + 1;
  const lineEnd = endOfLine(markdown, closing);
  return markdown.slice(lineStart, opening).trim() === "" &&
    markdown.slice(closing + 1, lineEnd).trim() === "";
}

function endOfLine(value: string, index: number): number {
  const newline = value.indexOf("\n", index);
  return newline === -1 ? value.length : newline;
}

function lineAndColumn(value: string, index: number): {
  sourceLine: number;
  sourceColumn: number;
} {
  let sourceLine = 1;
  let lineStart = 0;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (value[cursor] === "\n") {
      sourceLine += 1;
      lineStart = cursor + 1;
    }
  }
  return { sourceLine, sourceColumn: index - lineStart + 1 };
}

function unusedMarkerPrefix(markdown: string): string {
  let prefix = "\uE000typst";
  while (markdown.includes(prefix)) prefix += "\uE000";
  return prefix;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
