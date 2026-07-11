import type {
  ExerciseDetailDto,
  ExerciseSummaryDto,
  FolderDto,
  FolderType,
  KnowledgeDetailDto,
  KnowledgeSummaryDto,
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

export function listKnowledge(folderId?: number): Promise<KnowledgeSummaryDto[]> {
  const query = folderId === undefined ? "" : `?folderId=${folderId}`;
  return request(`/api/knowledge${query}`);
}

export function getKnowledge(id: number): Promise<KnowledgeDetailDto> {
  return request(`/api/knowledge/${id}`);
}

export interface KnowledgeInput {
  folderId: number;
  title: string;
  contentMd: string;
  tags: string[];
  exerciseIds: number[];
}

export function createKnowledge(input: KnowledgeInput): Promise<KnowledgeDetailDto> {
  return request("/api/knowledge", { method: "POST", ...jsonBody(input) });
}

export function updateKnowledge(
  id: number,
  input: KnowledgeInput,
): Promise<KnowledgeDetailDto> {
  return request(`/api/knowledge/${id}`, { method: "PATCH", ...jsonBody(input) });
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

export interface ExerciseInput {
  folderId: number;
  title: string;
  imagePath: string;
  answerMd: string;
  solutionMd: string;
  tags: string[];
  knowledgeIds: number[];
}

export function createExercise(input: ExerciseInput): Promise<ExerciseDetailDto> {
  return request("/api/exercises", { method: "POST", ...jsonBody(input) });
}

export function updateExercise(
  id: number,
  input: ExerciseInput,
): Promise<ExerciseDetailDto> {
  return request(`/api/exercises/${id}`, { method: "PATCH", ...jsonBody(input) });
}

export function deleteExercise(id: number): Promise<void> {
  return request(`/api/exercises/${id}`, { method: "DELETE" });
}

export function uploadExerciseImage(
  file: File,
): Promise<{ imagePath: string; url: string }> {
  const formData = new FormData();
  formData.set("file", file);
  return request("/api/uploads/exercises", { method: "POST", body: formData });
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

export function searchArchive(query: string): Promise<SearchResultsDto> {
  return request(`/api/search?q=${encodeURIComponent(query)}`);
}
