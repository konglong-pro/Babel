import type {
  EntryBacklinkDto,
  EntryDetailDto,
  EntryKind,
  EntrySummaryDto,
  EntryTitleDto,
  FolderDto,
  PaginatedDto,
  SearchResultsDto,
  TagSummaryDto,
  TrashEntryDto,
} from "@/lib/types";

interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code = "REQUEST_FAILED",
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData
        ? {}
        : init?.body
          ? { "Content-Type": "application/json" }
          : {}),
      ...init?.headers,
    },
  });

  if (response.status === 204) return undefined as T;

  const body = (await response.json().catch(() => null)) as T | ApiErrorBody | null;
  if (!response.ok) {
    const error = (body as ApiErrorBody | null)?.error;
    throw new ApiError(
      error?.message ?? `Request failed (${response.status}).`,
      response.status,
      error?.code,
      error?.details,
    );
  }

  return body as T;
}

function jsonBody(value: unknown): Pick<RequestInit, "body"> {
  return { body: JSON.stringify(value) };
}

function queryString(values: Record<string, string | number | boolean | null | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "An unknown error occurred. Please try again.";
}

export function listFolders(): Promise<FolderDto[]> {
  return request("/api/folders");
}

export function createFolder(input: {
  name: string;
  parentId: number | null;
}): Promise<FolderDto> {
  return request("/api/folders", {
    method: "POST",
    ...jsonBody(input),
  });
}

export function updateFolder(
  id: number,
  input: { name?: string; parentId?: number | null },
): Promise<FolderDto> {
  return request(`/api/folders/${id}`, {
    method: "PATCH",
    ...jsonBody(input),
  });
}

export function deleteFolder(id: number): Promise<void> {
  return request(`/api/folders/${id}`, { method: "DELETE" });
}

export interface EntryListFilters {
  folderId?: number;
  includeDescendants?: boolean;
  kind?: EntryKind;
  tag?: string;
  completeTree?: boolean;
  limit?: number;
  offset?: number;
}

function entryFilterQuery(filters: EntryListFilters): Record<string, string | number | undefined> {
  return {
    folderId: filters.folderId,
    scope: filters.includeDescendants === undefined
      ? undefined
      : filters.includeDescendants
        ? "tree"
        : "direct",
    kind: filters.kind,
    tag: filters.tag,
    completeTree: filters.completeTree === true ? "true" : undefined,
    limit: filters.limit,
    offset: filters.offset,
  };
}

export function listEntries(filters: EntryListFilters = {}): Promise<PaginatedDto<EntrySummaryDto>> {
  return request(`/api/entries${queryString(entryFilterQuery(filters))}`);
}

export function getEntry(id: number): Promise<EntryDetailDto> {
  return request(`/api/entries/${id}`);
}

export function listEntryBacklinks(id: number): Promise<EntryBacklinkDto[]> {
  return request(`/api/entries/${id}/backlinks`);
}

export function listEntryTitles(
  query: string,
  signal?: AbortSignal,
): Promise<EntryTitleDto[]> {
  return request(
    `/api/entries/titles${queryString({ q: query, limit: 20 })}`,
    { signal },
  );
}

export interface EntryInput {
  folderId: number;
  parentId: number | null;
  kind: EntryKind;
  title: string;
  notesMd: string;
  code: string | null;
  language: string | null;
  filename: string | null;
  tags: string[];
}

export interface EntryImageUpload {
  token: string;
  file: File;
}

function entryFormData(
  input: EntryInput & { expectedVersion?: number },
  images: readonly EntryImageUpload[],
): FormData {
  const formData = new FormData();
  formData.set("payload", JSON.stringify(input));

  for (const image of images) {
    if (input.notesMd.includes(`neum-upload://${image.token}`)) {
      formData.append(`image:${image.token}`, image.file);
    }
  }

  return formData;
}

export function createEntry(
  input: EntryInput,
  images: readonly EntryImageUpload[] = [],
): Promise<EntryDetailDto> {
  return request("/api/entries", {
    method: "POST",
    body: entryFormData(input, images),
  });
}

export function updateEntry(
  id: number,
  expectedVersion: number,
  input: EntryInput,
  images: readonly EntryImageUpload[] = [],
): Promise<EntryDetailDto> {
  return request(`/api/entries/${id}`, {
    method: "PATCH",
    body: entryFormData({ ...input, expectedVersion }, images),
  });
}

export function deleteEntry(id: number, expectedVersion: number): Promise<void> {
  return request(`/api/entries/${id}`, {
    method: "DELETE",
    ...jsonBody({ expectedVersion }),
  });
}

export interface SearchFilters extends Omit<EntryListFilters, "completeTree"> {
  query: string;
}

export function searchEntries(filters: SearchFilters): Promise<SearchResultsDto> {
  const {
    query,
    folderId,
    includeDescendants,
    kind,
    tag,
    limit,
    offset,
  } = filters;
  return request(`/api/search${queryString({
    q: query,
    ...entryFilterQuery({
      folderId,
      includeDescendants,
      kind,
      tag,
      limit,
      offset,
    }),
  })}`);
}

export function listTags(): Promise<TagSummaryDto[]> {
  return request("/api/tags");
}

export function listTrash(input: {
  kind?: EntryKind;
  limit?: number;
  offset?: number;
} = {}): Promise<PaginatedDto<TrashEntryDto>> {
  return request(`/api/trash${queryString(input)}`);
}

export function getTrashEntry(id: number): Promise<TrashEntryDto> {
  return request(`/api/trash/${id}`);
}

export function restoreTrashEntry(id: number): Promise<EntryDetailDto> {
  return request(`/api/trash/${id}/restore`, { method: "POST" });
}

export function permanentlyDeleteTrashEntry(id: number): Promise<void> {
  return request(`/api/trash/${id}`, { method: "DELETE" });
}
