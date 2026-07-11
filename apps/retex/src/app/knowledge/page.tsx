import { ArchiveWorkspace } from "@/components/archive-workspace";

interface KnowledgePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function numberParam(value: string | string[] | undefined): number | null {
  const parsed = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export default async function KnowledgePage({ searchParams }: KnowledgePageProps) {
  const params = await searchParams;
  return (
    <ArchiveWorkspace
      type="knowledge"
      initialFolderId={numberParam(params.folder)}
      initialItemId={numberParam(params.item)}
    />
  );
}
