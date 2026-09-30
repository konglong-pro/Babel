export const MARKDOWN_FOLDER_MAX_FILES = 1_000;
export const MARKDOWN_FOLDER_MAX_MARKDOWN_BYTES = 250 * 1024 * 1024;
export const MARKDOWN_FOLDER_MAX_IMAGE_BYTES = 1024 * 1024 * 1024;
export const MARKDOWN_FOLDER_MAX_NOTE_BYTES = 10 * 1024 * 1024;
export const MARKDOWN_FOLDER_MAX_NOTE_IMAGES = 50;
export const MARKDOWN_FOLDER_MAX_NOTE_TOTAL_BYTES = 100 * 1024 * 1024;
export const MARKDOWN_FOLDER_MAX_IMAGE_FILE_BYTES = 10 * 1024 * 1024;

const markdownExtension = /\.md$/iu;
const imageExtension = /\.(?:png|jpe?g|webp|gif)$/iu;
const schemePattern = /^[A-Za-z][A-Za-z0-9+.-]*:/u;
const windowsDrivePattern = /^[A-Za-z]:[\\/]/u;

export type FolderImportIssueCode =
  | "AMBIGUOUS_LINK"
  | "DUPLICATE_PATH"
  | "FILE_TOO_LARGE"
  | "IMAGE_NOT_FOUND"
  | "INVALID_FILE_TYPE"
  | "INVALID_PATH"
  | "INVALID_UTF8"
  | "NO_MARKDOWN"
  | "TOO_MANY_FILES"
  | "TOO_MANY_IMAGES"
  | "TOTAL_TOO_LARGE";

export interface FolderImportIssue {
  code: FolderImportIssueCode;
  message: string;
  sourcePath: string | null;
  blocking: boolean;
}

export interface FolderImportFileLike {
  readonly name: string;
  readonly size: number;
  readonly type: string;
  readonly webkitRelativePath?: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface MarkdownFolderSource {
  path: string;
  contentMd: string;
  size: number;
}

export interface MarkdownFolderAvailableFile {
  path: string;
  size: number;
  type?: string;
}

export interface MarkdownFolderLinkIssue {
  id: string;
  sourcePath: string;
  target: string;
  candidateSourcePaths: string[];
}

export interface MarkdownFolderNoteAnalysis {
  sourcePath: string;
  sourceDirectory: string;
  fileName: string;
  defaultTitle: string;
  contentMd: string;
  size: number;
  imagePaths: string[];
  linkCount: number;
  linkIssues: MarkdownFolderLinkIssue[];
  issues: FolderImportIssue[];
}

export interface MarkdownFolderAssetAnalysis {
  path: string;
  size: number;
  type: string;
}

export interface MarkdownFolderAnalysis {
  notes: MarkdownFolderNoteAnalysis[];
  assets: MarkdownFolderAssetAnalysis[];
  issues: FolderImportIssue[];
  totalMarkdownBytes: number;
  totalImageBytes: number;
}

export interface MarkdownFolderBrowserUpload {
  path: string;
  kind: "markdown" | "image";
  file: FolderImportFileLike;
}

export interface MarkdownFolderBrowserPreflight extends MarkdownFolderAnalysis {
  rootName: string;
  uploads: MarkdownFolderBrowserUpload[];
}

export type MarkdownFolderLinkDecision = string | "preserve";

export type MarkdownFolderTarget =
  | { kind: "existing"; folderId: number }
  | { kind: "mapped"; path: string };

export type MarkdownFolderParent =
  | { kind: "existing"; id: number }
  | { kind: "batch"; sourcePath: string }
  | null;

export interface MarkdownFolderReviewRecord {
  sourcePath: string;
  title: string;
  folder: MarkdownFolderTarget;
  parent: MarkdownFolderParent;
  tags: string[];
  linkDecisions: Record<string, MarkdownFolderLinkDecision>;
}

export interface MarkdownFolderCommitManifest {
  baseFolderId: number;
  records: MarkdownFolderReviewRecord[];
}

export interface MarkdownFolderImportedItem {
  sourcePath: string;
  id: number;
  folderId: number;
  title: string;
}

export interface MarkdownFolderCommitResult {
  imported: MarkdownFolderImportedItem[];
  createdFolderCount: number;
}

export interface RenderMarkdownFolderInput {
  sourcePath: string;
  contentMd: string;
  titlesBySourcePath: ReadonlyMap<string, string>;
  linkDecisions?: Readonly<Record<string, MarkdownFolderLinkDecision>>;
  uploadPlaceholderPrefix: string;
}

export interface RenderedMarkdownFolderNote {
  contentMd: string;
  images: Array<{ path: string; token: string }>;
}

interface DestinationSpan {
  destination: string;
  start: number;
  end: number;
  closingEnd: number;
}

interface MarkdownLinkSpan {
  start: number;
  end: number;
  label: string;
  destination: string;
  image: boolean;
  destinationStart: number;
  destinationEnd: number;
}

interface WikilinkSpan {
  start: number;
  end: number;
  target: string;
  alias: string | null;
  occurrence: number;
}

interface MarkdownScan {
  links: MarkdownLinkSpan[];
  wikilinks: WikilinkSpan[];
}

interface Replacement {
  start: number;
  end: number;
  value: string;
}

export class MarkdownFolderImportError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly status = 400,
  ) {
    super(message);
    this.name = "MarkdownFolderImportError";
  }
}

