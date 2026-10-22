"use client";

import { useRouter } from "next/navigation";
import { useCommandPaletteItemSource } from "@babel-apps/platform/shortcuts/react";

import { listCanvases, listNoteTitles } from "@/lib/api-client";

function normalizedTitle(value: string): string {
  return value.normalize("NFKD").toLocaleLowerCase();
}

export function GlobalQuickOpenSource() {
  const router = useRouter();

  useCommandPaletteItemSource({
    id: "ruider.global-titles",
    label: "All notes and canvases",
    scope: "global",
    items: [],
    searchItems: async (query, signal) => {
      const [notes, canvases] = await Promise.all([
        listNoteTitles(query, signal),
        listCanvases(signal),
      ]);
      const normalizedQuery = normalizedTitle(query);
      return [
        ...notes.map((note) => ({
          id: `note:${note.id}`,
          dedupeKey: `ruider:note:${note.id}`,
          label: note.title,
          description: "Note",
          open: () => router.push(`/notes?note=${note.id}`),
        })),
        ...canvases
          .filter((canvas) => normalizedTitle(canvas.title).startsWith(normalizedQuery))
          .slice(0, 20)
          .map((canvas) => ({
            id: `canvas:${canvas.id}`,
            dedupeKey: `ruider:canvas:${canvas.id}`,
            label: canvas.title,
            description: "Canvas",
            open: () => router.push(`/canvases?canvas=${canvas.id}`),
          })),
      ];
    },
  });

  return null;
}
