import { hasOwn, type JsonObject } from "@babel-apps/platform/http/request";

import { ApiError } from "@/lib/http/errors";
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
