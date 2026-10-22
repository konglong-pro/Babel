import {
  hasOwn,
  type JsonObject,
} from "@babel-apps/platform/http/request";

import { ApiError } from "@/lib/http/errors";
import {
  ENTRY_MULTIPART_WIRE_MAX_BYTES,
  ENTRY_NEW_IMAGE_MAX_COUNT,
} from "@/lib/entry-limits";
import { assertUploadToken, type EntryImageUpload } from "@/lib/storage";

export {
  assertOnlyFields,
  assertPatchHasFields,
  assertSameOrigin,
  optionalNullablePositiveInteger,
  optionalNonNegativeInteger,
  optionalPositiveInteger,
  optionalString,
  parsePositiveInteger,
  readJsonObject,
  requiredPositiveInteger,
  requiredString,
  type JsonObject,
} from "@babel-apps/platform/http/request";

export interface EntryMultipartRequest {
  payload: JsonObject;
  uploads: Map<string, EntryImageUpload>;
}

export async function readEntryMultipart(
  request: Request,
  wireLimitBytes = ENTRY_MULTIPART_WIRE_MAX_BYTES,
): Promise<EntryMultipartRequest> {
  assertMultipartWireSize(request.headers.get("content-length"), wireLimitBytes);

  let formData: FormData;
  let sizeError: ApiError | undefined;
  try {
    if (request.body === undefined || request.body === null) {
      // Small Request-shaped test doubles do not expose a body stream.
      formData = await request.formData();
    } else {
      let receivedBytes = 0;
      const countedBody = request.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            receivedBytes += chunk.byteLength;
            if (receivedBytes > wireLimitBytes) {
              sizeError = multipartWireSizeError(wireLimitBytes);
              controller.error(sizeError);
              return;
            }
            controller.enqueue(chunk);
          },
        }),
      );
      const headers = new Headers();
      const contentType = request.headers.get("content-type");
      if (contentType !== null) headers.set("content-type", contentType);
      formData = await new Response(countedBody, { headers }).formData();
    }
  } catch {
    if (sizeError !== undefined) throw sizeError;
    throw new ApiError(
      400,
      "INVALID_MULTIPART",
      "The request body must be valid multipart form data.",
    );
  }

  const payloadParts = formData.getAll("payload");
  if (payloadParts.length !== 1 || typeof payloadParts[0] !== "string") {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "The multipart payload field must contain one JSON object.",
      { field: "payload" },
    );
  }

  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(payloadParts[0]);
  } catch {
    throw new ApiError(
      400,
      "INVALID_JSON",
      "The multipart payload field must contain valid JSON.",
      { field: "payload" },
    );
  }
  const payload = asJsonObject(
    parsedPayload,
    "The multipart payload field must contain a JSON object.",
  );

  const uploads = new Map<string, EntryImageUpload>();
  for (const [field, value] of formData.entries()) {
    if (field === "payload") continue;
    if (!field.startsWith("image:")) {
      throw new ApiError(400, "VALIDATION_ERROR", `Unexpected multipart field: ${field}.`, {
        field,
      });
    }
    if (uploads.size >= ENTRY_NEW_IMAGE_MAX_COUNT) {
      throw new ApiError(
        413,
        "TOO_MANY_IMAGES",
        "An entry save may include at most 50 new images.",
      );
    }

    const token = field.slice("image:".length);
    assertUploadToken(token);
    if (uploads.has(token)) {
      throw new ApiError(400, "VALIDATION_ERROR", "Image upload tokens must be unique.", {
        token,
      });
    }
    if (!isEntryImageUpload(value)) {
      throw new ApiError(400, "VALIDATION_ERROR", "Image fields must contain files.", {
        field,
      });
    }
    uploads.set(token, value);
  }

  return { payload, uploads };
}

function multipartWireSizeError(wireLimitBytes: number): ApiError {
  const mebibyte = 1024 * 1024;
  const displayLimit = wireLimitBytes % mebibyte === 0
    ? `${wireLimitBytes / mebibyte} MiB`
    : `${wireLimitBytes} bytes`;
  return new ApiError(
    413,
    "REQUEST_TOO_LARGE",
    `The multipart request body must not exceed ${displayLimit}.`,
  );
}

function assertMultipartWireSize(
  contentLength: string | null,
  wireLimitBytes: number,
): void {
  if (contentLength === null) return;
  const normalized = contentLength.trim();
  if (!/^\d+$/.test(normalized)) return;

  let parsed: bigint;
  try {
    parsed = BigInt(normalized);
  } catch {
    return;
  }
  if (parsed > BigInt(wireLimitBytes)) {
    throw multipartWireSizeError(wireLimitBytes);
  }
}

export function optionalStringArray(
  body: JsonObject,
  field: string,
): string[] | undefined {
  if (!hasOwn(body, field)) return undefined;
  const value = body[field];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ApiError(400, "VALIDATION_ERROR", `${field} must be an array of strings.`, {
      field,
    });
  }
  return [...value] as string[];
}

export function optionalNullableString(
  body: JsonObject,
  field: string,
  options: { allowEmpty?: boolean; trim?: boolean } = {},
): string | null | undefined {
  if (!hasOwn(body, field)) return undefined;
  if (body[field] === null) return null;
  const value = body[field];
  if (typeof value !== "string") {
    throw new ApiError(400, "VALIDATION_ERROR", `${field} must be a string or null.`, {
      field,
    });
  }
  const normalized = options.trim === false ? value : value.trim();
  if (options.allowEmpty !== true && normalized.length === 0) {
    throw new ApiError(400, "VALIDATION_ERROR", `${field} cannot be blank.`, { field });
  }
  return normalized;
}

export function parseNonNegativeInteger(value: string, field: string): number {
  if (!/^\d+$/.test(value)) {
    throw new ApiError(400, "VALIDATION_ERROR", `${field} must be a non-negative integer.`, {
      field,
    });
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new ApiError(400, "VALIDATION_ERROR", `${field} must be a non-negative integer.`, {
      field,
    });
  }
  return parsed;
}

export function parseBoolean(value: string, field: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new ApiError(400, "VALIDATION_ERROR", `${field} must be true or false.`, { field });
}

function asJsonObject(value: unknown, message: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ApiError(400, "INVALID_JSON", message);
  }
  return value as JsonObject;
}

function isEntryImageUpload(value: FormDataEntryValue): value is File {
  return (
    typeof value !== "string" &&
    typeof value.type === "string" &&
    typeof value.size === "number" &&
    typeof value.arrayBuffer === "function"
  );
}
