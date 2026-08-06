import type { StagedImage } from "@babel-apps/markdown/react";

import type {
  BacklinksDto,
  ExerciseDetailDto,
  ExerciseSummaryDto,
  FolderDto,
  FolderType,
  KnowledgeDetailDto,
  KnowledgeSummaryDto,
  NoteTitleDto,
  ScratchSolutionDto,
  SearchResultsDto,
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
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const body = (await response.json().catch(() => null)) as T | ApiErrorBody | null;
  if (!response.ok) {
    const error = (body as ApiErrorBody | null)?.error;
    throw new ApiError(
      error?.message ?? `Request failed (${response.status})`,
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

function markdownMutationBody(
  value: unknown,
  stagedImages: readonly StagedImage[],
): Pick<RequestInit, "body"> {
  if (stagedImages.length === 0) return jsonBody(value);

  const formData = new FormData();
  formData.set("payload", JSON.stringify(value));
  for (const image of stagedImages) {
    formData.set(`image:${image.token}`, image.file);
  }
  return { body: formData };
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "An unknown error occurred. Please try again.";
}

export function listFolders(type: FolderType): Promise<FolderDto[]> {
  return request(`/api/folders?type=${encodeURIComponent(type)}`);
}

export function createFolder(input: {
  type: FolderType;
  parentId: number | null;
  name: string;
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

export function listKnowledge(folderId?: number): Promise<KnowledgeSummaryDto[]> {
  const query = folderId === undefined ? "" : `?folderId=${folderId}`;
  return request(`/api/knowledge${query}`);
}

export function getKnowledge(id: number): Promise<KnowledgeDetailDto> {
  return request(`/api/knowledge/${id}`);
}

export function getKnowledgeBacklinks(id: number): Promise<BacklinksDto> {
  return request(`/api/knowledge/${id}/backlinks`);
}

export interface KnowledgeInput {
  folderId: number;
  parentId: number | null;
  title: string;
  contentMd: string;
  tags: string[];
  exerciseIds: number[];
}

export function createKnowledge(
  input: KnowledgeInput,
  stagedImages: readonly StagedImage[] = [],
): Promise<KnowledgeDetailDto> {
  return request("/api/knowledge", {
    method: "POST",
    ...markdownMutationBody(input, stagedImages),
  });
}

export function updateKnowledge(
  id: number,
  input: KnowledgeInput,
  stagedImages: readonly StagedImage[] = [],
): Promise<KnowledgeDetailDto> {
  return request(`/api/knowledge/${id}`, {
    method: "PATCH",
    ...markdownMutationBody(input, stagedImages),
  });
}

export function reorderKnowledge(id: number, position: number): Promise<KnowledgeDetailDto> {
  return request(`/api/knowledge/${id}`, {
    method: "PATCH",
    ...jsonBody({ position }),
  });
}

export function deleteKnowledge(id: number): Promise<void> {
  return request(`/api/knowledge/${id}`, { method: "DELETE" });
}

export function listExercises(folderId?: number): Promise<ExerciseSummaryDto[]> {
  const query = folderId === undefined ? "" : `?folderId=${folderId}`;
  return request(`/api/exercises${query}`);
}

export function getExercise(id: number): Promise<ExerciseDetailDto> {
  return request(`/api/exercises/${id}`);
}

export function getExerciseBacklinks(id: number): Promise<BacklinksDto> {
  return request(`/api/exercises/${id}/backlinks`);
}

export interface ExerciseInput {
  folderId: number;
  title: string;
  problemMd: string;
  answerMd: string;
  solutionMd: string;
  tags: string[];
  knowledgeIds: number[];
}

export function createExercise(
  input: ExerciseInput,
  stagedImages: readonly StagedImage[] = [],
): Promise<ExerciseDetailDto> {
  return request("/api/exercises", {
    method: "POST",
    ...markdownMutationBody(input, stagedImages),
  });
}

export function updateExercise(
  id: number,
  input: ExerciseInput,
  stagedImages: readonly StagedImage[] = [],
): Promise<ExerciseDetailDto> {
  return request(`/api/exercises/${id}`, {
    method: "PATCH",
    ...markdownMutationBody(input, stagedImages),
  });
}

export function reorderExercise(id: number, position: number): Promise<ExerciseDetailDto> {
  return request(`/api/exercises/${id}`, {
    method: "PATCH",
    ...jsonBody({ position }),
  });
}

export function deleteExercise(id: number): Promise<void> {
  return request(`/api/exercises/${id}`, { method: "DELETE" });
}

export async function getScratch(exerciseId: number): Promise<ScratchSolutionDto | null> {
  try {
    return await request(`/api/exercises/${exerciseId}/scratch`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export function saveScratch(
  exerciseId: number,
  contentMd: string,
): Promise<ScratchSolutionDto> {
  return request(`/api/exercises/${exerciseId}/scratch`, {
    method: "PUT",
    ...jsonBody({ contentMd }),
  });
}

export function deleteScratch(exerciseId: number): Promise<void> {
  return request(`/api/exercises/${exerciseId}/scratch`, { method: "DELETE" });
}

export function searchArchive(
  query: string,
  options: {
    limit?: number;
    knowledgeOffset?: number;
    exerciseOffset?: number;
  } = {},
): Promise<SearchResultsDto> {
  const params = new URLSearchParams({ q: query });
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  if (options.knowledgeOffset !== undefined) {
    params.set("knowledgeOffset", String(options.knowledgeOffset));
  }
  if (options.exerciseOffset !== undefined) {
    params.set("exerciseOffset", String(options.exerciseOffset));
  }
  return request(`/api/search?${params}`);
}

export function listNoteTitles(
  query: string,
  signal?: AbortSignal,
): Promise<NoteTitleDto[]> {
  return request(`/api/titles?q=${encodeURIComponent(query)}`, { signal });
}
