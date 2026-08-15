import { entryUnitLabel, entryUnitPath, type EntryUnitPath } from "@/lib/entry-routes";
import type { EntryKind } from "@/lib/types";

export interface NeumWorkspaceProcess {
  readonly key: EntryKind | "canvases";
  readonly pathname: EntryUnitPath | "/canvases";
  readonly scope: EntryKind | "canvases";
  readonly legacyPageKinds: readonly string[];
}

export const NEUM_WORKSPACE_PROCESSES: readonly NeumWorkspaceProcess[] = [
  {
    key: "canvases",
    pathname: "/canvases",
    scope: "canvases",
    legacyPageKinds: ["Canvas"],
  },
  {
    key: "knowledge",
    pathname: entryUnitPath("knowledge"),
    scope: "knowledge",
    legacyPageKinds: [entryUnitLabel("knowledge")],
  },
  {
    key: "snippet",
    pathname: entryUnitPath("snippet"),
    scope: "snippet",
    legacyPageKinds: [entryUnitLabel("snippet")],
  },
];

export function neumWorkspaceProcess(pathname: string): NeumWorkspaceProcess | null {
  return NEUM_WORKSPACE_PROCESSES.find((process) => process.pathname === pathname) ?? null;
}

export function neumWorkspaceProcessKind(pathname: string): EntryKind | null {
  const process = neumWorkspaceProcess(pathname)?.key;
  return process === "knowledge" || process === "snippet" ? process : null;
}

export function isNeumWorkspaceDestination(destination: string): boolean {
  const pathname = new URL(destination, "http://babel.local").pathname;
  return neumWorkspaceProcess(pathname) !== null;
}
