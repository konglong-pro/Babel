export const DOCUMENT_IMPORT_EXTENSIONS = [
  ".docx", ".pptx", ".xlsx", ".xls", ".pdf", ".html", ".htm",
  ".txt", ".csv", ".json", ".xml", ".epub",
] as const;
export const DOCUMENT_IMPORT_ACCEPT = DOCUMENT_IMPORT_EXTENSIONS.join(",");
export const DOCUMENT_IMPORT_MAX_BYTES = 50 * 1024 * 1024;
export const DOCUMENT_IMPORT_MAX_MARKDOWN_BYTES = 10 * 1024 * 1024;
export const DOCUMENT_IMPORT_ORIGINAL_PREFIX = "babel-original://";
export const DOCUMENT_IMPORT_MAX_CHAPTERS = 1_000;

export interface DocumentChapter {
  title: string;
  markdown: string;
}

export interface DocumentConversionResult {
  markdown: string;
  title: string | null;
  warnings: string[];
  sdkVersion: string;
  chapters?: DocumentChapter[];
  chapterSource?: "epub-toc" | "epub-spine";
}

/** The browser retains the source until the imported draft is actually saved. */
export interface ImportedOriginalDocument {
  file: File;
  token: string;
  savedUrl?: string;
}

export function documentImportExtension(fileName: string): string | undefined {
  const extension = /\.[^.]+$/u.exec(fileName)?.[0].toLowerCase();
  return DOCUMENT_IMPORT_EXTENSIONS.find((allowed) => allowed === extension);
}

export function validDocumentChapters(value: unknown): value is DocumentChapter[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > DOCUMENT_IMPORT_MAX_CHAPTERS) return false;
  let size = 0;
  const encoder = new TextEncoder();
  return value.every((chapter: unknown) => {
    if (typeof chapter !== "object" || chapter === null) return false;
    const record = chapter as Record<string, unknown>;
    if (typeof record.title !== "string" || record.title.length > 500 || !record.title.trim() ||
        typeof record.markdown !== "string" || !record.markdown.trim()) return false;
    size += encoder.encode(record.markdown).byteLength;
    return size <= DOCUMENT_IMPORT_MAX_MARKDOWN_BYTES;
  });
}

export type DocumentHeadingLevel = "auto" | 1 | 2 | 3 | 4 | 5 | 6;

/** Recognize ATX/setext headings while leaving code examples intact. */
export function splitDocumentChapters(
  markdown: string,
  bookTitle: string,
  level: DocumentHeadingLevel = "auto",
): DocumentChapter[] {
  const headings: Array<{ title: string; level: number; offset: number }> = [];
  const lines = [...markdown.matchAll(/[^\n]*(?:\n|$)/gu)].filter((line) => line[0]);
  let fence: { character: string; length: number } | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index][0].replace(/\r?\n$/u, "");
    const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    if (delimiter) {
      if (!fence && !(delimiter[1][0] === "`" && delimiter[2].includes("`"))) {
        fence = { character: delimiter[1][0], length: delimiter[1].length };
      } else if (fence && delimiter[1][0] === fence.character && delimiter[1].length >= fence.length && !delimiter[2].trim()) {
        fence = null;
      }
      continue;
    }
    if (fence || /^(?: {4}|\t)/u.test(line)) continue;
    const atx = /^ {0,3}(#{1,6})[\t ]+(.+?)\s*$/u.exec(line);
    if (atx) {
      headings.push({ level: atx[1].length, title: headingTitle(atx[2].replace(/[\t ]+#+$/u, "")), offset: lines[index].index });
    } else if (line.trim() && index + 1 < lines.length) {
      const underline = /^ {0,3}(=+|-+)[\t ]*(?:\r?\n)?$/u.exec(lines[index + 1][0]);
      if (underline && !/^\s*(?:[-*+]|\d+[.)])\s/u.test(line)) {
        headings.push({ level: underline[1][0] === "=" ? 1 : 2, title: headingTitle(line), offset: lines[index].index });
        index += 1;
      }
    }
  }
  let boundaries = headings.filter((heading) => heading.level === level);
  if (level === "auto") {
    const explicit = headings.filter((heading) => /^(?:(?:chapter|part|book)\s+\S|第[^\s]{1,16}[章篇部卷节])/iu.test(heading.title));
    const detectedLevel = [1, 2, 3, 4, 5, 6].find((candidate) => headings.filter((heading) => heading.level === candidate).length >= 2);
    boundaries = explicit.length >= 2 ? explicit : headings.filter((heading) => heading.level === detectedLevel);
  }
  if (boundaries.length === 0) return [{ title: bookTitle, markdown }];
  const chapters: DocumentChapter[] = [];
  const prefix = markdown.slice(0, boundaries[0].offset);
  if (prefix.trim()) chapters.push({ title: `${bookTitle} — Introduction`, markdown: prefix });
  boundaries.forEach((heading, index) => {
    chapters.push({ title: heading.title || bookTitle, markdown: markdown.slice(heading.offset, boundaries[index + 1]?.offset) });
  });
  return chapters;
}

function headingTitle(value: string): string {
  return value.replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1").replace(/[*_`]/gu, "").trim();
}
