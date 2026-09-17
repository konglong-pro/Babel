import type { Metadata } from "next";

import { CanvasWorkspace } from "@/components/canvas-workspace";

export const metadata: Metadata = { title: "Canvases" };

interface CanvasesPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function positiveInteger(value: string | string[] | undefined): number | null {
  const candidate = firstParam(value);
  if (!candidate) return null;
  const parsed = Number(candidate);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export default async function CanvasesPage({ searchParams }: CanvasesPageProps) {
  const params = await searchParams;
  return (
    <CanvasWorkspace
      initialCanvasId={positiveInteger(params.canvas)}
      routeTargetKey={new URLSearchParams(Object.entries(params).flatMap(([key, value]) => {
        const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
        return values.map((item) => [key, item]);
      })).toString()}
      creationRequestKey={firstParam(params.new) ?? null}
    />
  );
}

