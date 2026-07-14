export type RepositoryErrorCode =
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONTENT_TOO_LARGE"
  | "CONFLICT"
  | "NOT_EMPTY";

export class RepositoryError extends Error {
  readonly code: RepositoryErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: RepositoryErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "RepositoryError";
    this.code = code;
    this.details = details;
  }
}

export function isRepositoryError(error: unknown): error is RepositoryError {
  return error instanceof RepositoryError;
}
