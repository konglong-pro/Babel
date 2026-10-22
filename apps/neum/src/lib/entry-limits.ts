export const ENTRY_NOTES_MAX_BYTES = 10 * 1024 * 1024;
export const ENTRY_CODE_MAX_BYTES = 10 * 1024 * 1024;
export const ENTRY_NEW_IMAGE_MAX_COUNT = 50;
export const ENTRY_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const ENTRY_SAVE_MAX_BYTES = 100 * 1024 * 1024;
export const ENTRY_MULTIPART_WIRE_MAX_BYTES = 160 * 1024 * 1024;

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
