import { NextResponse } from "next/server";

import { isImageStorageError, type ImageStorageErrorCode } from "@/lib/storage";

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

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

type ErrorLike = {
  code?: unknown;
  message?: unknown;
  status?: unknown;
  statusCode?: unknown;
  details?: unknown;
};

function isErrorLike(value: unknown): value is ErrorLike {
  return typeof value === "object" && value !== null;
}

function statusFromError(error: ErrorLike): number | undefined {
  const explicitStatus =
    typeof error.status === "number" ? error.status : error.statusCode;

  if (
    typeof explicitStatus === "number" &&
    Number.isInteger(explicitStatus) &&
    explicitStatus >= 400 &&
    explicitStatus <= 599
  ) {
    return explicitStatus;
  }

  return typeof error.code === "string" ? errorStatuses[error.code] : undefined;
}

export function errorResponse(error: unknown): NextResponse<ApiErrorBody> {
  if (error instanceof ApiError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      },
      { status: error.status },
    );
  }

  if (isImageStorageError(error)) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
        },
      },
      { status: imageErrorStatuses[error.code] },
    );
  }

  if (isErrorLike(error)) {
    const status = statusFromError(error);
    if (status !== undefined) {
      const code = typeof error.code === "string" ? error.code : "REQUEST_FAILED";
      const message =
        typeof error.message === "string" && error.message.length > 0
          ? error.message
          : "The request could not be completed.";

      return NextResponse.json(
        {
          error: {
            code,
            message,
            ...(error.details === undefined ? {} : { details: error.details }),
          },
        },
        { status },
      );
    }
  }

  console.error("Unhandled API error", error);
  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "The server failed to process the request.",
      },
    },
    { status: 500 },
  );
}

export async function handleApi(
  handler: () => Response | Promise<Response>,
): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    return errorResponse(error);
  }
}