export async function preflightMarkdownFolder(
  selectedFiles: readonly FolderImportFileLike[],
): Promise<MarkdownFolderBrowserPreflight> {
  const located = locateBrowserFiles(selectedFiles);
  const markdownFiles = located.files
    .filter(({ path }) => markdownExtension.test(path))
    .sort((left, right) => left.path.localeCompare(right.path, "en-US"));
  const declaredMarkdownBytes = markdownFiles.reduce((sum, { file }) => sum + file.size, 0);
  const limitIssues: FolderImportIssue[] = [];
  if (markdownFiles.length > MARKDOWN_FOLDER_MAX_FILES) {
    limitIssues.push(issue(
      "TOO_MANY_FILES",
      `A folder import can contain at most ${MARKDOWN_FOLDER_MAX_FILES} Markdown files.`,
    ));
  }
  if (declaredMarkdownBytes > MARKDOWN_FOLDER_MAX_MARKDOWN_BYTES) {
    limitIssues.push(issue(
      "TOTAL_TOO_LARGE",
      "Markdown files exceed the 250 MiB folder-import limit.",
    ));
  }
  if (limitIssues.length > 0) {
    return {
      rootName: located.rootName,
      notes: markdownFiles.map(({ path, file }) => browserNotePlaceholder(
        path,
        file.size,
        file.size > MARKDOWN_FOLDER_MAX_NOTE_BYTES
          ? [issue("FILE_TOO_LARGE", `${path} exceeds the 10 MiB per-note limit.`, path)]
          : [],
      )),
      assets: [],
      uploads: [],
      issues: [...located.issues, ...limitIssues],
      totalMarkdownBytes: declaredMarkdownBytes,
      totalImageBytes: 0,
    };
  }

  const sources: MarkdownFolderSource[] = [];
  const failedNotes: MarkdownFolderNoteAnalysis[] = [];
  const readIssues: FolderImportIssue[] = [...located.issues];

  for (const entry of markdownFiles) {
    if (entry.file.size > MARKDOWN_FOLDER_MAX_NOTE_BYTES) {
      failedNotes.push(browserNotePlaceholder(entry.path, entry.file.size, [issue(
        "FILE_TOO_LARGE",
        `${entry.path} exceeds the 10 MiB per-note limit.`,
        entry.path,
      )]));
      continue;
    }
    try {
      const bytes = new Uint8Array(await entry.file.arrayBuffer());
      let contentMd = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (contentMd.startsWith("\uFEFF")) contentMd = contentMd.slice(1);
      sources.push({ path: entry.path, contentMd, size: bytes.byteLength });
    } catch {
      failedNotes.push(browserNotePlaceholder(entry.path, entry.file.size, [issue(
        "INVALID_UTF8",
        `${entry.path} is not valid UTF-8 Markdown.`,
        entry.path,
      )]));
    }
  }

  const analysis = analyzeMarkdownFolder(
    sources,
    located.files.map(({ path, file }) => ({
      path,
      size: file.size,
      type: file.type,
    })),
  );
  const filesByKey = uniquePathMap(located.files, readIssues);
  const uploads: MarkdownFolderBrowserUpload[] = [];
  for (const note of analysis.notes) {
    const entry = filesByKey.get(pathKey(note.sourcePath));
    if (entry) uploads.push({ path: note.sourcePath, kind: "markdown", file: entry.file });
  }
  for (const asset of analysis.assets) {
    const entry = filesByKey.get(pathKey(asset.path));
    if (entry) uploads.push({ path: asset.path, kind: "image", file: entry.file });
  }

  return {
    ...analysis,
    rootName: located.rootName,
    notes: [...analysis.notes, ...failedNotes]
      .sort((left, right) => left.sourcePath.localeCompare(right.sourcePath, "en-US")),
    uploads,
    issues: [
      ...readIssues,
      ...analysis.issues.filter(({ code }) => code !== "NO_MARKDOWN" || markdownFiles.length === 0),
    ],
    totalMarkdownBytes: declaredMarkdownBytes,
  };
}

