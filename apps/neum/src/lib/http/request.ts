import { hasOwn, type JsonObject } from "@babel-apps/platform/http/request";

import { ApiError } from "@/lib/http/errors";
import { assertUploadToken, type EntryImageUpload } from "@/lib/storage";

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

export interface EntryMultipartRequest {
  payload: JsonObject;
  uploads: Map<string, EntryImageUpload>;
}

export function assertSameOrigin(request: Request): void {
  let requestUrl: URL;
  try {
    requestUrl = new URL(request.url);
  } catch {
    throw forbiddenOrigin();
  }

  if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(requestUrl.hostname)) {
    throw forbiddenOrigin();
  }

  const origin = request.headers.get("origin");
  if (origin === null) return;

  try {
    if (new URL(origin).origin !== requestUrl.origin) throw forbiddenOrigin();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw forbiddenOrigin();
  }
}

export async function readEntryMultipart(
  request: Request,
): Promise<EntryMultipartRequest> {
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

export function assertOnlyFields(body: JsonObject, allowed: readonly string[]): void {
  const unknown = Object.keys(body).find((field) => !allowed.includes(field));
  if (unknown) {
    throw new ApiError(400, "VALIDATION_ERROR", `Unexpected field: ${unknown}.`, {
      field: unknown,
    });
  }
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

function forbiddenOrigin(): ApiError {
  return new ApiError(403, "FORBIDDEN_ORIGIN", "Cross-origin mutations are not allowed.");
}
