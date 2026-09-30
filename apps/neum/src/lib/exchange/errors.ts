export type SnapshotErrorCode =
  | "INVALID_ARGUMENT"
  | "INVALID_DATABASE"
  | "INVALID_DESTINATION"
  | "INVALID_MANIFEST"
  | "INVALID_BUNDLE"
  | "INVALID_IMAGE"
  | "TARGET_NOT_PRISTINE";

export class SnapshotError extends Error {
  readonly code: SnapshotErrorCode;

  constructor(code: SnapshotErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SnapshotError";
    this.code = code;
  }
}
