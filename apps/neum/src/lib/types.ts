export type EntryKind = "knowledge" | "snippet";

export interface FolderDto {
  id: number;
  parentId: number | null;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface EntrySummaryDto {
  id: number;
  folderId: number;
  kind: EntryKind;
  title: string;
  tags: string[];
  version: number;
  updatedAt: string;
}

export interface EntryDetailDto extends EntrySummaryDto {
  notesMd: string;
  code: string | null;
  language: string | null;
  filename: string | null;
  createdAt: string;
}

export interface TagSummaryDto {
  id: number;
  name: string;
  entryCount: number;
}

export interface TrashEntryDto extends EntryDetailDto {
  trashId: number;
  deletedAt: string;
  imagePaths: string[];
}

export interface PaginatedDto<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export type SearchResultsDto = PaginatedDto<EntrySummaryDto>;

export function entryImageUrl(imagePath: string): string {
  const fileName = imagePath.replaceAll("\\", "/").split("/").at(-1);
  return fileName ? `/api/uploads/entries/${encodeURIComponent(fileName)}` : "";
}

/** @deprecated Use entryImageUrl. */
export const noteImageUrl = entryImageUrl;