export function analyzeMarkdownFolder(
  sources: readonly MarkdownFolderSource[],
  availableFiles: readonly MarkdownFolderAvailableFile[],
): MarkdownFolderAnalysis {
  const globalIssues: FolderImportIssue[] = [];
  if (sources.length === 0) {
    globalIssues.push(issue("NO_MARKDOWN", "The selected folder contains no Markdown files."));
  }
  if (sources.length > MARKDOWN_FOLDER_MAX_FILES) {
    globalIssues.push(issue(
      "TOO_MANY_FILES",
      `A folder import can contain at most ${MARKDOWN_FOLDER_MAX_FILES} Markdown files.`,
    ));
  }

  const normalizedSources = normalizeSources(sources, globalIssues);
  const sourceByKey = uniquePathMap(normalizedSources, globalIssues);
  const uniqueSources = [...sourceByKey.values()];
  const availableByKey = uniquePathMap(
    availableFiles.flatMap((file) => {
      try {
        return [{ ...file, path: normalizeSelectedPath(file.path) }];
      } catch {
        globalIssues.push(issue("INVALID_PATH", `The selected path “${file.path}” is invalid.`));
        return [];
      }
    }),
    globalIssues,
  );
  const sourceStemCandidates = new Map<string, string[]>();
  for (const source of uniqueSources) {
    const stem = source.path.replace(/^.*\//u, "").replace(markdownExtension, "");
    const key = titleKey(stem);
    sourceStemCandidates.set(key, [...(sourceStemCandidates.get(key) ?? []), source.path]);
  }

  const referencedAssets = new Map<string, MarkdownFolderAssetAnalysis>();
  const notes: MarkdownFolderNoteAnalysis[] = uniqueSources.map((source) => {
    const itemIssues: FolderImportIssue[] = [];
    const scan = scanMarkdown(source.contentMd);
    const imagePaths = new Set<string>();

    for (const link of scan.links.filter(({ image }) => image)) {
      const destination = cleanDestination(link.destination);
      if (isNonLocalDestination(destination)) continue;
      const resolved = resolveRelativePath(source.path, destination);
      if (resolved === null) {
        itemIssues.push(issue(
          "INVALID_PATH",
          `Image “${destination}” resolves outside the selected folder.`,
          source.path,
        ));
        continue;
      }
      const candidate = availableByKey.get(pathKey(resolved));
      if (!candidate) {
        itemIssues.push(issue(
          "IMAGE_NOT_FOUND",
          `Referenced image “${destination}” was not found in the selected folder.`,
          source.path,
        ));
        continue;
      }
      if (!imageExtension.test(candidate.path)) {
        itemIssues.push(issue(
          "INVALID_FILE_TYPE",
          `Referenced local image “${destination}” must be PNG, JPEG, WebP, or GIF.`,
          source.path,
        ));
        continue;
      }
      if (candidate.size > MARKDOWN_FOLDER_MAX_IMAGE_FILE_BYTES) {
        itemIssues.push(issue(
          "FILE_TOO_LARGE",
          `Image ${candidate.path} exceeds the 10 MiB per-image limit.`,
          source.path,
        ));
        continue;
      }
      imagePaths.add(candidate.path);
      referencedAssets.set(pathKey(candidate.path), {
        path: candidate.path,
        size: candidate.size,
        type: candidate.type ?? imageMimeType(candidate.path),
      });
    }

    if (imagePaths.size > MARKDOWN_FOLDER_MAX_NOTE_IMAGES) {
      itemIssues.push(issue(
        "TOO_MANY_IMAGES",
        `${source.path} references more than ${MARKDOWN_FOLDER_MAX_NOTE_IMAGES} images.`,
        source.path,
      ));
    }
    const logicalBytes = source.size + [...imagePaths].reduce((sum, imagePath) => {
      return sum + (availableByKey.get(pathKey(imagePath))?.size ?? 0);
    }, 0);
    if (logicalBytes > MARKDOWN_FOLDER_MAX_NOTE_TOTAL_BYTES) {
      itemIssues.push(issue(
        "TOTAL_TOO_LARGE",
        `${source.path} and its images exceed the 100 MiB per-note limit.`,
        source.path,
      ));
    }

    const linkIssues: MarkdownFolderLinkIssue[] = [];
    for (const wikilink of scan.wikilinks) {
      const candidates = wikilinkCandidates(
        source.path,
        wikilink.target,
        sourceByKey,
        sourceStemCandidates,
      );
      if (candidates.length > 1) {
        const linkIssue: MarkdownFolderLinkIssue = {
          id: ambiguousLinkId(source.path, wikilink.occurrence),
          sourcePath: source.path,
          target: wikilink.target,
          candidateSourcePaths: candidates,
        };
        linkIssues.push(linkIssue);
        itemIssues.push({
          code: "AMBIGUOUS_LINK",
          message: `Wikilink “${wikilink.target}” matches multiple files and needs a decision.`,
          sourcePath: source.path,
          blocking: false,
        });
      }
    }

    return {
      sourcePath: source.path,
      sourceDirectory: source.path.includes("/")
        ? source.path.slice(0, source.path.lastIndexOf("/"))
        : "",
      fileName: source.path.replace(/^.*\//u, ""),
      defaultTitle: source.path.replace(/^.*\//u, "").replace(markdownExtension, ""),
      contentMd: source.contentMd,
      size: source.size,
      imagePaths: [...imagePaths].sort((left, right) => left.localeCompare(right, "en-US")),
      linkCount: scan.links.filter(({ image }) => !image).length + scan.wikilinks.length,
      linkIssues,
      issues: itemIssues,
    };
  });

  const totalMarkdownBytes = uniqueSources.reduce((sum, source) => sum + source.size, 0);
  const assets = [...referencedAssets.values()]
    .sort((left, right) => left.path.localeCompare(right.path, "en-US"));
  const totalImageBytes = assets.reduce((sum, asset) => sum + asset.size, 0);
  if (totalMarkdownBytes > MARKDOWN_FOLDER_MAX_MARKDOWN_BYTES) {
    globalIssues.push(issue(
      "TOTAL_TOO_LARGE",
      "Markdown files exceed the 250 MiB folder-import limit.",
    ));
  }
  if (totalImageBytes > MARKDOWN_FOLDER_MAX_IMAGE_BYTES) {
    globalIssues.push(issue(
      "TOTAL_TOO_LARGE",
      "Referenced images exceed the 1 GiB folder-import limit.",
    ));
  }

  return {
    notes,
    assets,
    issues: globalIssues,
    totalMarkdownBytes,
    totalImageBytes,
  };
}

export function renderMarkdownFolderNote(
  input: RenderMarkdownFolderInput,
): RenderedMarkdownFolderNote {
  const sourcePath = normalizeSelectedPath(input.sourcePath);
  const sources = new Map<string, { path: string }>();
  const stemCandidates = new Map<string, string[]>();
  for (const path of input.titlesBySourcePath.keys()) {
    const normalized = normalizeSelectedPath(path);
    sources.set(pathKey(normalized), { path: normalized });
    const stem = normalized.replace(/^.*\//u, "").replace(markdownExtension, "");
    const key = titleKey(stem);
    stemCandidates.set(key, [...(stemCandidates.get(key) ?? []), normalized]);
  }

  const scan = scanMarkdown(input.contentMd);
  const replacements: Replacement[] = [];
  const imagePaths = new Map<string, { path: string; token: string }>();
  for (const link of scan.links) {
    const destination = cleanDestination(link.destination);
    if (isNonLocalDestination(destination)) continue;
    const resolved = resolveRelativePath(sourcePath, destination);
    if (resolved === null) {
      if (link.image) {
        throw new MarkdownFolderImportError(
          "INVALID_PATH",
          `Image “${destination}” resolves outside the selected folder.`,
          { sourcePath, destination },
        );
      }
      continue;
    }
    if (link.image) {
      const token = stableToken(`${sourcePath}\0${resolved}`);
      imagePaths.set(pathKey(resolved), { path: resolved, token });
      replacements.push({
        start: link.destinationStart,
        end: link.destinationEnd,
        value: `${input.uploadPlaceholderPrefix}${token}`,
      });
      continue;
    }
    if (!markdownExtension.test(resolved)) continue;
    const target = sources.get(pathKey(resolved));
    if (!target) continue;
    const title = requiredReviewedTitle(input.titlesBySourcePath, target.path);
    replacements.push({
      start: link.start,
      end: link.end,
      value: wikilink(title, link.label),
    });
  }

  for (const match of scan.wikilinks) {
    const candidates = wikilinkCandidates(sourcePath, match.target, sources, stemCandidates);
    let targetPath: string | null = null;
    if (candidates.length === 1) {
      targetPath = candidates[0];
    } else if (candidates.length > 1) {
      const decision = input.linkDecisions?.[ambiguousLinkId(sourcePath, match.occurrence)];
      if (decision === "preserve") continue;
      if (!decision || !candidates.includes(decision)) {
        throw new MarkdownFolderImportError(
          "AMBIGUOUS_LINK",
          `Wikilink “${match.target}” needs an explicit target or preserve decision.`,
          { sourcePath, target: match.target, candidates },
        );
      }
      targetPath = decision;
    }
    if (targetPath === null) continue;
    const title = requiredReviewedTitle(input.titlesBySourcePath, targetPath);
    replacements.push({
      start: match.start,
      end: match.end,
      value: wikilink(title, match.alias),
    });
  }

  const replacementsBySpan = new Map<string, Replacement>();
  for (const replacement of replacements) {
    const key = `${replacement.start}:${replacement.end}`;
    const existing = replacementsBySpan.get(key);
    if (existing && existing.value !== replacement.value) {
      throw new MarkdownFolderImportError(
        "INVALID_CONTENT",
        "Overlapping Markdown import rewrites disagree.",
        { sourcePath },
      );
    }
    replacementsBySpan.set(key, replacement);
  }
  let contentMd = input.contentMd;
  for (const replacement of [...replacementsBySpan.values()].sort((a, b) => b.start - a.start)) {
    contentMd = `${contentMd.slice(0, replacement.start)}${replacement.value}${contentMd.slice(replacement.end)}`;
  }
  return { contentMd, images: [...imagePaths.values()] };
}

export function normalizeFolderImportTitle(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase();
}

export function normalizeFolderImportRelativePath(value: string): string {
  return normalizeSelectedPath(value);
}

export function folderImportPathKey(value: string): string {
  return pathKey(normalizeSelectedPath(value));
}

export function folderImportAmbiguousLinkId(sourcePath: string, occurrence: number): string {
  return ambiguousLinkId(normalizeSelectedPath(sourcePath), occurrence);
}

function locateBrowserFiles(files: readonly FolderImportFileLike[]): {
  rootName: string;
  files: Array<{ path: string; file: FolderImportFileLike }>;
  issues: FolderImportIssue[];
} {
  const rawPaths = files.map((file) => (file.webkitRelativePath || file.name).replaceAll("\\", "/"));
  const split = rawPaths.map((value) => value.split("/").filter(Boolean));
  const rootName = split.length > 0 && split.every((parts) => parts.length > 1 && parts[0] === split[0][0])
    ? split[0][0]
    : "Selected folder";
  const stripRoot = rootName !== "Selected folder";
  const issues: FolderImportIssue[] = [];
  const located = files.flatMap((file, index) => {
    const raw = stripRoot ? split[index].slice(1).join("/") : rawPaths[index];
    try {
      return [{ path: normalizeSelectedPath(raw), file }];
    } catch {
      issues.push(issue("INVALID_PATH", `The selected path “${rawPaths[index]}” is invalid.`));
      return [];
    }
  });
  return { rootName, files: [...uniquePathMap(located, issues).values()], issues };
}

function browserNotePlaceholder(
  sourcePath: string,
  size: number,
  issues: FolderImportIssue[] = [],
): MarkdownFolderNoteAnalysis {
  return {
    sourcePath,
    sourceDirectory: sourcePath.includes("/")
      ? sourcePath.slice(0, sourcePath.lastIndexOf("/"))
      : "",
    fileName: sourcePath.replace(/^.*\//u, ""),
    defaultTitle: sourcePath.replace(/^.*\//u, "").replace(markdownExtension, ""),
    contentMd: "",
    size,
    imagePaths: [],
    linkCount: 0,
    linkIssues: [],
    issues,
  };
}

function normalizeSources(
  sources: readonly MarkdownFolderSource[],
  issues: FolderImportIssue[],
): MarkdownFolderSource[] {
  return sources.flatMap((source) => {
    try {
      const path = normalizeSelectedPath(source.path);
      if (!markdownExtension.test(path)) {
        issues.push(issue("INVALID_FILE_TYPE", `${path} is not a Markdown file.`, path));
        return [];
      }
      if (!Number.isSafeInteger(source.size) || source.size < 0) {
        issues.push(issue("FILE_TOO_LARGE", `${path} has an invalid file size.`, path));
        return [];
      }
      if (source.size > MARKDOWN_FOLDER_MAX_NOTE_BYTES) {
        issues.push(issue("FILE_TOO_LARGE", `${path} exceeds the 10 MiB per-note limit.`, path));
      }
      return [{ ...source, path }];
    } catch {
      issues.push(issue("INVALID_PATH", `The selected path “${source.path}” is invalid.`));
      return [];
    }
  });
}

function uniquePathMap<T extends { path: string }>(
  values: readonly T[],
  issues: FolderImportIssue[],
): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const key = pathKey(value.path);
    if (result.has(key)) {
      issues.push(issue(
        "DUPLICATE_PATH",
        `The selected folder contains duplicate normalized path “${value.path}”.`,
        value.path,
      ));
      continue;
    }
    result.set(key, value);
  }
  return result;
}

function normalizeSelectedPath(value: string): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.includes("\0") ||
    value.startsWith("/") ||
    value.startsWith("\\") ||
    windowsDrivePattern.test(value)
  ) throw new Error("Invalid relative path.");
  const segments = value.replaceAll("\\", "/").split("/");
  if (segments.some((segment) => segment === "..")) throw new Error("Invalid relative path.");
  const normalized = segments.filter((segment) => segment && segment !== ".").join("/");
  if (!normalized) throw new Error("Invalid relative path.");
  return normalized.normalize("NFC");
}

function pathKey(value: string): string {
  return value.normalize("NFC").toLowerCase();
}

function titleKey(value: string): string {
  return normalizeFolderImportTitle(value);
}

function resolveRelativePath(sourcePath: string, rawDestination: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawDestination);
  } catch {
    return null;
  }
  const pathOnly = decoded.split(/[?#]/u, 1)[0].replaceAll("\\", "/");
  if (
    !pathOnly ||
    pathOnly.includes("\0") ||
    pathOnly.startsWith("/") ||
    windowsDrivePattern.test(pathOnly) ||
    schemePattern.test(pathOnly)
  ) return null;
  const base = sourcePath.includes("/")
    ? sourcePath.slice(0, sourcePath.lastIndexOf("/")).split("/")
    : [];
  for (const segment of pathOnly.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (base.length === 0) return null;
      base.pop();
    } else {
      base.push(segment);
    }
  }
  return base.length > 0 ? base.join("/").normalize("NFC") : null;
}

function cleanDestination(value: string): string {
  return value.trim().replace(/^<|>$/gu, "").replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/gu, "$1");
}

