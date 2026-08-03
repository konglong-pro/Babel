export interface AppWorkspaceProcess {
  readonly key: "notes";
  readonly pathname: "/notes";
  readonly scope: "notes";
  readonly legacyPageKinds: readonly ["Note"];
}

export const APP_WORKSPACE_PROCESSES: readonly AppWorkspaceProcess[] = [{
  key: "notes",
  pathname: "/notes",
  scope: "notes",
  legacyPageKinds: ["Note"],
}];

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
