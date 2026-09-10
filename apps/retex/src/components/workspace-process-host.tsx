"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, type ReactNode, useMemo } from "react";
import { NextPageTabs } from "@babel-apps/platform/pages/next";
import {
  WorkspaceProcessHost,
  type WorkspaceProcessDefinition,
} from "@babel-apps/platform/pages/react";

import { ArchiveWorkspace } from "@/components/archive-workspace";
import { CanvasWorkspace } from "@/components/canvas-workspace";
import { ScratchWorkspace } from "@/components/scratch-workspace";
import {
  archiveSearchFocusFromParams,
  type ArchiveSearchFocus,
} from "@/lib/search-focus";
import {
  RETEX_ARCHIVE_PROCESSES,
  retexWorkspaceProcess,
  retexWorkspaceRegistration,
  scratchExerciseId,
} from "@/lib/workspace-process";

interface ArchiveRouteTarget {
  readonly folderId: number | null;
  readonly itemId: number | null;
  readonly searchFocus: ArchiveSearchFocus | null;
  readonly key: string;
}

const EMPTY_ARCHIVE_TARGET: ArchiveRouteTarget = {
  folderId: null,
  itemId: null,
  searchFocus: null,
  key: "",
};

function positiveInteger(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function RetexPageTabs() {
  return <NextPageTabs />;
}

export function RetexWorkspaceProcessHost({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={children}>
      <RetexWorkspaceProcessRuntime>{children}</RetexWorkspaceProcessRuntime>
    </Suspense>
  );
}

function RetexWorkspaceProcessRuntime({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeProcess = retexWorkspaceProcess(pathname);
  const archiveTarget = useMemo<ArchiveRouteTarget>(() => {
    const params = Object.fromEntries(searchParams.entries());
    const archiveType = activeProcess === "knowledge" || activeProcess === "exercise"
      ? activeProcess
      : null;
    return {
      folderId: positiveInteger(searchParams.get("folder")),
      itemId: positiveInteger(searchParams.get("item")),
      searchFocus: archiveType === null
        ? null
        : archiveSearchFocusFromParams(params, archiveType),
      key: searchParams.toString(),
    };
  }, [activeProcess, searchParams]);
  const processes: WorkspaceProcessDefinition[] = RETEX_ARCHIVE_PROCESSES.map((type) => {
    const target = type === activeProcess ? archiveTarget : EMPTY_ARCHIVE_TARGET;
    return {
      ...retexWorkspaceRegistration(type),
      content: (
        <ArchiveWorkspace
          type={type}
          initialFolderId={target.folderId}
          initialItemId={target.itemId}
          initialSearchFocus={target.searchFocus}
          routeTargetKey={target.key}
        />
      ),
    };
  });
  processes.push({
    ...retexWorkspaceRegistration("canvases"),
    content: (
      <CanvasWorkspace
        initialCanvasId={activeProcess === "canvases"
          ? positiveInteger(searchParams.get("canvas"))
          : null}
        routeTargetKey={activeProcess === "canvases" ? searchParams.toString() : ""}
        creationRequestKey={activeProcess === "canvases" ? searchParams.get("new") : null}
      />
    ),
  });
  const exerciseId = activeProcess === null ? null : scratchExerciseId(activeProcess);
  if (exerciseId !== null && activeProcess !== null) {
    processes.push({
      ...retexWorkspaceRegistration(activeProcess),
      content: <ScratchWorkspace exerciseId={exerciseId} />,
    });
  }

  return (
    <WorkspaceProcessHost
      activeProcess={activeProcess}
      processes={processes}
    >
      {children}
    </WorkspaceProcessHost>
  );
}