function isNonLocalDestination(value: string): boolean {
  if (!value || value.startsWith("#") || value.startsWith("//")) return true;
  if (windowsDrivePattern.test(value) || /^file:/iu.test(value)) return false;
  return schemePattern.test(value);
}

function wikilinkCandidates<T extends { path: string }>(
  sourcePath: string,
  rawTarget: string,
  sourceByKey: ReadonlyMap<string, T>,
  stemCandidates: ReadonlyMap<string, string[]>,
): string[] {
  const target = rawTarget.trim();
  if (!target) return [];
  if (target.includes("/") || target.includes("\\") || markdownExtension.test(target)) {
    const withExtension = markdownExtension.test(target) ? target : `${target}.md`;
    const resolved = resolveRelativePath(sourcePath, withExtension);
    const candidate = resolved === null ? undefined : sourceByKey.get(pathKey(resolved));
    return candidate ? [candidate.path] : [];
  }
  return [...(stemCandidates.get(titleKey(target.replace(markdownExtension, ""))) ?? [])];
}

function ambiguousLinkId(sourcePath: string, occurrence: number): string {
  return `${sourcePath}#wikilink-${occurrence}`;
}

function requiredReviewedTitle(titles: ReadonlyMap<string, string>, sourcePath: string): string {
  const direct = titles.get(sourcePath);
  if (direct?.trim()) return direct.trim();
  const key = pathKey(sourcePath);
  for (const [path, title] of titles) {
    if (pathKey(path) === key && title.trim()) return title.trim();
  }
  throw new MarkdownFolderImportError(
    "INVALID_MANIFEST",
    `Missing reviewed title for ${sourcePath}.`,
    { sourcePath },
  );
}

