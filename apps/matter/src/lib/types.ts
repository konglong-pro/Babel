export const folderTypes = ["knowledge", "exercise"] as const;

export type FolderType = (typeof folderTypes)[number];

export const linkEntityKinds = ["knowledge", "exercise"] as const;

export type LinkEntityKind = (typeof linkEntityKinds)[number];

export interface NoteLinkDto {
  titleKey: string;
  targetId: number | null;
  targetKind: LinkEntityKind | null;
}

export interface NoteTitleDto {
  id: number;
  title: string;
  kind: LinkEntityKind;
}

export interface BacklinkDto {
  id: number;
  title: string;
  folderId: number;
}

export interface BacklinksDto {
  knowledge: BacklinkDto[];
  exercises: BacklinkDto[];
}

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
  parentId: number | null;
  folderId: number;
  title: string;
  tags: string[];
  updatedAt: string;
}

export interface KnowledgeDetailDto extends KnowledgeSummaryDto {
  contentMd: string;
  createdAt: string;
  relatedExercises: RelatedItemDto[];
  links: NoteLinkDto[];
}

export interface ExerciseSummaryDto {
  id: number;
  folderId: number;
  title: string;
  tags: string[];
  updatedAt: string;
}

export interface ExerciseDetailDto extends ExerciseSummaryDto {
  problemMd: string;
  answerMd: string;
  solutionMd: string;
  createdAt: string;
  relatedKnowledge: RelatedItemDto[];
  links: NoteLinkDto[];
}

export interface ScratchSolutionDto {
  id: number;
  exerciseId: number;
  contentMd: string;
  updatedAt: string;
}

export type KnowledgeSearchField = "title" | "content" | "tags";
export type ExerciseSearchField =
  | "title"
  | "problem"
  | "answer"
  | "solution"
  | "tags";
export type SearchField = KnowledgeSearchField | ExerciseSearchField;

export interface SearchTextPartDto {
  text: string;
  highlighted: boolean;
}

export interface SearchTagDto {
  value: string;
  parts: SearchTextPartDto[];
}

export interface SearchSnippetDto<TField extends SearchField = SearchField> {
  field: TField;
  parts: SearchTextPartDto[];
  truncatedStart: boolean;
  truncatedEnd: boolean;
}

export interface SearchMatchDto<TField extends SearchField = SearchField> {
  matchedFields: TField[];
  title: SearchTextPartDto[];
  tags: SearchTagDto[];
  snippet: SearchSnippetDto<TField>;
}

export interface KnowledgeSearchResultDto extends KnowledgeSummaryDto {
  match: SearchMatchDto<KnowledgeSearchField>;
}

export interface ExerciseSearchResultDto extends ExerciseSummaryDto {
  match: SearchMatchDto<ExerciseSearchField>;
}

export interface SearchResultsDto {
  knowledge: KnowledgeSearchResultDto[];
  exercises: ExerciseSearchResultDto[];
  knowledgeTotal: number;
  exerciseTotal: number;
  limit: number;
  knowledgeOffset: number;
  exerciseOffset: number;
}

export function noteImageUrl(imagePath: string): string {
  const fileName = imagePath.split("/").at(-1);
  return fileName ? `/api/uploads/notes/${encodeURIComponent(fileName)}` : "";
}
