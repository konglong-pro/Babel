import { ValidationError } from "../vali/errors";

export type JsonObject = Record<string, unknown>;

export async function readJsonObject(request: Request): Promise<JsonObject> {
  const raw = await request.text();
  if (raw.length === 0) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ValidationError(message);
  }

  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new ValidationError("JSON body must be an object");
  }
  return parsed as JsonObject;
}

export function readStringList(value: unknown, message: string): string[] {
  if (!Array.isArray(value)) {
    throw new ValidationError(message);
  }
  return value.map(readLegacyString);
}

export function readLegacyString(value: unknown): string {
  if (value === null) {
    return "None";
  }
  if (value === true) {
    return "True";
  }
  if (value === false) {
    return "False";
  }
  return String(value);
}

export function readLegacyInteger(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  if (typeof value === "string") {
    const source = value.trim();
    if (!/^[+-]?\d+$/.test(source)) {
      throw new ValidationError(`invalid literal for int() with base 10: '${value}'`);
    }
    return Number(source);
  }
  const typeName = value === null ? "NoneType" : Array.isArray(value) ? "list" : "dict";
  throw new TypeError(
    `int() argument must be a string, a bytes-like object or a real number, not '${typeName}'`,
  );
}