function wikilink(title: string, alias: string | null): string {
  const cleanedTitle = title.replaceAll("]]", "] ");
  return alias === null
    ? `[[${cleanedTitle}]]`
    : `[[${cleanedTitle}|${alias.replaceAll("]]", "] ")}]]`;
}

function stableToken(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (const byte of bytes) {
    first = Math.imul(first ^ byte, 0x01000193) >>> 0;
    second = Math.imul(second ^ byte, 0x85ebca6b) >>> 0;
  }
  return `folder-${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}

function imageMimeType(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

function issue(
  code: FolderImportIssueCode,
  message: string,
  sourcePath: string | null = null,
): FolderImportIssue {
  return { code, message, sourcePath, blocking: true };
}

function scanMarkdown(markdown: string): MarkdownScan {
  const mask = codeMask(markdown);
  const definitions = referenceDefinitions(markdown, mask);
  const links: MarkdownLinkSpan[] = [];
  const wikilinks: WikilinkSpan[] = [];
  let wikilinkOccurrence = 0;

  for (let index = 0; index < markdown.length; index += 1) {
    if (mask[index] || isEscaped(markdown, index)) continue;
    if (markdown[index] === "[" && markdown[index + 1] === "[") {
      const end = findWikilinkEnd(markdown, index + 2, mask);
      if (end !== -1) {
        const body = markdown.slice(index + 2, end);
        const separator = body.indexOf("|");
        const target = (separator === -1 ? body : body.slice(0, separator)).trim();
        const alias = separator === -1 ? null : body.slice(separator + 1);
        if (target) {
          wikilinks.push({
            start: index,
            end: end + 2,
            target,
            alias,
            occurrence: wikilinkOccurrence,
          });
          wikilinkOccurrence += 1;
        }
        index = end + 1;
        continue;
      }
    }

    const image = markdown[index] === "!" && markdown[index + 1] === "[";
    const labelStart = image ? index + 1 : index;
    if (markdown[labelStart] !== "[") continue;
    if (!image && markdown[labelStart + 1] === "[") continue;
    const labelEnd = findClosingBracket(markdown, labelStart);
    if (labelEnd === -1) continue;
    const label = markdown.slice(labelStart + 1, labelEnd);
    const next = markdown[labelEnd + 1];
    if (next === "(") {
      const parsed = parseInlineDestination(markdown, labelEnd + 2);
      if (parsed) {
        links.push({
          start: index,
          end: parsed.closingEnd,
          label,
          destination: parsed.destination,
          image,
          destinationStart: parsed.start,
          destinationEnd: parsed.end,
        });
        index = parsed.closingEnd - 1;
      }
      continue;
    }
    let referenceLabel: string | null = null;
    let end = labelEnd + 1;
    if (next === "[") {
      const referenceEnd = findClosingBracket(markdown, labelEnd + 1);
      if (referenceEnd !== -1) {
        referenceLabel = markdown.slice(labelEnd + 2, referenceEnd) || label;
        end = referenceEnd + 1;
      }
    } else {
      referenceLabel = label;
    }
    const definition = referenceLabel === null
      ? undefined
      : definitions.get(normalizeReferenceLabel(referenceLabel));
    if (definition) {
      links.push({
        start: index,
        end,
        label,
        destination: definition.destination,
        image,
        destinationStart: definition.start,
        destinationEnd: definition.end,
      });
      index = end - 1;
    }
  }
  return { links, wikilinks };
}

function referenceDefinitions(
  markdown: string,
  mask: Uint8Array,
): Map<string, { destination: string; start: number; end: number }> {
  const definitions = new Map<string, { destination: string; start: number; end: number }>();
  const pattern = /^([ \t]{0,3}\[([^\]\r\n]+)\]:[ \t]*)(?:<([^>\r\n]+)>|([^\s]+))/gmu;
  for (const match of markdown.matchAll(pattern)) {
    const startIndex = match.index ?? 0;
    if (mask[startIndex]) continue;
    const destination = match[3] ?? match[4];
    const angleOffset = match[3] === undefined ? 0 : 1;
    const start = startIndex + match[1].length + angleOffset;
    const key = normalizeReferenceLabel(match[2]);
    if (!definitions.has(key)) {
      definitions.set(key, { destination, start, end: start + destination.length });
    }
  }
  return definitions;
}

function normalizeReferenceLabel(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}

function parseInlineDestination(markdown: string, startIndex: number): DestinationSpan | null {
  let index = startIndex;
  while (index < markdown.length && /[ \t\r\n]/u.test(markdown[index])) index += 1;
  if (markdown[index] === "<") {
    const start = index + 1;
    const end = findUnescaped(markdown, ">", start);
    const close = end === -1 ? -1 : findUnescaped(markdown, ")", end + 1);
    return end === -1 || close === -1
      ? null
      : { destination: markdown.slice(start, end), start, end, closingEnd: close + 1 };
  }
  const start = index;
  let depth = 0;
  for (; index < markdown.length; index += 1) {
    const character = markdown[index];
    if (character === "\\" && index + 1 < markdown.length) {
      index += 1;
      continue;
    }
    if (character === "(") {
      depth += 1;
      continue;
    }
    if (character === ")") {
      if (depth === 0) {
        return index > start
          ? { destination: markdown.slice(start, index), start, end: index, closingEnd: index + 1 }
          : null;
      }
      depth -= 1;
      continue;
    }
    if (/\s/u.test(character)) {
      const close = findUnescaped(markdown, ")", index);
      return index > start && close !== -1
        ? { destination: markdown.slice(start, index), start, end: index, closingEnd: close + 1 }
        : null;
    }
  }
  return null;
}

function findClosingBracket(markdown: string, startIndex: number): number {
  let depth = 0;
  for (let index = startIndex; index < markdown.length; index += 1) {
    if (isEscaped(markdown, index)) continue;
    if (markdown[index] === "[") depth += 1;
    if (markdown[index] === "]") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function findWikilinkEnd(markdown: string, start: number, mask: Uint8Array): number {
  for (let index = start; index < markdown.length - 1; index += 1) {
    if (!mask[index] && markdown[index] === "]" && markdown[index + 1] === "]") return index;
  }
  return -1;
}

function findUnescaped(markdown: string, target: string, startIndex: number): number {
  for (let index = startIndex; index < markdown.length; index += 1) {
    if (markdown[index] === target && !isEscaped(markdown, index)) return index;
  }
  return -1;
}

function isEscaped(markdown: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && markdown[cursor] === "\\"; cursor -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function codeMask(markdown: string): Uint8Array {
  const mask = new Uint8Array(markdown.length);
  let fence: { marker: string; length: number } | null = null;
  let lineStart = 0;
  while (lineStart < markdown.length) {
    const newline = markdown.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? markdown.length : newline;
    const line = markdown.slice(lineStart, lineEnd).replace(/\r$/u, "");
    const marker = /^[ \t]{0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
    if (fence || marker || /^(?: {4}|\t)/u.test(line)) {
      mask.fill(1, lineStart, newline === -1 ? lineEnd : lineEnd + 1);
    }
    if (!fence && marker) fence = { marker: marker[0], length: marker.length };
    else if (fence && marker?.[0] === fence.marker && marker.length >= fence.length) fence = null;
    if (newline === -1) break;
    lineStart = newline + 1;
  }
  for (let index = 0; index < markdown.length; index += 1) {
    if (mask[index] || markdown[index] !== "`" || isEscaped(markdown, index)) continue;
    let runEnd = index;
    while (markdown[runEnd] === "`") runEnd += 1;
    const length = runEnd - index;
    let close = runEnd;
    while (close < markdown.length) {
      if (mask[close] || markdown[close] !== "`") {
        close += 1;
        continue;
      }
      let closeEnd = close;
      while (markdown[closeEnd] === "`") closeEnd += 1;
      if (closeEnd - close === length) break;
      close = closeEnd;
    }
    if (close < markdown.length) {
      mask.fill(1, index, close + length);
      index = close + length - 1;
    }
  }
  return mask;
}
