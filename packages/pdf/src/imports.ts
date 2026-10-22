import { PDF_FOLDER_MAX_DEPTH, PDF_FOLDER_NAME_MAX_LENGTH, PDF_MAX_FILE_BYTES, PDF_TITLE_MAX_LENGTH } from "@babel-apps/platform/pdf/core";

export interface FolderPdf {
  file: File;
  label: string;
  title: string;
  folderPath: string[];
  error: string;
}

export function pdfImportError(file: Pick<File, "size">): string {
  if (file.size === 0) return "Choose a nonempty PDF file.";
  if (file.size > PDF_MAX_FILE_BYTES) return "PDF files must not exceed 512 MiB.";
  return "";
}

/** Paths become library folders, never filesystem paths or multipart filenames. */
export function preparePdfFolder(files: Iterable<File>): { files: FolderPdf[]; skipped: number; folder: string } {
  const pdfs: FolderPdf[] = [];
  let skipped = 0;
  let folder = "Selected folder";
  for (const file of files) {
    const label = file.webkitRelativePath || file.name;
    if (file.webkitRelativePath) folder = file.webkitRelativePath.split("/")[0];
    if (!/\.pdf$/iu.test(file.name)) { skipped += 1; continue; }
    const folderPath = file.webkitRelativePath ? file.webkitRelativePath.split("/").slice(0, -1).map((name) => name.trim().normalize("NFC")) : [];
    const invalidPath = folderPath.length > PDF_FOLDER_MAX_DEPTH || folderPath.some((name) => !name || name.length > PDF_FOLDER_NAME_MAX_LENGTH || name === "." || name === ".." || /[\\/\p{Cc}]/u.test(name));
    pdfs.push({
      file, label,
      title: file.name.replace(/\.pdf$/iu, "").trim().slice(0, PDF_TITLE_MAX_LENGTH) || "Untitled PDF",
      folderPath,
      error: pdfImportError(file) || (invalidPath ? "Folder paths must use valid names up to 120 characters and no more than 32 levels." : ""),
    });
  }
  pdfs.sort((left, right) => left.label.localeCompare(right.label, "en-US", { numeric: true, sensitivity: "base" }));
  return { files: pdfs, skipped, folder };
}
