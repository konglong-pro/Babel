import type { WorkspaceProcessPageMatcher } from "@babel-apps/platform/pages/react";

import type { FolderType } from "@/lib/types";

export type MatterWorkspaceProcess = "canvases" | FolderType | `scratch:${number}`;

export const MATTER_ARCHIVE_PROCESSES: readonly FolderType[] = [
  "knowledge",
  "exercise",
];

export function matterWorkspaceProcess(pathname: string): MatterWorkspaceProcess | null {
  const normalizedPathname = pathname.endsWith("/") && pathname !== "/"
    ? pathname.slice(0, -1)
    : pathname;
  const archiveProcess = MATTER_ARCHIVE_PROCESSES.find(
    (candidate) => normalizedPathname === `/${candidate}`,
  );
  if (archiveProcess !== undefined) return archiveProcess;
  if (normalizedPathname === "/canvases") return "canvases";

  const scratchMatch = /^\/exercise\/(\d+)\/scratch$/.exec(normalizedPathname);
  if (scratchMatch === null) return null;
  const exerciseId = Number(scratchMatch[1]);
  return Number.isInteger(exerciseId) && exerciseId > 0
    ? `scratch:${exerciseId}`
    : null;
}

export function matterWorkspaceRegistration(
  process: MatterWorkspaceProcess,
): WorkspaceProcessPageMatcher & { readonly key: MatterWorkspaceProcess } {
  if (process === "canvases") {
    return { key: process, scope: process, legacyPageKinds: ["Canvas"] };
  }
  if (process === "knowledge") {
    return { key: process, scope: process, legacyPageKinds: ["Knowledge"] };
  }
  if (process === "exercise") {
    return { key: process, scope: process, legacyPageKinds: ["Exercise"] };
  }
  return {
    key: process,
    scope: process,
    legacyPageKinds: ["Scratch"],
    legacyPageKeys: [process],
  };
}

export function scratchExerciseId(process: MatterWorkspaceProcess): number | null {
  if (!process.startsWith("scratch:")) return null;
  const exerciseId = Number(process.slice("scratch:".length));
  return Number.isInteger(exerciseId) && exerciseId > 0 ? exerciseId : null;
}

export function isMatterWorkspaceDestination(destination: string): boolean {
  try {
    return matterWorkspaceProcess(
      new URL(destination, "http://babel.local").pathname,
    ) !== null;
  } catch {
    return false;
  }
}
