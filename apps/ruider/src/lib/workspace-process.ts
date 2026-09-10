import type { WorkspaceProcessPageMatcher } from "@babel-apps/platform/pages/react";

export type RuiderWorkspaceProcess = "canvases" | "notes";

export interface RuiderWorkspaceRegistration extends WorkspaceProcessPageMatcher {
  readonly key: RuiderWorkspaceProcess;
  readonly pathname: `/${RuiderWorkspaceProcess}`;
}

export const RUIDER_WORKSPACE_PROCESSES: readonly RuiderWorkspaceRegistration[] = [
  {
    key: "canvases",
    pathname: "/canvases",
    scope: "canvases",
    legacyPageKinds: ["Canvas"],
  },
  {
    key: "notes",
    pathname: "/notes",
    scope: "notes",
    legacyPageKinds: ["Note"],
  },
];

export function ruiderWorkspaceProcess(pathname: string): RuiderWorkspaceProcess | null {
  const normalizedPathname = pathname.endsWith("/") && pathname !== "/"
    ? pathname.slice(0, -1)
    : pathname;
  return RUIDER_WORKSPACE_PROCESSES.find(
    (process) => process.pathname === normalizedPathname,
  )?.key ?? null;
}

export function ruiderWorkspaceRegistration(
  process: RuiderWorkspaceProcess,
): RuiderWorkspaceRegistration {
  const registration = RUIDER_WORKSPACE_PROCESSES.find(
    (candidate) => candidate.key === process,
  );
  if (registration === undefined) {
    throw new Error(`Unknown Ruider workspace process: ${process}`);
  }
  return registration;
}

export function isRuiderWorkspaceDestination(destination: string): boolean {
  try {
    return ruiderWorkspaceProcess(
      new URL(destination, "http://babel.local").pathname,
    ) !== null;
  } catch {
    return false;
  }
}
