import { ArchiveWorkspace } from "@/components/archive-workspace";
import { archiveSearchFocusFromParams } from "@/lib/search-focus";

interface ExercisePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function numberParam(value: string | string[] | undefined): number | null {
  const parsed = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export default async function ExercisePage({ searchParams }: ExercisePageProps) {
  const params = await searchParams;
  const itemId = numberParam(params.item);
  const searchFocus = itemId === null
    ? null
    : archiveSearchFocusFromParams(params, "exercise");
  return (
    <ArchiveWorkspace
      type="exercise"
      initialFolderId={numberParam(params.folder)}
      initialItemId={itemId}
      initialSearchFocus={searchFocus}
    />
  );
}
