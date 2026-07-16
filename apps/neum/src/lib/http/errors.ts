import {
  ApiError,
  createHttpErrorHandlers,
  type ApiErrorBody,
} from "@babel-apps/platform/http/errors";

import { isImageStorageError, type ImageStorageErrorCode } from "@/lib/storage";

export { ApiError };
export type { ApiErrorBody };

const errorStatuses: Readonly<Record<string, number>> = {
  BAD_REQUEST: 400,
  INVALID_JSON: 400,
  INVALID_MULTIPART: 400,
  VALIDATION: 400,
  VALIDATION_ERROR: 400,
  CONTENT_TOO_LARGE: 413,
  CODE_TOO_LARGE: 413,
  TOO_MANY_IMAGES: 413,
  REQUEST_TOO_LARGE: 413,
  NOT_FOUND: 404,
  FOLDER_NOT_FOUND: 404,
  ENTRY_NOT_FOUND: 404,
  CONFLICT: 409,
  VERSION_CONFLICT: 409,
  NOT_EMPTY: 409,
  FOLDER_NOT_EMPTY: 409,
  SQLITE_CONSTRAINT: 409,
  SQLITE_CONSTRAINT_CHECK: 409,
  SQLITE_CONSTRAINT_FOREIGNKEY: 409,
  SQLITE_CONSTRAINT_PRIMARYKEY: 409,
  SQLITE_CONSTRAINT_UNIQUE: 409,
};

const imageErrorStatuses: Readonly<Record<ImageStorageErrorCode, number>> = {
  EMPTY_FILE: 400,
  FILE_TOO_LARGE: 413,
  CONTENT_TOO_LARGE: 413,
  CODE_TOO_LARGE: 413,
  TOO_MANY_IMAGES: 413,
  REQUEST_TOO_LARGE: 413,
  INVALID_CONTENT: 400,
  INVALID_PATH: 400,
  INVALID_TYPE: 415,
  NOT_FOUND: 404,
};

export const { errorResponse, handleApi } = createHttpErrorHandlers({
  errorStatuses,
  imageErrorStatuses,
  isImageStorageError,
});
