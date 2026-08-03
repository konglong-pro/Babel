import type { WorkspaceProcessPageMatcher } from "@babel-apps/platform/pages/react";

export type ValiWorkspaceProcess = "notes" | "reflection";

export const VALI_WORKSPACE_PROCESSES: readonly ValiWorkspaceProcess[] = [
  "notes",
  "reflection",
];

export function valiWorkspaceProcess(pathname: string): ValiWorkspaceProcess | null {
  const normalizedPathname = pathname.endsWith("/") && pathname !== "/"
    ? pathname.slice(0, -1)
    : pathname;
  if (normalizedPathname === "/notes") return "notes";
  if (normalizedPathname === "/reflection") return "reflection";
  return null;
}

export function valiWorkspaceRegistration(
  process: ValiWorkspaceProcess,
): WorkspaceProcessPageMatcher & { readonly key: ValiWorkspaceProcess } {
  return process === "notes"
    ? { key: process, scope: process, legacyPageKinds: ["Note"] }
    : { key: process, scope: process, legacyPageKinds: ["Reflection"] };
}

export function isValiWorkspaceDestination(destination: string): boolean {
  try {
    return valiWorkspaceProcess(
      new URL(destination, "http://babel.local").pathname,
    ) !== null;
  } catch {
    return false;
  }
}
