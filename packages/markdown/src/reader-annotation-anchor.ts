/** A quote and its position in the rendered text of one reader field. */
export interface ReaderUnderlineAnchor {
  start: number;
  end: number;
  exact: string;
  prefix: string;
  suffix: string;
}

export interface ReaderUnderline {
  id: number;
  fieldKey: string;
  color: string;
  anchor: ReaderUnderlineAnchor;
  noteIds: number[];
}

export interface ReaderTextPosition {
  start: number;
  end: number;
}

const CONTEXT_LENGTH = 32;

/** Capture UTF-16 offsets from the rendered text, not Markdown source offsets. */
export function captureReaderUnderlineAnchor(
  text: string,
  start: number,
  end: number,
): ReaderUnderlineAnchor | null {
  if (!Number.isInteger(start) || !Number.isInteger(end) ||
    start < 0 || end > text.length || end <= start) return null;

  // A selection of only whitespace cannot identify a passage reliably.
  while (start < end && /\s/u.test(text[start])) start++;
  while (end > start && /\s/u.test(text[end - 1])) end--;
  if (end <= start) return null;

  return {
    start,
    end,
    exact: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT_LENGTH), start),
    suffix: text.slice(end, end + CONTEXT_LENGTH),
  };
}

/**
 * Resolve an underline after rerendering or source edits. Repeated quotations
 * need a unique contextual match; ambiguous text is left unmarked rather than
 * silently moving a line to another passage.
 */
export function resolveReaderUnderlineAnchor(
  text: string,
  anchor: ReaderUnderlineAnchor,
): ReaderTextPosition | null {
  if (!anchor.exact || !Number.isInteger(anchor.start) || !Number.isInteger(anchor.end) ||
    anchor.start < 0 || anchor.end <= anchor.start) {
    return null;
  }

  const matches: { position: ReaderTextPosition; contextScore: number }[] = [];
  let searchFrom = 0;
  while (searchFrom <= text.length - anchor.exact.length) {
    const start = text.indexOf(anchor.exact, searchFrom);
    if (start === -1) break;
    const end = start + anchor.exact.length;
    matches.push({
      position: { start, end },
      contextScore: matchingPrefix(text, start, anchor.prefix) +
        matchingSuffix(text, end, anchor.suffix),
    });
    searchFrom = start + 1;
  }

  if (matches.length === 0) return null;
  const availableContext = anchor.prefix.length + anchor.suffix.length;
  const requiredContext = Math.min(8, availableContext);
  if (matches.length === 1) {
    // A short quotation can reappear elsewhere after its original paragraph
    // is deleted. Require some context before moving that underline.
    return anchor.exact.length >= 12 ||
      (availableContext === 0
        ? matches[0].position.start === anchor.start
        : matches[0].contextScore >= requiredContext)
      ? matches[0].position
      : null;
  }

  matches.sort((left, right) => right.contextScore - left.contextScore);
  const best = matches[0];
  if (best.contextScore < requiredContext ||
    best.contextScore === matches[1].contextScore) return null;
  return best.position;
}

/** Remove only an exact selected underline, or the explicitly active line when nothing is selected. */
export function resolveReaderUnderlineRemovalId(
  text: string,
  annotations: readonly ReaderUnderline[],
  selected: ReaderUnderlineAnchor | null,
  activeId: number | null,
): number | null {
  if (selected === null) {
    return annotations.find((annotation) => annotation.id === activeId)?.id ?? null;
  }

  const matches = annotations.filter((annotation) => {
    const position = resolveReaderUnderlineAnchor(text, annotation.anchor);
    return position !== null && position.start === selected.start && position.end === selected.end;
  });
  if (matches.length === 1) return matches[0].id;
  return matches.find((annotation) => annotation.id === activeId)?.id ?? null;
}

function matchingPrefix(text: string, start: number, prefix: string): number {
  let count = 0;
  while (count < prefix.length && count < start &&
    text[start - count - 1] === prefix[prefix.length - count - 1]) count++;
  return count;
}

function matchingSuffix(text: string, end: number, suffix: string): number {
  let count = 0;
  while (count < suffix.length && end + count < text.length &&
    text[end + count] === suffix[count]) count++;
  return count;
}
