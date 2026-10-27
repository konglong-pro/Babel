import { isHtmlAnnotations, isHtmlProgress, type HtmlDocument } from "@babel-apps/platform/html/core";

/** Browser-saved pages can retain their original character encoding. */
export function decodeHtmlBytes(bytes: Uint8Array): string {
  let encoding = "utf-8";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = "utf-16le";
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = "utf-16be";
  else if (!(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)) {
    const prefix = new TextDecoder("windows-1252").decode(bytes.subarray(0, 2048));
    const meta = /<meta\b[^>]*\bcharset\s*=\s*["']?\s*([a-z0-9_-]+)/iu.exec(prefix);
    if (meta) encoding = meta[1];
  }
  try { return new TextDecoder(encoding).decode(bytes); }
  catch { return new TextDecoder("utf-8").decode(bytes); }
}

export function isHtmlDocument(value: unknown): value is HtmlDocument {
  if (!value || typeof value !== "object") return false;
  const book = value as Partial<HtmlDocument>;
  return typeof book.id === "string" && typeof book.title === "string" && typeof book.fileName === "string" &&
    typeof book.entryPath === "string" && typeof book.bundleId === "string" && isHtmlProgress(book.progress) &&
    Number.isSafeInteger(book.progressRevision) && Number.isSafeInteger(book.annotationsRevision) &&
    isHtmlAnnotations(book.annotations) && Boolean(book.bundle && book.bundle.id === book.bundleId && Array.isArray(book.bundle.files));
}
