import type { Metadata } from "next";

import { ReflectionWorkspace } from "@/components/reflection-workspace";

export const metadata: Metadata = {
  title: "Reflection",
};

interface ReflectionPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ReflectionPage({ searchParams }: ReflectionPageProps) {
  const params = await searchParams;
  const rawDate = Array.isArray(params.date) ? params.date[0] : params.date;
  const initialDate = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
    ? rawDate
    : null;
  return <ReflectionWorkspace initialDate={initialDate} />;
}
