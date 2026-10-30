import {
  HTML_FOLDER_MAX_DEPTH, HTML_FOLDER_NAME_MAX_LENGTH, HTML_MAX_BUNDLE_BYTES, HTML_MAX_DOCUMENT_BYTES,
  HTML_MAX_BUNDLE_FILES, HTML_TITLE_MAX_LENGTH, normalizeHtmlAssetPath,
} from "@babel-apps/platform/html/core";

export interface HtmlImportFile { file: File; path: string; field: string }
export interface HtmlImportEntry { path: string; title: string; folderPath: string[]; error: string }
export interface HtmlImportSelection {
  files: HtmlImportFile[];
  entries: HtmlImportEntry[];
  folder: string;
  size: number;
  error: string;
}

export function htmlTitle(fileName: string): string {
  return fileName.replace(/\.html?$/iu, "").trim().slice(0, HTML_TITLE_MAX_LENGTH) || "Untitled HTML";
}

/** Preserve resource paths inside the bundle; never use them as multipart filenames. */
export function prepareHtmlImport(input: Iterable<File>, directory: boolean): HtmlImportSelection {
  const files: HtmlImportFile[] = [];
  const entries: HtmlImportEntry[] = [];
  const paths = new Set<string>();
  let folder = "Selected folder";
  let size = 0;
  let error = "";
  for (const file of input) {
    const relative = directory && file.webkitRelativePath ? file.webkitRelativePath : file.name;
    if (directory && file.webkitRelativePath) folder = file.webkitRelativePath.split("/")[0];
    const path = normalizeHtmlAssetPath(relative);
    if (path === null) { error ||= "A file has an invalid relative path. Choose another folder or rename the file."; continue; }
    const pathKey = path.toLowerCase();
    if (paths.has(pathKey)) { error ||= "Two files have the same resource path. Choose a folder with unique file paths."; continue; }
    paths.add(pathKey);
    size += file.size;
    files.push({ file, path, field: `file-${files.length}` });
    if (!/\.html?$/iu.test(file.name)) continue;
    const folderPath = directory ? path.split("/").slice(0, -1).map((name) => name.trim().normalize("NFC")) : [];
    const invalidFolder = folderPath.length > HTML_FOLDER_MAX_DEPTH || folderPath.some((name) => !name || name.length > HTML_FOLDER_NAME_MAX_LENGTH || name === "." || name === ".." || /[\\/\p{Cc}]/u.test(name));
    entries.push({ path, title: htmlTitle(file.name), folderPath,
      error: file.size === 0 ? "Choose a nonempty HTML file." : file.size > HTML_MAX_DOCUMENT_BYTES ? "HTML documents must not exceed 64 MiB each." : invalidFolder ? "Folder names must use 1 to 120 characters and no more than 32 levels." : "" });
  }
  if (!entries.length) error ||= "No .html or .htm files were found. Choose an HTML file or a folder containing HTML documents.";
  if (!directory && (files.length !== 1 || entries.length !== 1)) error ||= "Choose one .html or .htm file.";
  if (files.length > HTML_MAX_BUNDLE_FILES) error = "A folder can contain at most 5,000 files, including resources.";
  if (size > HTML_MAX_BUNDLE_BYTES) error = "The selected HTML and resources must not exceed 512 MiB in total.";
  entries.sort((left, right) => left.path.localeCompare(right.path, "en-US", { numeric: true, sensitivity: "base" }));
  return { files, entries, folder, size, error };
}
