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
  VALIDATION: 400,
  VALIDATION_ERROR: 400,
  INVALID_FOLDER_TYPE: 400,
  INVALID_PARENT: 400,
  INVALID_RELATION: 400,
  NOT_FOUND: 404,
  FOLDER_NOT_FOUND: 404,
  KNOWLEDGE_NOT_FOUND: 404,
  EXERCISE_NOT_FOUND: 404,
  SCRATCH_NOT_FOUND: 404,
  CONFLICT: 409,
  CYCLE: 409,
  FOLDER_CYCLE: 409,
  FOLDER_NOT_EMPTY: 409,
  NOT_EMPTY: 409,
  DUPLICATE: 409,
  SQLITE_CONSTRAINT: 409,
  SQLITE_CONSTRAINT_CHECK: 409,
  SQLITE_CONSTRAINT_FOREIGNKEY: 409,
  SQLITE_CONSTRAINT_PRIMARYKEY: 409,
  SQLITE_CONSTRAINT_UNIQUE: 409,
};

const imageErrorStatuses: Readonly<Record<ImageStorageErrorCode, number>> = {
  EMPTY_FILE: 400,
  FILE_TOO_LARGE: 413,
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
