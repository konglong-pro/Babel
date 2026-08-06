import type {
  BacklinkDto,
  CanvasDetailDto,
  CanvasSummaryDto,
  FolderDto,
  NoteDetailDto,
  NoteSummaryDto,
  NoteTemplateDto,
  NoteTitleDto,
  SearchResultsDto,
} from "@/lib/types";
import type { CanvasScene } from "@/lib/canvas-scene";

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
      ...(init?.body instanceof FormData ? {} : init?.body ? { "Content-Type": "application/json" } : {}),
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

export function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "An unknown error occurred. Please try again.";
}

export function listCanvases(): Promise<CanvasSummaryDto[]> {
  return request("/api/canvases");
}

export function getCanvas(id: number, signal?: AbortSignal): Promise<CanvasDetailDto> {
  return request(`/api/canvases/${id}`, { signal });
}

export function createCanvas(title: string): Promise<CanvasDetailDto> {
  return request("/api/canvases", {
    method: "POST",
    ...jsonBody({ title }),
  });
}

export function updateCanvas(
  id: number,
  input: { title?: string; scene?: CanvasScene },
): Promise<CanvasDetailDto> {
  return request(`/api/canvases/${id}`, {
    method: "PATCH",
    ...jsonBody(input),
  });
}

export function deleteCanvas(id: number): Promise<void> {
  return request(`/api/canvases/${id}`, { method: "DELETE" });
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
  input: { name?: string; parentId?: number | null; position?: number },
): Promise<FolderDto> {
  return request(`/api/folders/${id}`, {
    method: "PATCH",
    ...jsonBody(input),
  });
}

export function deleteFolder(id: number): Promise<void> {
  return request(`/api/folders/${id}`, { method: "DELETE" });
}

export function listNotes(folderId?: number): Promise<NoteSummaryDto[]> {
  const query = folderId === undefined ? "" : `?folderId=${encodeURIComponent(folderId)}`;
  return request(`/api/notes${query}`);
}

export function getNote(id: number): Promise<NoteDetailDto> {
  return request(`/api/notes/${id}`);
}

export function listBacklinks(id: number): Promise<BacklinkDto[]> {
  return request(`/api/notes/${id}/backlinks`);
}

export function listNoteTitles(
  query: string,
  signal?: AbortSignal,
): Promise<NoteTitleDto[]> {
  return request(`/api/notes/titles?q=${encodeURIComponent(query)}&limit=20`, { signal });
}

export interface NoteInput {
  folderId: number;
  parentId: number | null;
  title: string;
  contentMd: string;
  tags: string[];
}

export interface NoteImageUpload {
  token: string;
  file: File;
}

function noteFormData(input: NoteInput, images: readonly NoteImageUpload[]): FormData {
  const formData = new FormData();
  formData.set("payload", JSON.stringify(input));

  for (const image of images) {
    if (input.contentMd.includes(`ruider-upload://${image.token}`)) {
      formData.append(`image:${image.token}`, image.file);
    }
  }

  return formData;
}

export function createNote(
  input: NoteInput,
  images: readonly NoteImageUpload[] = [],
): Promise<NoteDetailDto> {
  return request("/api/notes", {
    method: "POST",
    body: noteFormData(input, images),
  });
}

export function updateNote(
  id: number,
  input: NoteInput,
  images: readonly NoteImageUpload[] = [],
): Promise<NoteDetailDto> {
  return request(`/api/notes/${id}`, {
    method: "PATCH",
    body: noteFormData(input, images),
  });
}

export function reorderNote(id: number, position: number): Promise<NoteDetailDto> {
  const formData = new FormData();
  formData.set("payload", JSON.stringify({ position }));
  return request(`/api/notes/${id}`, { method: "PATCH", body: formData });
}

export function deleteNote(id: number): Promise<void> {
  return request(`/api/notes/${id}`, { method: "DELETE" });
}

export function listNoteTemplates(): Promise<NoteTemplateDto[]> {
  return request("/api/templates");
}

export function createNoteTemplate(input: {
  name: string;
  contentMd: string;
}): Promise<NoteTemplateDto> {
  return request("/api/templates", { method: "POST", ...jsonBody(input) });
}

export function updateNoteTemplate(
  id: number,
  input: { name?: string; contentMd?: string },
): Promise<NoteTemplateDto> {
  return request(`/api/templates/${id}`, {
    method: "PATCH",
    ...jsonBody(input),
  });
}

export function deleteNoteTemplate(id: number): Promise<void> {
  return request(`/api/templates/${id}`, { method: "DELETE" });
}

export function searchNotes(
  query: string,
  options: { limit?: number; offset?: number } = {},
): Promise<SearchResultsDto> {
  const params = new URLSearchParams({ q: query });
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  if (options.offset !== undefined) params.set("offset", String(options.offset));
  return request(`/api/search?${params}`);
}
