export const DOCUMENT_IMPORT_EXTENSIONS = [
  ".docx", ".pptx", ".xlsx", ".xls", ".pdf", ".html", ".htm",
  ".txt", ".csv", ".json", ".xml", ".epub",
] as const;
export const DOCUMENT_IMPORT_ACCEPT = DOCUMENT_IMPORT_EXTENSIONS.join(",");
export const DOCUMENT_IMPORT_MAX_BYTES = 50 * 1024 * 1024;
export const DOCUMENT_IMPORT_MAX_MARKDOWN_BYTES = 10 * 1024 * 1024;
export const DOCUMENT_IMPORT_ORIGINAL_PREFIX = "babel-original://";

export interface DocumentConversionResult {
  markdown: string;
  title: string | null;
  warnings: string[];
  sdkVersion: string;
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
