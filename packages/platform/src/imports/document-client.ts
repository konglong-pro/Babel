import {
  DOCUMENT_IMPORT_MAX_BYTES,
  DOCUMENT_IMPORT_MAX_MARKDOWN_BYTES,
  DOCUMENT_IMPORT_MAX_CHAPTERS,
  DOCUMENT_IMPORT_ORIGINAL_PREFIX,
  documentImportExtension,
  validDocumentChapters,
  type DocumentChapter,
  type DocumentConversionResult,
  type ImportedOriginalDocument,
} from "./document-core";

const originalUrlPattern = /^\/api\/imports\/documents\/originals\/[a-f0-9]{64}$/u;
const tokenPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;
const encoder = new TextEncoder();

export function validateDocumentImportFile(file: File): void {
  if (!file.name || /[\u0000-\u001f\u007f/\\]/u.test(file.name) || encoder.encode(file.name).byteLength > 240) {
    throw new Error("Choose a file with a name of at most 240 UTF-8 bytes and no slashes or control characters.");
  }
  if (!documentImportExtension(file.name)) {
    throw new Error("Choose a supported Office, PDF, HTML, text, or EPUB file.");
  }
  if (file.size === 0) throw new Error("The selected file is empty.");
  if (file.size > DOCUMENT_IMPORT_MAX_BYTES) {
    throw new Error("The selected file exceeds the 50 MiB import limit.");
  }
}

export async function convertDocumentFile(
  file: File,
  signal?: AbortSignal,
): Promise<DocumentConversionResult> {
  validateDocumentImportFile(file);
  const result = await requestJson("/api/imports/documents", {
    method: "POST",
    headers: uploadHeaders(file),
    body: file,
    signal,
  });
  if (!isRecord(result) || typeof result.markdown !== "string" ||
    !(result.title === null || typeof result.title === "string") ||
    !Array.isArray(result.warnings) || !result.warnings.every(value => typeof value === "string") ||
    typeof result.sdkVersion !== "string") {
    throw new Error("The converter returned an invalid result. Try the import again.");
  }
  assertMarkdownSize(result.markdown);
  if ((result.chapters !== undefined && !validDocumentChapters(result.chapters)) ||
      (result.chapterSource !== undefined && result.chapterSource !== "epub-toc" && result.chapterSource !== "epub-spine")) {
    throw new Error("The converter returned invalid book sections. Try the import again.");
  }
  return result as unknown as DocumentConversionResult;
}

/** Virtual Markdown files enter the existing atomic folder-import review. */
export function prepareDocumentChapterFiles(chapters: readonly DocumentChapter[], bookTitle = "Book chapters"): File[] {
  if (chapters.length === 0 || chapters.length > DOCUMENT_IMPORT_MAX_CHAPTERS) {
    throw new Error("Choose between 1 and 1,000 chapters to import.");
  }
  return chapters.map((chapter, index) => {
    const title = chapter.title.trim();
    if (!title || title.length > 240 || /[\u0000-\u001f\u007f/\\]/u.test(title)) {
      throw new Error(`Enter a valid title for chapter ${index + 1} (1–240 characters, without slashes or control characters).`);
    }
    if (!chapter.markdown.trim()) throw new Error(`Chapter ${index + 1} is empty. Add content or exclude it.`);
    assertMarkdownSize(chapter.markdown);
    const file = new File([chapter.markdown], `${String(index + 1).padStart(4, "0")}.md`, { type: "text/markdown" });
    Object.defineProperty(file, "importTitle", { value: title });
    Object.defineProperty(file, "webkitRelativePath", { value: `${bookTitle.replace(/[\u0000-\u001f\u007f/\\]/gu, " ").trim() || "Book chapters"}/${file.name}` });
    return file;
  });
}

export function prepareDocumentImportDraft(input: {
  file: File;
  markdown: string;
  title: string;
  keepOriginal: boolean;
  token: string;
}): { file: File; original?: ImportedOriginalDocument } {
  const title = input.title.trim();
  if (!title || title.length > 240 || /[\u0000-\u001f\u007f/\\]/u.test(title)) {
    throw new Error("Enter a title of 1–240 characters without slashes or control characters.");
  }
  let markdown = input.markdown;
  let original: ImportedOriginalDocument | undefined;
  if (input.keepOriginal) {
    if (!tokenPattern.test(input.token)) throw new Error("The original file reference is invalid.");
    const name = input.file.name.replace(/[\r\n\u0000-\u001f\u007f]/gu, " ")
      .replace(/[\\[\]]/gu, "\\$&");
    markdown = `${markdown.trimEnd()}\n\n[Original file: ${name}](${DOCUMENT_IMPORT_ORIGINAL_PREFIX}${input.token})\n`;
    original = { file: input.file, token: input.token };
  }
  assertMarkdownSize(markdown);
  return {
    file: new File([markdown], `${title}.md`, { type: "text/markdown" }),
    ...(original ? { original } : {}),
  };
}

/** Upload an opted-in original only when its link is still in the draft. */
export async function saveWithImportedOriginal<T>(
  contentMd: string,
  original: ImportedOriginalDocument | undefined,
  save: (contentMd: string) => Promise<T>,
): Promise<T> {
  if (!original) return save(contentMd);
  if (!tokenPattern.test(original.token)) throw new Error("The original file reference is invalid.");
  const placeholder = `${DOCUMENT_IMPORT_ORIGINAL_PREFIX}${original.token}`;
  const reference = new RegExp(`${placeholder}(?![\\w-])`, "gu");
  if (!reference.test(contentMd)) return save(contentMd);
  // Saved links are longer than the transient reference. Check the final
  // draft size before creating an attachment that cannot fit in the note.
  assertMarkdownSize(contentMd.replace(reference, `/api/imports/documents/originals/${"0".repeat(64)}`));

  if (!original.savedUrl) {
    validateDocumentImportFile(original.file);
    const result = await requestJson("/api/imports/documents/originals", {
      method: "POST",
      headers: uploadHeaders(original.file),
      body: original.file,
    });
    if (!isRecord(result) || typeof result.url !== "string" || !originalUrlPattern.test(result.url)) {
      throw new Error("The server returned an invalid original file location.");
    }
    // Keep the location after a failed save: the server may already have saved
    // the note, and a retry must not leave its attachment link dangling.
    original.savedUrl = result.url;
  }
  if (!originalUrlPattern.test(original.savedUrl)) {
    throw new Error("The original file location is invalid.");
  }
  const resolvedContent = contentMd.replace(reference, original.savedUrl);
  assertMarkdownSize(resolvedContent);
  return save(resolvedContent);
}

function assertMarkdownSize(markdown: string): void {
  if (encoder.encode(markdown).byteLength > DOCUMENT_IMPORT_MAX_MARKDOWN_BYTES) {
    throw new Error("The Markdown draft exceeds the 10 MiB note limit.");
  }
}

function uploadHeaders(file: File): HeadersInit {
  return {
    "Content-Type": "application/octet-stream",
    "X-Babel-File-Name": encodeURIComponent(file.name),
  };
}

async function requestJson(url: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = isRecord(result) && isRecord(result.error) && typeof result.error.message === "string"
      ? result.error.message
      : `The import request failed (${response.status}).`;
    throw new Error(message);
  }
  if (result === null) throw new Error("The import response could not be read.");
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
