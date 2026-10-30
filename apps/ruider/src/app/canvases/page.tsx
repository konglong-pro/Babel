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
  const newRequest = Array.isArray(params.new) ? params.new[0] : params.new;
  return (
    <CanvasWorkspace
      initialCanvasId={numberParam(params.canvas)}
      routeTargetKey={new URLSearchParams(Object.entries(params).flatMap(([key, value]) => {
        const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
        return values.map((item) => [key, item]);
      })).toString()}
      creationRequestKey={newRequest ?? null}
    />
  );
}
