import { NextResponse } from "next/server";

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

type ErrorLike = {
  code?: unknown;
  message?: unknown;
  status?: unknown;
  statusCode?: unknown;
  details?: unknown;
};

type ImageErrorLike<TCode extends string> = {
  code: TCode;
  message: string;
};

export type HttpErrorHandlerOptions<TImageCode extends string> = {
  errorStatuses: Readonly<Record<string, number>>;
  imageErrorStatuses: Readonly<Record<TImageCode, number>>;
  isImageStorageError: (error: unknown) => error is ImageErrorLike<TImageCode>;
};

function isErrorLike(value: unknown): value is ErrorLike {
  return typeof value === "object" && value !== null;
}

function statusFromError(
  error: ErrorLike,
  errorStatuses: Readonly<Record<string, number>>,
): number | undefined {
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

export function createHttpErrorHandlers<TImageCode extends string>(
  options: HttpErrorHandlerOptions<TImageCode>,
): {
  errorResponse: (error: unknown) => NextResponse<ApiErrorBody>;
  handleApi: (handler: () => Response | Promise<Response>) => Promise<Response>;
} {
  function errorResponse(error: unknown): NextResponse<ApiErrorBody> {
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

    if (options.isImageStorageError(error)) {
      return NextResponse.json(
        {
          error: {
            code: error.code,
            message: error.message,
          },
        },
        { status: options.imageErrorStatuses[error.code] },
      );
    }

    if (isErrorLike(error)) {
      const status = statusFromError(error, options.errorStatuses);
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

  async function handleApi(
    handler: () => Response | Promise<Response>,
  ): Promise<Response> {
    try {
      return await handler();
    } catch (error) {
      return errorResponse(error);
    }
  }

  return { errorResponse, handleApi };
}
