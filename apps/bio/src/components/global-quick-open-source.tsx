"use client";

import { useRouter } from "next/navigation";
import { useCommandPaletteItemSource } from "@babel-apps/platform/shortcuts/react";

import { listNoteTitles } from "@/lib/api-client";

export function GlobalQuickOpenSource() {
  const router = useRouter();

  useCommandPaletteItemSource({
    id: "bio.global-titles",
    label: "All notes",
    scope: "global",
    items: [],
    searchItems: async (query, signal) => (await listNoteTitles(query, signal)).map((note) => ({
      id: `note:${note.id}`,
      dedupeKey: `bio:note:${note.id}`,
      label: note.title,
      description: "Note",
      open: () => router.push(`/notes?note=${note.id}`),
    })),
  });

  return null;
}
