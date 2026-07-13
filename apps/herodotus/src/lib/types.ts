export interface FolderDto {
  id: number;
  parentId: number | null;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface NoteSummaryDto {
  id: number;
  parentId: number | null;
  folderId: number;
  title: string;
  tags: string[];
  updatedAt: string;
}

export interface NoteDetailDto extends NoteSummaryDto {
  contentMd: string;
  createdAt: string;
  links: NoteLinkDto[];
}

export interface NoteLinkDto {
  titleKey: string;
  targetId: number | null;
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

export interface SearchResultsDto {
  notes: NoteSummaryDto[];
}

export function noteImageUrl(imagePath: string): string {
  const fileName = imagePath.replaceAll("\\", "/").split("/").at(-1);
  return fileName ? `/api/uploads/notes/${encodeURIComponent(fileName)}` : "";
}
