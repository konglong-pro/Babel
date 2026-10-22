import type { ImportedOriginalDocument } from "./document-core";
import { prepareClipboardMarkdownFile } from "./clipboard-client";
import {
  WEB_ARCHIVE_MAX_BYTES,
  decodeWebArchiveAsset,
  parseWebArchive,
  validateWebArchive,
  type WebArchive,
} from "./web-archive-core";

export interface WebArchiveDraftImage {
  token: string;
  file: File;
  previewUrl: string;
}

export interface WebArchiveDraftSaveBudget {
  contentMd: string;
  maxMarkdownBytes: number;
  maxImages: number;
  maxImageBytes: number;
  maxSaveBytes: number;
  imageScheme: string;
  imageUrlPrefix: string;
}

interface ArchiveMarkdownFile extends File {
  readonly webArchiveAssets?: ReadonlyMap<string, File>;
}

export function webArchiveImportTitle(title: string): string {
  return Array.from(title.replace(/[\u0000-\u001f\u007f/\\]/gu, " ").trim()).slice(0, 120).join("") || "Imported conversation";
}

/** Validate locally; importing an archive never uploads its contents. */
export async function readWebArchiveFile(file: File): Promise<WebArchive> {
  if (!/\.babel\.json$/iu.test(file.name)) throw new Error("Choose a David archive with a .babel.json extension.");
  if (file.size === 0) throw new Error("The selected archive is empty.");
  if (file.size > WEB_ARCHIVE_MAX_BYTES) throw new Error("The selected archive exceeds 150 MiB. Export a smaller selection.");
  return parseWebArchive(new Uint8Array(await file.arrayBuffer()));
}

/** Keep the original capture immutable while the note title and Markdown remain editable. */
export function prepareWebArchiveImport(
  value: WebArchive,
  review: { title?: string; markdown?: string } = {},
): { file: File; original: ImportedOriginalDocument } {
  const archive = validateWebArchive(value);
  const token = crypto.randomUUID();
  const markdown = `${(review.markdown ?? archive.markdown).trimEnd()}\n\n[View original layout](babel-original://${token})\n`;
  const file = prepareClipboardMarkdownFile(markdown, review.title ?? webArchiveImportTitle(archive.title));
  const assets = new Map(archive.assets.map(asset => [
    `assets/${asset.name}`,
    new File([new Uint8Array(decodeWebArchiveAsset(asset))], asset.name, { type: asset.mimeType }),
  ]));
  Object.defineProperty(file, "webArchiveAssets", { value: assets });
  return {
    file,
    original: {
      kind: "web-archive",
      token,
      file: new File([JSON.stringify(archive)], "capture.babel.json", { type: "application/json" }),
    },
  };
}

/** Match full archive paths after each notebook rewrites images to managed-image tokens. */
export function webArchiveDraftImages(
  file: File,
  imageReferences: readonly { path: string; token: string }[],
  budget?: WebArchiveDraftSaveBudget,
): WebArchiveDraftImage[] | undefined {
  const assets = (file as ArchiveMarkdownFile).webArchiveAssets;
  if (!assets) return undefined;
  if (budget) {
    // Count only images entering the editable note. Snapshot-only visuals remain
    // inside the separately saved archive and consume none of this save budget.
    const referencedFiles = imageReferences.flatMap(reference => {
      const asset = assets.get(reference.path);
      return asset ? [asset] : [];
    });
    const managedImage = `${budget.imageUrlPrefix}00000000-0000-0000-0000-000000000000.webp`;
    const scheme = budget.imageScheme.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const persisted = budget.contentMd
      .replace(new RegExp(`${scheme}://[A-Za-z0-9._-]+`, "gu"), managedImage)
      .replace(/babel-original:\/\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/giu,
        `/api/imports/web-archive/snapshots/${"0".repeat(64)}`);
    const encoder = new TextEncoder();
    const markdownBytes = Math.max(encoder.encode(budget.contentMd).byteLength, encoder.encode(persisted).byteLength);
    const totalBytes = referencedFiles.reduce((sum, asset) => sum + asset.size, markdownBytes);
    if (markdownBytes > budget.maxMarkdownBytes) throw new Error(`The archive draft exceeds this notebook's ${budget.maxMarkdownBytes / 1024 / 1024} MiB Markdown limit after saving its image and original-layout links. Shorten the Markdown or export a smaller selection.`);
    if (referencedFiles.length > budget.maxImages) throw new Error(`The archive draft exceeds this notebook's ${budget.maxImages}-image save limit. Remove image references or export a smaller selection.`);
    if (referencedFiles.some(asset => asset.size > budget.maxImageBytes)) throw new Error(`An archive image exceeds this notebook's ${budget.maxImageBytes / 1024 / 1024} MiB image limit. Export a smaller image.`);
    if (totalBytes > budget.maxSaveBytes) throw new Error(`The archive draft exceeds this notebook's ${budget.maxSaveBytes / 1024 / 1024} MiB combined Markdown and referenced-image save limit. Remove image references or export a smaller selection. The original layout will retain its captured pictures.`);
  }
  const images: WebArchiveDraftImage[] = [];
  try {
    for (const reference of imageReferences) {
      const asset = assets.get(reference.path);
      if (!asset) continue;
      images.push({ token: reference.token, file: asset, previewUrl: URL.createObjectURL(asset) });
    }
    return images;
  } catch (failure) {
    for (const image of images) URL.revokeObjectURL(image.previewUrl);
    throw failure;
  }
}
