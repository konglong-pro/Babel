import type { Metadata } from "next";

import { EntryWorkspacePage } from "@/components/entry-workspace-page";

export const metadata: Metadata = {
  title: "Knowledge",
};

interface KnowledgePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default function KnowledgePage({ searchParams }: KnowledgePageProps) {
  return <EntryWorkspacePage kind="knowledge" searchParams={searchParams} />;
}
