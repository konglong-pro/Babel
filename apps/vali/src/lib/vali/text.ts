import { ValidationError } from "./errors";

// Python 3.11 uses Unicode 14 full case folding. Node 22's ICU is newer, so
// folding one code point at a time needs a few compatibility guards.
const PYTHON_311_UNCASED = new Set(["\u0131", "\u1c89", "\ua7cb", "\ua7cc", "\ua7da", "\ua7dc"]);

export function caseFold(value: string): string {
  return Array.from(value, foldCodePoint).join("");
}

export function legacyInteger(value: number): number {
  if (!Number.isFinite(value)) {
    throw new ValidationError("Order must be a finite number");
  }
  return Math.trunc(value);
}

function foldCodePoint(value: string): string {
  const codePoint = value.codePointAt(0)!;
  if (
    PYTHON_311_UNCASED.has(value) ||
    (codePoint >= 0x10d50 && codePoint <= 0x10d65)
  ) {
    return value;
  }

  const folded = value.toUpperCase().toLowerCase().replaceAll("\u00df", "ss");
  return Array.from(folded, (character) => {
    const foldedCodePoint = character.codePointAt(0)!;
    if (
      (foldedCodePoint >= 0xab70 && foldedCodePoint <= 0xabbf) ||
      (foldedCodePoint >= 0x13f8 && foldedCodePoint <= 0x13fd)
    ) {
      return character.toUpperCase();
    }
    return character;
  }).join("");
}
