"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, type ReactNode, useMemo } from "react";
import { NextPageTabs } from "@babel-apps/platform/pages/next";
import { WorkspaceProcessHost } from "@babel-apps/platform/pages/react";

import { EntriesWorkspace } from "@/components/entries-workspace";
import { entrySearchFocusFromParams, type EntrySearchFocus } from "@/lib/search-focus";
import {
  NEUM_WORKSPACE_PROCESSES,
  neumWorkspaceProcess,
} from "@/lib/workspace-process";

interface NeumWorkspaceRouteTarget {
  readonly folderId: number | null;
  readonly entryId: number | null;
  readonly searchFocus: EntrySearchFocus | null;
  readonly key: string;
}

const EMPTY_ROUTE_TARGET: NeumWorkspaceRouteTarget = {
  folderId: null,
  entryId: null,
  searchFocus: null,
  key: "",
};

function positiveInteger(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function NeumPageTabs() {
  return <NextPageTabs />;
}

export function NeumWorkspaceProcessHost({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={children}>
      <NeumWorkspaceProcessRuntime>{children}</NeumWorkspaceProcessRuntime>
    </Suspense>
  );
}

function NeumWorkspaceProcessRuntime({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeProcess = neumWorkspaceProcess(pathname);
  const routeTarget = useMemo<NeumWorkspaceRouteTarget>(() => {
    const params = Object.fromEntries(searchParams.entries());
    return {
      folderId: positiveInteger(searchParams.get("folder")),
      entryId: positiveInteger(searchParams.get("entry")),
      searchFocus: entrySearchFocusFromParams(params),
      key: searchParams.toString(),
    };
  }, [searchParams]);

  return (
    <WorkspaceProcessHost
      activeProcess={activeProcess?.key ?? null}
      processes={NEUM_WORKSPACE_PROCESSES.map((process) => {
        const target = process.key === activeProcess?.key
          ? routeTarget
          : EMPTY_ROUTE_TARGET;
        return {
          ...process,
          content: (
            <EntriesWorkspace
              kind={process.key}
              initialFolderId={target.folderId}
              initialEntryId={target.entryId}
              initialSearchFocus={target.searchFocus}
              routeTargetKey={target.key}
            />
          ),
        };
      })}
    >
      {children}
    </WorkspaceProcessHost>
  );
}
