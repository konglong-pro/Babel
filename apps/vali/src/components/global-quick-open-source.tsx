"use client";

import { useRouter } from "next/navigation";
import { useCommandPaletteItemSource } from "@babel-apps/platform/shortcuts/react";

import { listNoteTitles } from "@/lib/api-client";

export function GlobalQuickOpenSource() {
  const router = useRouter();

  useCommandPaletteItemSource({
    id: "vali.global-titles",
    label: "All notes and reflections",
    scope: "global",
    items: [],
    searchItems: async (query, signal) => (await listNoteTitles(query, signal)).map((document) => ({
      id: document.kind === "note" ? `note:${document.id}` : `reflection:${document.date}`,
      dedupeKey: document.kind === "note"
        ? `vali:note:${document.id}`
        : `vali:reflection:${document.date}`,
      label: document.title,
      description: document.kind === "note" ? "Note" : "Reflection",
      open: () => router.push(document.kind === "note"
        ? `/notes?note=${document.id}`
        : `/reflection?date=${encodeURIComponent(document.date)}`),
    })),
  });

  return null;
}
