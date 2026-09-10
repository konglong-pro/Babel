import type { Metadata } from "next";

import { EntryWorkspacePage } from "@/components/entry-workspace-page";

export const metadata: Metadata = {
  title: "Code",
};

interface CodePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default function CodePage({ searchParams }: CodePageProps) {
  return <EntryWorkspacePage kind="snippet" searchParams={searchParams} />;
}
