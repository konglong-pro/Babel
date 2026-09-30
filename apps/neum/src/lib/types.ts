export type EntryKind = "knowledge" | "snippet";

export interface FolderDto {
  id: number;
  parentId: number | null;
  name: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface EntrySummaryDto {
  id: number;
  parentId: number | null;
  folderId: number;
  kind: EntryKind;
  title: string;
  tags: string[];
  version: number;
  position?: number;
  updatedAt: string;
}

export interface EntryDetailDto extends EntrySummaryDto {
  notesMd: string;
  code: string | null;
  language: string | null;
  filename: string | null;
  createdAt: string;
  links: EntryLinkDto[];
}

export interface EntryLinkDto {
  titleKey: string;
  targetId: number | null;
  targetKind: EntryKind | null;
}

export interface EntryBacklinkDto {
  id: number;
  folderId: number;
  kind: EntryKind;
  title: string;
}

export interface EntryTitleDto {
  id: number;
  kind: EntryKind;
  title: string;
}

export interface TagSummaryDto {
  id: number;
  name: string;
  entryCount: number;
}

export interface PaginatedDto<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export type EntrySearchField =
  | "title"
  | "tags"
  | "filename"
  | "language"
  | "notesMd"
  | "code";

export interface SearchTextPartDto {
  text: string;
  highlighted: boolean;
}

export interface SearchTagDto {
  value: string;
  parts: SearchTextPartDto[];
}

export interface SearchSnippetDto {
  field: EntrySearchField;
  parts: SearchTextPartDto[];
  truncatedStart: boolean;
  truncatedEnd: boolean;
}

export interface EntrySearchResultDto extends EntrySummaryDto {
  match: {
    matchedFields: EntrySearchField[];
    title: SearchTextPartDto[];
    tags: SearchTagDto[];
    snippet: SearchSnippetDto;
  };
}

export type SearchResultsDto = PaginatedDto<EntrySearchResultDto>;

export function entryImageUrl(imagePath: string): string {
  const fileName = imagePath.replaceAll("\\", "/").split("/").at(-1);
  return fileName ? `/api/uploads/entries/${encodeURIComponent(fileName)}` : "";
}

/** @deprecated Use entryImageUrl. */
export const noteImageUrl = entryImageUrl;
