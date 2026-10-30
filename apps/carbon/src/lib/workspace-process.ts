export interface AppWorkspaceProcess {
  readonly key: "canvases" | "notes";
  readonly pathname: "/canvases" | "/notes";
  readonly scope: "canvases" | "notes";
  readonly legacyPageKinds: readonly ["Canvas"] | readonly ["Note"];
}

export const APP_WORKSPACE_PROCESSES: readonly AppWorkspaceProcess[] = [
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

export function appWorkspaceProcess(pathname: string): AppWorkspaceProcess | null {
  const normalizedPathname = pathname.endsWith("/") && pathname !== "/"
    ? pathname.slice(0, -1)
    : pathname;
  return APP_WORKSPACE_PROCESSES.find(
    (process) => process.pathname === normalizedPathname,
  ) ?? null;
}

export function isAppWorkspaceDestination(destination: string): boolean {
  try {
    return appWorkspaceProcess(
      new URL(destination, "http://babel.local").pathname,
    ) !== null;
  } catch {
    return false;
  }
}
