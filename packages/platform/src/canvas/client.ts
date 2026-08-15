import type {
  CanvasApiClient,
  CanvasDetail,
  CanvasScene,
  CanvasSummary,
} from "./core";

interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
}

class CanvasApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code = "REQUEST_FAILED",
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "CanvasApiError";
  }
}

export function createCanvasFetchApiClient(basePath = "/api/canvases"): CanvasApiClient {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(path, {
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
    if (response.status === 204) return undefined as T;
    const body = await response.json().catch(() => null) as T | ApiErrorBody | null;
    if (!response.ok) {
      const error = (body as ApiErrorBody | null)?.error;
      throw new CanvasApiError(
        error?.message ?? `Request failed (${response.status}).`,
        response.status,
        error?.code,
        error?.details,
      );
    }
    return body as T;
  }

  return {
    list(signal?: AbortSignal): Promise<CanvasSummary[]> {
      return request(basePath, { signal });
    },
    get(id: number, signal?: AbortSignal): Promise<CanvasDetail> {
      return request(`${basePath}/${id}`, { signal });
    },
    create(title: string): Promise<CanvasDetail> {
      return request(basePath, { method: "POST", body: JSON.stringify({ title }) });
    },
    update(id: number, input: { title?: string; scene?: CanvasScene }): Promise<CanvasDetail> {
      return request(`${basePath}/${id}`, { method: "PATCH", body: JSON.stringify(input) });
    },
    delete(id: number): Promise<void> {
      return request(`${basePath}/${id}`, { method: "DELETE" });
    },
    errorMessage(error: unknown): string {
      return error instanceof Error ? error.message : "An unknown error occurred. Please try again.";
    },
  };
}
