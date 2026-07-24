import { maskCodeRegions } from "./core";

export type FormulaEngine = "typst" | "latex";
export type FormulaDisplay = "inline" | "block";

export interface FormulaOccurrence {
  engine: FormulaEngine;
  source: string;
  display: FormulaDisplay;
  sourceLine: number;
  sourceColumn: number;
  marker: string;
}

export interface PreparedFormulaMath {
  content: string;
  occurrences: readonly FormulaOccurrence[];
  markerPattern: RegExp;
}

export interface FormulaEngineOptions {
  typst?: boolean;
  latex?: boolean;
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

interface FormulaDelimiter {
  engine: FormulaEngine;
  opening: string;
  closing: string;
  display: FormulaDisplay | "dollar-auto";
  multiline: boolean;
}

interface OpeningDelimiter {
  index: number;
  delimiter: FormulaDelimiter;
}

const LATEX_DOUBLE_DOLLAR: FormulaDelimiter = {
  engine: "latex",
  opening: "$$",
  closing: "$$",
  display: "block",
  multiline: true,
};
const LATEX_INLINE: FormulaDelimiter = {
  engine: "latex",
  opening: "\\(",
  closing: "\\)",
  display: "inline",
  multiline: false,
};
const LATEX_BLOCK: FormulaDelimiter = {
  engine: "latex",
  opening: "\\[",
  closing: "\\]",
  display: "block",
  multiline: true,
};
const SINGLE_DOLLAR: FormulaDelimiter = {
  engine: "typst",
  opening: "$",
  closing: "$",
  display: "dollar-auto",
  multiline: false,
};

const LATEX_CONTROL_SEQUENCE =
  /\\(?:[A-Za-z]+|[^A-Za-z0-9\s])/u;
const LATEX_BRACED_SCRIPT = /[_^]\s*\{/u;
const LATEX_IMPLICIT_PRODUCT =
  /(?:^|[^A-Za-z0-9_])\d+(?:\.\d+)?[A-Za-z]{2,}(?![A-Za-z0-9_])/u;

/**
 * Extracts formulas before Markdown can interpret their punctuation. Babel's
 * delimiters are intentionally explicit: `\\(...\\)`, `\\[...\\]`, and
 * `$$...$$` are LaTeX rendered by KaTeX. Single dollars default to native
 * Typst, but recognizable LaTeX control sequences, braced scripts, and
 * implicit products such as `4ac` are routed to KaTeX in dual-engine mode for
 * compatibility with traditional Markdown math. Code regions and escaped
 * delimiters remain literal.
 */
export function prepareFormulaMath(
  markdown: string,
  engines: Readonly<FormulaEngineOptions> = { typst: true, latex: true },
): PreparedFormulaMath {
  const codeMask = maskCodeRegions(markdown);
  const markerPrefix = unusedMarkerPrefix(markdown);
  const markerSuffix = "\uE001";
  const occurrences: FormulaOccurrence[] = [];
  let output = "";
  let cursor = 0;
  let searchFrom = 0;
  let opening = nextOpening(markdown, codeMask, searchFrom, engines);

  while (opening !== null) {
    const { delimiter } = opening;
    const sourceStart = opening.index + delimiter.opening.length;
    const searchEnd = delimiter.multiline
      ? markdown.length
      : endOfLine(markdown, sourceStart);
    const closing = nextClosing(
      markdown,
      codeMask,
      sourceStart,
      searchEnd,
      delimiter,
    );

    if (closing === -1) {
      searchFrom = sourceStart;
      opening = nextOpening(markdown, codeMask, searchFrom, engines);
      continue;
    }

    const rawSource = markdown.slice(sourceStart, closing);
    const source = rawSource.trim();
    if (source === "") {
      searchFrom = closing + delimiter.closing.length;
      opening = nextOpening(markdown, codeMask, searchFrom, engines);
      continue;
    }

    const leadingWhitespace = rawSource.length - rawSource.trimStart().length;
    const sourceOffset = sourceStart + leadingWhitespace;
    const marker = `${markerPrefix}${occurrences.length}${markerSuffix}`;
    occurrences.push({
      engine: delimiter === SINGLE_DOLLAR
        ? singleDollarEngine(source, engines)
        : delimiter.engine,
      source,
      display: delimiter.display === "dollar-auto"
        ? singleDollarDisplay(markdown, opening.index, closing, rawSource)
        : delimiter.display,
      ...lineAndColumn(markdown, sourceOffset),
      marker,
    });
    output += markdown.slice(cursor, opening.index) + marker;
    cursor = closing + delimiter.closing.length;
    searchFrom = cursor;
    opening = nextOpening(markdown, codeMask, searchFrom, engines);
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
export function createRemarkFormulaMath(
  prepared: Pick<PreparedFormulaMath, "occurrences" | "markerPattern">,
): () => (tree: MarkdownNode) => void {
  return function remarkFormulaMath() {
    return (tree) => replaceMarkers(tree, prepared);
  };
}

function replaceMarkers(
  node: MarkdownNode,
  prepared: Pick<PreparedFormulaMath, "occurrences" | "markerPattern">,
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
          type: "babelFormula",
          children: [],
          data: {
            hName: "babel-formula",
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

function nextOpening(
  markdown: string,
  codeMask: Uint8Array,
  from: number,
  engines: Readonly<FormulaEngineOptions>,
): OpeningDelimiter | null {
  for (let index = from; index < markdown.length; index += 1) {
    if (codeMask[index] !== 0) continue;
    if (engines.latex === true) {
      if (matchesDoubleDollar(markdown, codeMask, index)) {
        return { index, delimiter: LATEX_DOUBLE_DOLLAR };
      }
      if (matchesBackslashDelimiter(markdown, codeMask, index, "(")) {
        return { index, delimiter: LATEX_INLINE };
      }
      if (matchesBackslashDelimiter(markdown, codeMask, index, "[")) {
        return { index, delimiter: LATEX_BLOCK };
      }
    }
    if (engines.typst === true && matchesSingleDollar(markdown, codeMask, index)) {
      return { index, delimiter: SINGLE_DOLLAR };
    }
  }
  return null;
}

function nextClosing(
  markdown: string,
  codeMask: Uint8Array,
  from: number,
  before: number,
  delimiter: FormulaDelimiter,
): number {
  for (let index = from; index < before; index += 1) {
    if (codeMask[index] !== 0) continue;
    if (delimiter === LATEX_DOUBLE_DOLLAR && matchesDoubleDollar(markdown, codeMask, index)) {
      return index;
    }
    if (delimiter === LATEX_INLINE && matchesBackslashDelimiter(markdown, codeMask, index, ")")) {
      return index;
    }
    if (delimiter === LATEX_BLOCK && matchesBackslashDelimiter(markdown, codeMask, index, "]")) {
      return index;
    }
    if (delimiter === SINGLE_DOLLAR && matchesSingleDollar(markdown, codeMask, index)) {
      return index;
    }
  }
  return -1;
}

function matchesDoubleDollar(
  markdown: string,
  codeMask: Uint8Array,
  index: number,
): boolean {
  return markdown[index] === "$" &&
    markdown[index + 1] === "$" &&
    codeMask[index + 1] === 0 &&
    markdown[index - 1] !== "$" &&
    markdown[index + 2] !== "$" &&
    !isEscaped(markdown, index);
}

function matchesSingleDollar(
  markdown: string,
  codeMask: Uint8Array,
  index: number,
): boolean {
  return markdown[index] === "$" &&
    codeMask[index] === 0 &&
    markdown[index - 1] !== "$" &&
    markdown[index + 1] !== "$" &&
    !isEscaped(markdown, index);
}

function matchesBackslashDelimiter(
  markdown: string,
  codeMask: Uint8Array,
  index: number,
  bracket: "(" | ")" | "[" | "]",
): boolean {
  return markdown[index] === "\\" &&
    markdown[index + 1] === bracket &&
    codeMask[index + 1] === 0 &&
    !isEscaped(markdown, index);
}

function isEscaped(value: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

function singleDollarEngine(
  source: string,
  engines: Readonly<FormulaEngineOptions>,
): FormulaEngine {
  if (
    engines.latex === true &&
    (
      LATEX_CONTROL_SEQUENCE.test(source) ||
      LATEX_BRACED_SCRIPT.test(source) ||
      LATEX_IMPLICIT_PRODUCT.test(source)
    )
  ) {
    return "latex";
  }
  return "typst";
}

function singleDollarDisplay(
  markdown: string,
  opening: number,
  closing: number,
  rawSource: string,
): FormulaDisplay {
  if (!/^\s[\s\S]*\s$/u.test(rawSource)) return "inline";
  const lineStart = markdown.lastIndexOf("\n", opening - 1) + 1;
  const lineEnd = endOfLine(markdown, closing);
  return markdown.slice(lineStart, opening).trim() === "" &&
      markdown.slice(closing + 1, lineEnd).trim() === ""
    ? "block"
    : "inline";
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
  let prefix = "\uE000formula";
  while (markdown.includes(prefix)) prefix += "\uE000";
  return prefix;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
