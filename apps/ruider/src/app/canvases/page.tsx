import type { Metadata } from "next";

import { CanvasWorkspace } from "@/components/canvas-workspace";

export const metadata: Metadata = {
  title: "Canvases",
};

interface CanvasesPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function numberParam(value: string | string[] | undefined): number | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate) return null;
  const parsed = Number(candidate);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export default async function CanvasesPage({ searchParams }: CanvasesPageProps) {
  const params = await searchParams;
  return <CanvasWorkspace initialCanvasId={numberParam(params.canvas)} />;
}
