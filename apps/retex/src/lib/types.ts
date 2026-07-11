export const folderTypes = ["knowledge", "exercise"] as const;

export type FolderType = (typeof folderTypes)[number];

export interface FolderDto {
  id: number;
  parentId: number | null;
  type: FolderType;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface RelatedItemDto {
  id: number;
  title: string;
}

export interface KnowledgeSummaryDto {
  id: number;
  folderId: number;
  title: string;
  tags: string[];
  updatedAt: string;
}

export interface KnowledgeDetailDto extends KnowledgeSummaryDto {
  contentMd: string;
  createdAt: string;
  relatedExercises: RelatedItemDto[];
}

export interface ExerciseSummaryDto {
  id: number;
  folderId: number;
  title: string;
  imagePath: string;
  tags: string[];
  updatedAt: string;
}

export interface ExerciseDetailDto extends ExerciseSummaryDto {
  answerMd: string;
  solutionMd: string;
  createdAt: string;
  relatedKnowledge: RelatedItemDto[];
}

export interface ScratchSolutionDto {
  id: number;
  exerciseId: number;
  contentMd: string;
  updatedAt: string;
}

export interface SearchResultsDto {
  knowledge: KnowledgeSummaryDto[];
  exercises: ExerciseSummaryDto[];
}

export function imageUrl(imagePath: string): string {
  const fileName = imagePath.split("/").at(-1);
  return fileName ? `/api/uploads/exercises/${encodeURIComponent(fileName)}` : "";
}
