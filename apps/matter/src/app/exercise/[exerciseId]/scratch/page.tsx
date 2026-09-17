import { notFound } from "next/navigation";

import { ScratchWorkspace } from "@/components/scratch-workspace";

interface ScratchPageProps {
  params: Promise<{ exerciseId: string }>;
}

export default async function ScratchPage({ params }: ScratchPageProps) {
  const { exerciseId } = await params;
  const id = Number(exerciseId);
  if (!Number.isInteger(id) || id <= 0) notFound();
  return <ScratchWorkspace exerciseId={id} />;
}
