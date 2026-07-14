import {
  hasOwn,
  readJsonObject,
  type JsonObject,
} from "@babel-apps/platform/http/request";

import { ApiError } from "@/lib/http/errors";
import {
  assertUploadToken,
  type NoteImageUpload,
} from "@/lib/storage/note-images";
import { folderTypes, type FolderType } from "@/lib/types";

export {
  assertPatchHasFields,
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

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
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
