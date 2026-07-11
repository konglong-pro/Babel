import { ApiError } from "@/lib/http/errors";
import { folderTypes, type FolderType } from "@/lib/types";

export type JsonObject = Record<string, unknown>;

function hasOwn(value: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export async function readJsonObject(request: Request): Promise<JsonObject> {
  let value: unknown;

  try {
    value = await request.json();
  } catch {
    throw new ApiError(
      400,
      "INVALID_JSON",
      "The request body must be a valid JSON object.",
    );
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ApiError(400, "INVALID_JSON", "The request body must be a JSON object.");
  }

  return value as JsonObject;
}

export function parsePositiveInteger(value: string, field: string): number {
  if (!/^\d+$/.test(value)) {
    throw new ApiError(400, "VALIDATION_ERROR", `${field} must be a positive integer.`, {
      field,
    });
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new ApiError(400, "VALIDATION_ERROR", `${field} must be a positive integer.`, {
      field,
    });
  }

  return parsed;
}

export function requiredString(body: JsonObject, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApiError(400, "VALIDATION_ERROR", `${field} is required.`, { field });
  }

  return value.trim();
}

export function optionalString(
  body: JsonObject,
  field: string,
  options: { allowEmpty?: boolean; trim?: boolean } = {},
): string | undefined {
  if (!hasOwn(body, field)) {
    return undefined;
  }

  const value = body[field];
  if (typeof value !== "string") {
    throw new ApiError(400, "VALIDATION_ERROR", `${field} must be a string.`, {
      field,
    });
  }

  const normalized = options.trim === false ? value : value.trim();
  if (options.allowEmpty !== true && normalized.length === 0) {
    throw new ApiError(400, "VALIDATION_ERROR", `${field} is required.`, { field });
  }

  return normalized;
}

export function requiredPositiveInteger(body: JsonObject, field: string): number {
  const value = body[field];
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new ApiError(400, "VALIDATION_ERROR", `${field} must be a positive integer.`, {
      field,
    });
  }

  return value as number;
}

export function optionalPositiveInteger(
  body: JsonObject,
  field: string,
): number | undefined {
  if (!hasOwn(body, field)) {
    return undefined;
  }

  return requiredPositiveInteger(body, field);
}

export function optionalNullablePositiveInteger(
  body: JsonObject,
  field: string,
): number | null | undefined {
  if (!hasOwn(body, field)) {
    return undefined;
  }

  if (body[field] === null) {
    return null;
  }

  return requiredPositiveInteger(body, field);
}

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
      {
      field: "type",
      },
    );
  }

  return value as FolderType;
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
      {
      field: selectedField,
      },
    );
  }

  return [...new Set(value as number[])];
}

export function assertPatchHasFields(
  patch: Record<string, unknown>,
  message = "At least one field must be provided for update.",
): void {
  if (Object.values(patch).every((value) => value === undefined)) {
    throw new ApiError(400, "VALIDATION_ERROR", message);
  }
}
