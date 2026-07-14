export interface FolderDto {
  id: number;
  parentId: number | null;
  name: string;
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

export interface SearchResultsDto {
  notes: NoteSummaryDto[];
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

export type DocumentSearchResultDto =
  | ({ kind: "note" } & NoteSummaryDto)
  | ReflectionSummaryDto;

export interface DocumentSearchResultsDto {
  results: DocumentSearchResultDto[];
}

export function noteImageUrl(imagePath: string): string {
  const fileName = imagePath.replaceAll("\\", "/").split("/").at(-1);
  return fileName ? `/api/uploads/notes/${encodeURIComponent(fileName)}` : "";
}
