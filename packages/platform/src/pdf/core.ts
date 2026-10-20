/** Coordinates are relative to the unrotated PDF page, from its top-left corner. */
export interface PdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfProgress {
  page: number;
  scale: number;
  rotation: 0 | 90 | 180 | 270;
}

export interface PdfAnnotation {
  id: string;
  type: "highlight" | "underline" | "comment";
  page: number;
  rects: PdfRect[];
  text: string;
  comment: string;
  color: string;
  createdAt: string;
}

export interface PdfDocumentSummary {
  id: string;
  folderId: string | null;
  title: string;
  fileName: string;
  size: number;
  importedAt: string;
  updatedAt: string;
  progress: PdfProgress;
  progressRevision: number;
  annotationsRevision: number;
}

export interface PdfDocument extends PdfDocumentSummary {
  annotations: PdfAnnotation[];
}

export interface PdfFolder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export const PDF_MAX_FILE_BYTES = 512 * 1024 * 1024;
export const PDF_MAX_ANNOTATIONS = 10_000;
export const PDF_TITLE_MAX_LENGTH = 240;
export const PDF_FOLDER_NAME_MAX_LENGTH = 120;
export const PDF_FOLDER_MAX_DEPTH = 32;
export const PDF_DEFAULT_PROGRESS: Readonly<PdfProgress> = { page: 1, scale: 1, rotation: 0 };

/** Match sibling names consistently in folder pickers and private metadata. */
export function pdfFolderNameKey(name: string): string {
  return name.trim().normalize("NFC").toLowerCase();
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function onlyFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return Object.keys(value).every((field) => fields.includes(field));
}

export function isPdfProgress(value: unknown): value is PdfProgress {
  return object(value) && onlyFields(value, ["page", "scale", "rotation"]) &&
    Number.isSafeInteger(value.page) && (value.page as number) >= 1 && (value.page as number) <= 1_000_000 &&
    finite(value.scale) && value.scale >= 0.1 && value.scale <= 8 &&
    (value.rotation === 0 || value.rotation === 90 || value.rotation === 180 || value.rotation === 270);
}

export function isPdfRect(value: unknown): value is PdfRect {
  return object(value) && onlyFields(value, ["x", "y", "width", "height"]) &&
    finite(value.x) && value.x >= 0 && value.x <= 1 &&
    finite(value.y) && value.y >= 0 && value.y <= 1 &&
    finite(value.width) && value.width > 0 && value.width <= 1 &&
    finite(value.height) && value.height > 0 && value.height <= 1 &&
    value.x + value.width <= 1.000001 && value.y + value.height <= 1.000001;
}

export function isPdfAnnotation(value: unknown): value is PdfAnnotation {
  return object(value) && onlyFields(value, ["id", "type", "page", "rects", "text", "comment", "color", "createdAt"]) &&
    typeof value.id === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(value.id) &&
    (value.type === "highlight" || value.type === "underline" || value.type === "comment") &&
    Number.isSafeInteger(value.page) && (value.page as number) >= 1 && (value.page as number) <= 1_000_000 &&
    Array.isArray(value.rects) && value.rects.length >= 1 && value.rects.length <= 256 && value.rects.every(isPdfRect) &&
    typeof value.text === "string" && value.text.length <= 20_000 &&
    typeof value.comment === "string" && value.comment.length <= 4_000 &&
    typeof value.color === "string" && /^#[a-f0-9]{6}$/iu.test(value.color) &&
    typeof value.createdAt === "string" && value.createdAt.length <= 35 &&
    /^\d{4}-\d{2}-\d{2}T/u.test(value.createdAt) && Number.isFinite(Date.parse(value.createdAt));
}

export function isPdfAnnotations(value: unknown): value is PdfAnnotation[] {
  if (!Array.isArray(value) || value.length > PDF_MAX_ANNOTATIONS || !value.every(isPdfAnnotation)) return false;
  return new Set(value.map((annotation) => annotation.id)).size === value.length;
}
