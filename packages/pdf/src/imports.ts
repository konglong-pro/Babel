import { PDF_MAX_FILE_BYTES, PDF_TITLE_MAX_LENGTH } from "@babel-apps/platform/pdf/core";

export interface FolderPdf {
  file: File;
  label: string;
  title: string;
  error: string;
}

export function pdfImportError(file: Pick<File, "size">): string {
  if (file.size === 0) return "Choose a nonempty PDF file.";
  if (file.size > PDF_MAX_FILE_BYTES) return "PDF files must not exceed 512 MiB.";
  return "";
}

/** Directory paths are display labels only; uploads always use each File's name. */
export function preparePdfFolder(files: Iterable<File>): { files: FolderPdf[]; skipped: number; folder: string } {
  const pdfs: FolderPdf[] = [];
  let skipped = 0;
  let folder = "Selected folder";
  for (const file of files) {
    const label = file.webkitRelativePath || file.name;
    if (file.webkitRelativePath) folder = file.webkitRelativePath.split("/")[0];
    if (!/\.pdf$/iu.test(file.name)) { skipped += 1; continue; }
    pdfs.push({
      file, label,
      title: file.name.replace(/\.pdf$/iu, "").trim().slice(0, PDF_TITLE_MAX_LENGTH) || "Untitled PDF",
      error: pdfImportError(file),
    });
  }
  pdfs.sort((left, right) => left.label.localeCompare(right.label, "en-US", { numeric: true, sensitivity: "base" }));
  return { files: pdfs, skipped, folder };
}
