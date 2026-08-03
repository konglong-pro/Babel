"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, type ReactNode, useMemo } from "react";
import { NextPageTabs } from "@babel-apps/platform/pages/next";
import { WorkspaceProcessHost } from "@babel-apps/platform/pages/react";
import { searchFocusFromParams, type SearchFocus } from "@babel-apps/platform/search/focus";

import { NotesWorkspace } from "@/components/notes-workspace";
import type { NoteSearchField } from "@/lib/types";
import {
  APP_WORKSPACE_PROCESSES,
  appWorkspaceProcess,
} from "@/lib/workspace-process";

interface NotesRouteTarget {
  readonly folderId: number | null;
  readonly noteId: number | null;
  readonly searchFocus: SearchFocus<NoteSearchField> | null;
  readonly key: string;
}

const NOTE_SEARCH_FIELDS = new Set<NoteSearchField>([
  "title",
  "content",
  "tags",
]);

function positiveInteger(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function AppPageTabs() {
  return <NextPageTabs />;
}

export function AppWorkspaceProcessHost({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={children}>
      <AppWorkspaceProcessRuntime>{children}</AppWorkspaceProcessRuntime>
    </Suspense>
  );
}

function AppWorkspaceProcessRuntime({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeProcess = appWorkspaceProcess(pathname);
  const routeTarget = useMemo<NotesRouteTarget>(() => {
    const params = Object.fromEntries(searchParams.entries());
    const noteId = positiveInteger(searchParams.get("note"));
    return {
      folderId: positiveInteger(searchParams.get("folder")),
      noteId,
      searchFocus: noteId === null
        ? null
        : searchFocusFromParams(params, NOTE_SEARCH_FIELDS),
      key: searchParams.toString(),
    };
  }, [searchParams]);

  return (
    <WorkspaceProcessHost
      activeProcess={activeProcess?.key ?? null}
      processes={APP_WORKSPACE_PROCESSES.map((process) => ({
        ...process,
        content: (
          <NotesWorkspace
            initialFolderId={routeTarget.folderId}
            initialNoteId={routeTarget.noteId}
            initialSearchFocus={routeTarget.searchFocus}
            routeTargetKey={routeTarget.key}
          />
        ),
      }))}
    >
      {children}
    </WorkspaceProcessHost>
  );
}
