import { maskCodeRegions } from "./core";

export interface AutocompleteQuery {
  openingIndex: number;
  query: string;
}

export function findAutocompleteQuery(
  value: string,
  selectionStart: number,
  selectionEnd: number,
): AutocompleteQuery | null {
  if (selectionStart !== selectionEnd) return null;
  const beforeCursor = value.slice(0, selectionStart);
  const codeMask = maskCodeRegions(value);
  const openingIndex = beforeCursor.lastIndexOf("[[");
  if (openingIndex === -1 || codeMask[openingIndex] || isEscaped(beforeCursor, openingIndex)) {
    return null;
  }
  if (
    openingIndex > 0 &&
    beforeCursor[openingIndex - 1] === "!" &&
    !isEscaped(beforeCursor, openingIndex - 1)
  ) {
    return null;
  }

  for (let index = openingIndex; index < selectionStart; index += 1) {
    if (codeMask[index]) return null;
  }

  const query = beforeCursor.slice(openingIndex + 2);
  if (/[\r\n\[\]|]/u.test(query) || query.includes("]]")) return null;
  return { openingIndex, query };
}

function isEscaped(value: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}
