"use client";

import { useRouter } from "next/navigation";
import { useCommandPaletteItemSource } from "@babel-apps/platform/shortcuts/react";

import { listEntryTitles } from "@/lib/api-client";
import { entryUnitLabel, entryWorkspaceHref } from "@/lib/entry-routes";

export function GlobalQuickOpenSource() {
  const router = useRouter();

  useCommandPaletteItemSource({
    id: "neum.global-titles",
    label: "All knowledge and code entries",
    scope: "global",
    items: [],
    searchItems: async (query, signal) => (await listEntryTitles(query, signal)).map((entry) => ({
      id: `${entry.kind}:${entry.id}`,
      dedupeKey: `neum:${entry.kind}:${entry.id}`,
      label: entry.title,
      description: entryUnitLabel(entry.kind),
      open: () => router.push(entryWorkspaceHref(entry.kind, { entryId: entry.id })),
    })),
  });

  return null;
}
