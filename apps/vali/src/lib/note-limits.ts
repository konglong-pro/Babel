export const NOTE_CONTENT_MAX_BYTES = 10 * 1024 * 1024;
export const NOTE_NEW_IMAGE_MAX_COUNT = 50;
export const NOTE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const NOTE_SAVE_MAX_BYTES = 100 * 1024 * 1024;
export const NOTE_MULTIPART_WIRE_MAX_BYTES = 160 * 1024 * 1024;

const PENDING_IMAGE_URL_PATTERN = /vali-upload:\/\/[A-Za-z0-9._-]+/g;
const MAX_MANAGED_IMAGE_URL =
  "/api/uploads/notes/00000000-0000-0000-0000-000000000000.webp";

interface PendingImageLike {
  token: string;
  file: { size: number };
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function estimatedPersistedMarkdownBytes(contentMd: string): number {
  return utf8ByteLength(
    contentMd.replace(PENDING_IMAGE_URL_PATTERN, MAX_MANAGED_IMAGE_URL),
  );
}

export function documentSaveLimitError(
  contentMd: string,
  images: readonly PendingImageLike[],
): string {
  const referencedImages = images.filter((image) =>
    contentMd.includes(`vali-upload://${image.token}`),
  );
  const contentBytes = utf8ByteLength(contentMd);
  const persistedContentBytes = estimatedPersistedMarkdownBytes(contentMd);
  const saveBytes = referencedImages.reduce(
    (total, image) => total + image.file.size,
    persistedContentBytes,
  );

  if (Math.max(contentBytes, persistedContentBytes) > NOTE_CONTENT_MAX_BYTES) {
    return "Markdown content must not exceed 10 MB.";
  }
  if (referencedImages.length > NOTE_NEW_IMAGE_MAX_COUNT) {
    return `A document can upload at most ${NOTE_NEW_IMAGE_MAX_COUNT} new images at once.`;
  }
  if (saveBytes > NOTE_SAVE_MAX_BYTES) {
    return "Markdown and new images must not exceed 100 MB in one save.";
  }
  return "";
}
