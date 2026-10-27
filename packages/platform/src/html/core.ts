export interface HtmlProgress { position: number; scale: number }

export interface HtmlAnnotation {
  id: string;
  type: "highlight" | "underline" | "comment";
  text: string;
  prefix: string;
  suffix: string;
  occurrence: number;
  comment: string;
  color: string;
  createdAt: string;
}

export interface HtmlFolder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HtmlBundleFile { path: string; size: number; mimeType: string }
export interface HtmlBundle { id: string; files: HtmlBundleFile[]; size: number; importedAt: string }

export interface HtmlDocumentSummary {
  id: string;
  title: string;
  fileName: string;
  entryPath: string;
  bundleId: string;
  folderId: string | null;
  size: number;
  importedAt: string;
  updatedAt: string;
  progress: HtmlProgress;
  progressRevision: number;
  annotationsRevision: number;
}
export interface HtmlDocument extends HtmlDocumentSummary { annotations: HtmlAnnotation[]; bundle: HtmlBundle }

export const HTML_MAX_BUNDLE_BYTES = 512 * 1024 * 1024;
export const HTML_MAX_DOCUMENT_BYTES = 64 * 1024 * 1024;
export const HTML_MAX_BUNDLE_FILES = 5_000;
export const HTML_MAX_ANNOTATIONS = 10_000;
export const HTML_FOLDER_NAME_MAX_LENGTH = 120;
export const HTML_FOLDER_MAX_DEPTH = 32;
export const HTML_TITLE_MAX_LENGTH = 240;
export const HTML_DEFAULT_PROGRESS: Readonly<HtmlProgress> = { position: 0, scale: 1 };

export function htmlFolderNameKey(name: string): string { return name.trim().normalize("NFC").toLowerCase(); }

/** Logical names only: stored resources use server-assigned numeric filenames. */
export function normalizeHtmlAssetPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 1 || value.length > 1_024 || /[\\\u0000-\u001f\u007f-\u009f]/u.test(value)) return null;
  const name = value.normalize("NFC");
  const parts = name.split("/");
  if (parts.length > 64 || parts.some((part) => !part || part === "." || part === ".." || part.includes(":"))) return null;
  return name;
}

function object(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function only(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).every((key) => keys.includes(key)); }
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }

export function isHtmlProgress(value: unknown): value is HtmlProgress {
  return object(value) && only(value, ["position", "scale"]) && finite(value.position) && value.position >= 0 && value.position <= 1 &&
    finite(value.scale) && value.scale >= 0.1 && value.scale <= 8;
}

export function isHtmlAnnotation(value: unknown): value is HtmlAnnotation {
  return object(value) && only(value, ["id", "type", "text", "prefix", "suffix", "occurrence", "comment", "color", "createdAt"]) &&
    typeof value.id === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(value.id) &&
    (value.type === "highlight" || value.type === "underline" || value.type === "comment") &&
    typeof value.text === "string" && value.text.length > 0 && value.text.length <= 20_000 &&
    typeof value.prefix === "string" && value.prefix.length <= 256 && typeof value.suffix === "string" && value.suffix.length <= 256 &&
    Number.isSafeInteger(value.occurrence) && (value.occurrence as number) >= 0 && (value.occurrence as number) <= 1_000_000 &&
    typeof value.comment === "string" && value.comment.length <= 4_000 && typeof value.color === "string" && /^#[a-f0-9]{6}$/iu.test(value.color) &&
    typeof value.createdAt === "string" && value.createdAt.length <= 35 && /^\d{4}-\d{2}-\d{2}T/u.test(value.createdAt) && Number.isFinite(Date.parse(value.createdAt));
}

export function isHtmlAnnotations(value: unknown): value is HtmlAnnotation[] {
  return Array.isArray(value) && value.length <= HTML_MAX_ANNOTATIONS && value.every(isHtmlAnnotation) &&
    new Set(value.map((annotation) => annotation.id)).size === value.length;
}
