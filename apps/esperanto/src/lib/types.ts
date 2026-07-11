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
  title: string;
  tags: string[];
  updatedAt: string;
}

export interface NoteDetailDto extends NoteSummaryDto {
  contentMd: string;
  createdAt: string;
}

export interface SearchResultsDto {
  notes: NoteSummaryDto[];
}

export function noteImageUrl(imagePath: string): string {
  const fileName = imagePath.replaceAll("\\", "/").split("/").at(-1);
  return fileName ? `/api/uploads/notes/${encodeURIComponent(fileName)}` : "";
}
