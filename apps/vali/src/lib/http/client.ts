import type {
  Category,
  CategoryPatch,
  CreateEntryInput,
  Entry,
  EntryPatch,
  ImportResult,
  Reflection,
  SearchResult,
} from "../vali/types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload.error === "string" ? payload.error : "Request failed";
    throw new Error(message);
  }
  return payload as T;
}

export const api = {
  listCategories: () => request<Category[]>("/api/categories"),
  createCategory: (name: string) =>
    request<Category>("/api/categories", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  patchCategory: (id: string, updates: CategoryPatch) =>
    request<Category>(`/api/categories/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    }),
  deleteCategory: (id: string) =>
    request<{ ok: true }>(`/api/categories/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  listEntries: (categoryId?: string) => {
    const query = categoryId ? `?categoryId=${encodeURIComponent(categoryId)}` : "";
    return request<Entry[]>(`/api/entries${query}`);
  },
  getEntry: (id: string) => request<Entry>(`/api/entries/${encodeURIComponent(id)}`),
  createEntry: (data: CreateEntryInput) =>
    request<Entry>("/api/entries", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  patchEntry: (id: string, updates: EntryPatch) =>
    request<Entry>(`/api/entries/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    }),
  deleteEntry: (id: string) =>
    request<{ ok: true }>(`/api/entries/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  search: (query: string) => request<SearchResult[]>(`/api/search?q=${encodeURIComponent(query)}`),
  importEntries: (categoryId: string, items: string[]) =>
    request<ImportResult>("/api/import", {
      method: "POST",
      body: JSON.stringify({ categoryId, items }),
    }),
  listReflections: () => request<string[]>("/api/reflections"),
  getReflection: (date: string) => request<Reflection>(`/api/reflections/${encodeURIComponent(date)}`),
  saveReflection: (date: string, content: string) =>
    request<Reflection>(`/api/reflections/${encodeURIComponent(date)}`, {
      method: "PATCH",
      body: JSON.stringify({ content }),
    }),
};
