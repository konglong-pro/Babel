import type { PdfRect } from "@babel-apps/platform/pdf/core";

export interface PdfExcerpt {
  id: string;
  title: string;
  page: number;
  text: string;
  imageDataUrl?: string;
}

export interface PdfPreparedImage {
  token: string;
  file: File;
  previewUrl: string;
}

export interface PreparedPdfExcerpt {
  markdown: string;
  image?: PdfPreparedImage;
}

export const PDF_EXCERPT_MAX_TEXT = 20_000;
export const PDF_EXCERPT_MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export function isPdfExcerpt(value: unknown): value is PdfExcerpt {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PdfExcerpt>;
  return typeof candidate.id === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(candidate.id) &&
    typeof candidate.title === "string" && candidate.title.length > 0 && candidate.title.length <= 240 &&
    Number.isSafeInteger(candidate.page) && candidate.page! >= 1 &&
    typeof candidate.text === "string" && candidate.text.length <= PDF_EXCERPT_MAX_TEXT &&
    (candidate.imageDataUrl === undefined ||
      (typeof candidate.imageDataUrl === "string" && candidate.imageDataUrl.length <= PDF_EXCERPT_MAX_IMAGE_BYTES * 1.38 &&
        /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/u.test(candidate.imageDataUrl))) &&
    (candidate.text.trim().length > 0 || candidate.imageDataUrl !== undefined);
}

function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_{}\[\]<>#!|$~+\-=.])/gu, "\\$1");
}

export async function preparePdfExcerpt(excerpt: PdfExcerpt, uploadScheme: string): Promise<PreparedPdfExcerpt> {
  if (!isPdfExcerpt(excerpt)) throw new Error("This PDF selection is empty or exceeds the excerpt limits.");
  if (!/^[a-z][a-z0-9-]*$/u.test(uploadScheme)) throw new Error("Invalid notebook image scheme.");
  const parts: string[] = [];
  let image: PdfPreparedImage | undefined;
  if (excerpt.text.trim()) parts.push(excerpt.text.trim().split(/\r?\n/u).map((line) => `> ${escapeMarkdown(line)}`).join("\n"));
  if (excerpt.imageDataUrl) {
    const bytes = Uint8Array.from(atob(excerpt.imageDataUrl.slice(excerpt.imageDataUrl.indexOf(",") + 1)), (char) => char.charCodeAt(0));
    if (bytes.byteLength > PDF_EXCERPT_MAX_IMAGE_BYTES ||
      ![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) {
      throw new Error("PDF screenshots must be PNG images no larger than 10 MiB.");
    }
    const token = crypto.randomUUID();
    image = { token, file: new File([bytes], `pdf-page-${excerpt.page}.png`, { type: "image/png" }), previewUrl: excerpt.imageDataUrl };
    parts.push(`![${escapeMarkdown(excerpt.title)} — p. ${excerpt.page}](${uploadScheme}://${token})`);
  }
  parts.push(`*${escapeMarkdown(excerpt.title)} · p. ${excerpt.page}*`);
  return { markdown: parts.join("\n\n"), ...(image ? { image } : {}) };
}

export function appendPdfMarkdown(current: string, addition: string): string {
  const separator = !current || current.endsWith("\n\n") ? "" : current.endsWith("\n") ? "\n" : "\n\n";
  return `${current}${separator}${addition.trim()}\n`;
}

/** Persist page geometry independently of rotation and zoom. */
export function unrotatePdfRect(rect: PdfRect, rotation: number): PdfRect {
  // Floating point subtraction at a page edge can produce -2e-17.
  const complement = (start: number, size: number) => Math.max(0, Math.min(1, 1 - start - size));
  switch ((rotation % 360 + 360) % 360) {
    case 90: return { x: rect.y, y: complement(rect.x, rect.width), width: rect.height, height: rect.width };
    case 180: return { x: complement(rect.x, rect.width), y: complement(rect.y, rect.height), width: rect.width, height: rect.height };
    case 270: return { x: complement(rect.y, rect.height), y: rect.x, width: rect.height, height: rect.width };
    default: return { ...rect };
  }
}

export function rotatePdfRect(rect: PdfRect, rotation: number): PdfRect {
  return unrotatePdfRect(rect, 360 - rotation);
}
