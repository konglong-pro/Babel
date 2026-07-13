import { ApiError } from "@/lib/http/errors";
import {
  parseNonNegativeInteger,
  parsePositiveInteger,
} from "@/lib/http/request";
import type { EntryKind } from "@/lib/types";

export interface EntryQueryOptions {
  folderId?: number;
  includeDescendants: boolean;
  kind?: EntryKind;
  tag?: string;
  completeTree: boolean;
  limit: number;
  offset: number;
}

export interface SearchQueryOptions extends EntryQueryOptions {
  query: string;
}

const filterFields = ["folderId", "scope", "kind", "tag", "limit", "offset"];
const entryFields = new Set([...filterFields, "completeTree"]);
const searchFields = new Set([...filterFields, "q"]);

export function parseEntryQuery(request: Request): EntryQueryOptions {
  const params = new URL(request.url).searchParams;
  assertOnlyQueryFields(params, entryFields);
  return parseFilters(params, true);
}

export function parseSearchQuery(request: Request): SearchQueryOptions {
  const params = new URL(request.url).searchParams;
  assertOnlyQueryFields(params, searchFields);
  return {
    ...parseFilters(params, false),
    query: params.get("q")?.trim() ?? "",
  };
}

export function parseTrashQuery(request: Request): Pick<
  EntryQueryOptions,
  "limit" | "offset"
> {
  const params = new URL(request.url).searchParams;
  const allowed = new Set(["limit", "offset"]);
  assertOnlyQueryFields(params, allowed);
  return parsePagination(params);
}

function parseFilters(
  params: URLSearchParams,
  allowCompleteTree: boolean,
): EntryQueryOptions {
  const folder = params.get("folderId");
  const scope = params.get("scope") ?? "tree";
  if (scope !== "tree" && scope !== "direct") {
    throw new ApiError(400, "VALIDATION_ERROR", "scope must be tree or direct.", {
      field: "scope",
    });
  }

  const kindValue = params.get("kind");
  let kind: EntryKind | undefined;
  if (kindValue !== null) {
    if (kindValue !== "knowledge" && kindValue !== "snippet") {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "kind must be knowledge or snippet.",
        { field: "kind" },
      );
    }
    kind = kindValue;
  }

  const rawTag = params.get("tag");
  const tag = rawTag?.trim();
  if (rawTag !== null && !tag) {
    throw new ApiError(400, "VALIDATION_ERROR", "tag cannot be blank.", {
      field: "tag",
    });
  }

  const rawCompleteTree = allowCompleteTree ? params.get("completeTree") : null;
  if (rawCompleteTree !== null && rawCompleteTree !== "true" && rawCompleteTree !== "false") {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "completeTree must be true or false.",
      { field: "completeTree" },
    );
  }

  return {
    ...(folder === null ? {} : { folderId: parsePositiveInteger(folder, "folderId") }),
    includeDescendants: scope === "tree",
    ...(kind === undefined ? {} : { kind }),
    ...(tag === undefined ? {} : { tag }),
    completeTree: rawCompleteTree === "true",
    ...parsePagination(params),
  };
}

function parsePagination(params: URLSearchParams): { limit: number; offset: number } {
  const rawLimit = params.get("limit");
  const rawOffset = params.get("offset");
  const limit = rawLimit === null ? 50 : parsePositiveInteger(rawLimit, "limit");
  if (limit > 100) {
    throw new ApiError(400, "VALIDATION_ERROR", "limit cannot exceed 100.", {
      field: "limit",
    });
  }
  return {
    limit,
    offset: rawOffset === null ? 0 : parseNonNegativeInteger(rawOffset, "offset"),
  };
}

function assertOnlyQueryFields(
  params: URLSearchParams,
  allowed: ReadonlySet<string>,
): void {
  for (const key of params.keys()) {
    if (!allowed.has(key)) {
      throw new ApiError(400, "VALIDATION_ERROR", `Unexpected query field: ${key}.`, {
        field: key,
      });
    }
  }
}
