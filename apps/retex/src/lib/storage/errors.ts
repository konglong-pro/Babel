export type ImageStorageErrorCode =
  | "INVALID_TYPE"
  | "FILE_TOO_LARGE"
  | "EMPTY_FILE"
  | "INVALID_CONTENT"
  | "INVALID_PATH"
  | "NOT_FOUND";

export class ImageStorageError extends Error {
  readonly code: ImageStorageErrorCode;

  constructor(code: ImageStorageErrorCode, message: string) {
    super(message);
    this.name = "ImageStorageError";
    this.code = code;
  }
}

export function isImageStorageError(error: unknown): error is ImageStorageError {
  return error instanceof ImageStorageError;
}
