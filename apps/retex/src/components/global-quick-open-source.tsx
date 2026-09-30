"use client";

import { useRouter } from "next/navigation";
import { useCommandPaletteItemSource } from "@babel-apps/platform/shortcuts/react";

import { listNoteTitles } from "@/lib/api-client";

export function GlobalQuickOpenSource() {
  const router = useRouter();

  useCommandPaletteItemSource({
    id: "retex.global-titles",
    label: "All knowledge and exercises",
    scope: "global",
    items: [],
    searchItems: async (query, signal) => (await listNoteTitles(query, signal)).map((item) => ({
      id: `${item.kind}:${item.id}`,
      dedupeKey: `retex:${item.kind}:${item.id}`,
      label: item.title,
      description: item.kind === "knowledge" ? "Knowledge" : "Exercise",
      open: () => router.push(`/${item.kind}?item=${item.id}`),
    })),
  });

  return null;
}
