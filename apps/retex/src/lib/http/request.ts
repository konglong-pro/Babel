import {
  hasOwn,
  readJsonObject,
  type JsonObject,
} from "@babel-apps/platform/http/request";

import { ApiError } from "@/lib/http/errors";
import {
  NOTE_MULTIPART_WIRE_MAX_BYTES,
  NOTE_NEW_IMAGE_MAX_COUNT,
} from "@/lib/note-limits";
import {
  assertUploadToken,
  type NoteImageUpload,
} from "@/lib/storage/note-images";
import { folderTypes, type FolderType } from "@/lib/types";

export {
  assertSameOrigin,
  assertPatchHasFields,
  optionalNonNegativeInteger,
  optionalNullablePositiveInteger,
  optionalPositiveInteger,
  optionalString,
  parsePositiveInteger,
  readJsonObject,
  requiredPositiveInteger,
  requiredString,
  type JsonObject,
} from "@babel-apps/platform/http/request";

export function requiredFolderType(body: JsonObject, field = "type"): FolderType {
  const value = body[field];
  if (typeof value !== "string" || !folderTypes.includes(value as FolderType)) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      `${field} must be either "knowledge" or "exercise".`,
      { field },
    );
  }

  return value as FolderType;
}

export function requiredMarkdown(body: JsonObject, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApiError(400, "VALIDATION_ERROR", `${field} is required.`, { field });
  }

  return value;
}

export function queryFolderType(value: string | null): FolderType {
  if (value === null || !folderTypes.includes(value as FolderType)) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      'type must be either "knowledge" or "exercise".',
      { field: "type" },
    );
  }

  return value as FolderType;
}

export interface NoteMutationRequest {
  payload: JsonObject;
  uploads: Map<string, NoteImageUpload>;
}

export async function readNoteMutationRequest(
  request: Request,
  onPayloadDecoded?: (payload: JsonObject) => void,
): Promise<NoteMutationRequest> {
  const mediaType = (request.headers.get("content-type") ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (mediaType !== "multipart/form-data") {
    const payload = await readJsonObject(request);
    onPayloadDecoded?.(payload);
    return { payload, uploads: new Map() };
  }

  assertMultipartWireSize(
    request.headers.get("content-length"),
    NOTE_MULTIPART_WIRE_MAX_BYTES,
  );

  let formData: FormData;
  let sizeError: ApiError | undefined;
  try {
    if (request.body === undefined || request.body === null) {
      formData = await request.formData();
    } else {
      let receivedBytes = 0;
      const countedBody = request.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            receivedBytes += chunk.byteLength;
            if (receivedBytes > NOTE_MULTIPART_WIRE_MAX_BYTES) {
              sizeError = multipartWireSizeError(NOTE_MULTIPART_WIRE_MAX_BYTES);
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
  if (
    typeof parsedPayload !== "object" ||
    parsedPayload === null ||
    Array.isArray(parsedPayload)
  ) {
    throw new ApiError(
      400,
      "INVALID_JSON",
      "The multipart payload field must contain a JSON object.",
      { field: "payload" },
    );
  }
  const payload = parsedPayload as JsonObject;
  onPayloadDecoded?.(payload);

  const uploads = new Map<string, NoteImageUpload>();
  for (const [field, value] of formData.entries()) {
    if (field === "payload") continue;
    if (!field.startsWith("image:")) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        `Unexpected multipart field: ${field}.`,
        { field },
      );
    }
    if (uploads.size >= NOTE_NEW_IMAGE_MAX_COUNT) {
      throw new ApiError(
        413,
        "TOO_MANY_IMAGES",
        "A note save may include at most 50 new images.",
      );
    }
    const token = field.slice("image:".length);
    assertUploadToken(token);
    if (uploads.has(token)) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "Image upload tokens must be unique.",
        { token },
      );
    }
    if (!isNoteImageUpload(value)) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "Image fields must contain files.",
        { field },
      );
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
  if (!hasOwn(body, field)) {
    return undefined;
  }

  const value = body[field];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ApiError(400, "VALIDATION_ERROR", `${field} must be an array of strings.`, {
      field,
    });
  }

  return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
}

export function optionalIdArray(
  body: JsonObject,
  field: string,
  alias?: string,
): number[] | undefined {
  const selectedField = hasOwn(body, field) ? field : alias && hasOwn(body, alias) ? alias : null;
  if (selectedField === null) {
    return undefined;
  }

  const value = body[selectedField];
  if (
    !Array.isArray(value) ||
    value.some((item) => !Number.isSafeInteger(item) || (item as number) <= 0)
  ) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      `${selectedField} must be an array of positive integers.`,
      { field: selectedField },
    );
  }

  return [...new Set(value as number[])];
}

function isNoteImageUpload(value: FormDataEntryValue): value is File {
  return (
    typeof value !== "string" &&
    typeof value.type === "string" &&
    typeof value.size === "number" &&
    typeof value.arrayBuffer === "function"
  );
}
