export interface FolderDto {
  id: number;
  parentId: number | null;
  name: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface NoteSummaryDto {
  id: number;
  folderId: number;
  parentId: number | null;
  title: string;
  tags: string[];
  updatedAt: string;
}

export interface NoteLinkDto {
  titleKey: string;
  targetId: number | null;
  targetKind?: "reflection";
  targetDate?: string;
}

export interface BacklinkDto {
  id: number;
  title: string;
  folderId: number;
}

export interface NoteTitleDto {
  id: number;
  title: string;
}

export type DocumentKind = "note" | "reflection";

export type DocumentBacklinkDto =
  | ({ kind: "note" } & BacklinkDto)
  | {
      kind: "reflection";
      date: string;
      title: string;
      updatedAt: string;
    };

export type DocumentTitleDto =
  | {
      kind: "note";
      id: number;
      title: string;
    }
  | {
      kind: "reflection";
      id: number;
      date: string;
      title: string;
    };

export interface NoteDetailDto extends NoteSummaryDto {
  contentMd: string;
  createdAt: string;
  links: NoteLinkDto[];
}

export interface NoteTemplateDto {
  id: number;
  name: string;
  contentMd: string;
  createdAt: string;
  updatedAt: string;
}

export interface SearchResultsDto {
  notes: NoteSummaryDto[];
  total: number;
  limit: number;
  offset: number;
}

export interface ReflectionSummaryDto {
  kind: "reflection";
  date: string;
  title: string;
  updatedAt: string;
}

export interface ReflectionDetailDto extends ReflectionSummaryDto {
  contentMd: string;
  createdAt: string;
  links: NoteLinkDto[];
}

export type DocumentSearchField = "title" | "content" | "tags";

export interface SearchTextPartDto {
  text: string;
  highlighted: boolean;
}

export interface SearchTagDto {
  value: string;
  parts: SearchTextPartDto[];
}

export interface SearchSnippetDto {
  field: DocumentSearchField;
  parts: SearchTextPartDto[];
  truncatedStart: boolean;
  truncatedEnd: boolean;
}

export interface DocumentSearchMatchDto {
  matchedFields: DocumentSearchField[];
  title: SearchTextPartDto[];
  tags: SearchTagDto[];
  snippet: SearchSnippetDto;
}

export type DocumentSearchResultDto =
  | ({ kind: "note"; match: DocumentSearchMatchDto } & NoteSummaryDto)
  | (ReflectionSummaryDto & { match: DocumentSearchMatchDto });

export interface DocumentSearchResultsDto {
  results: DocumentSearchResultDto[];
  total: number;
  limit: number;
  offset: number;
}

export function noteImageUrl(imagePath: string): string {
  const fileName = imagePath.replaceAll("\\", "/").split("/").at(-1);
  return fileName ? `/api/uploads/notes/${encodeURIComponent(fileName)}` : "";
}
