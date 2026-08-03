"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, type ReactNode, useMemo } from "react";
import { NextPageTabs } from "@babel-apps/platform/pages/next";
import { WorkspaceProcessHost } from "@babel-apps/platform/pages/react";
import { searchFocusFromParams } from "@babel-apps/platform/search/focus";

import { CanvasWorkspace } from "@/components/canvas-workspace";
import { NotesWorkspace } from "@/components/notes-workspace";
import type { NoteSearchField } from "@/lib/types";
import {
  RUIDER_WORKSPACE_PROCESSES,
  ruiderWorkspaceProcess,
} from "@/lib/workspace-process";

const NOTE_SEARCH_FIELDS = new Set<NoteSearchField>([
  "title",
  "content",
  "tags",
]);

function positiveInteger(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function RuiderPageTabs() {
  return <NextPageTabs />;
}

export function RuiderWorkspaceProcessHost({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={children}>
      <RuiderWorkspaceProcessRuntime>{children}</RuiderWorkspaceProcessRuntime>
    </Suspense>
  );
}

function RuiderWorkspaceProcessRuntime({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeProcess = ruiderWorkspaceProcess(pathname);
  const routeTargetKey = searchParams.toString();
  const noteTarget = useMemo(() => {
    const noteId = positiveInteger(searchParams.get("note"));
    return {
      folderId: positiveInteger(searchParams.get("folder")),
      noteId,
      searchFocus: noteId === null
        ? null
        : searchFocusFromParams(
            Object.fromEntries(searchParams.entries()),
            NOTE_SEARCH_FIELDS,
          ),
    };
  }, [searchParams]);

  return (
    <WorkspaceProcessHost
      activeProcess={activeProcess}
      processes={RUIDER_WORKSPACE_PROCESSES.map((process) => ({
        ...process,
        content: process.key === "canvases" ? (
          <CanvasWorkspace
            initialCanvasId={activeProcess === "canvases"
              ? positiveInteger(searchParams.get("canvas"))
              : null}
            routeTargetKey={activeProcess === "canvases" ? routeTargetKey : ""}
          />
        ) : (
          <NotesWorkspace
            initialFolderId={activeProcess === "notes" ? noteTarget.folderId : null}
            initialNoteId={activeProcess === "notes" ? noteTarget.noteId : null}
            initialSearchFocus={activeProcess === "notes" ? noteTarget.searchFocus : null}
            routeTargetKey={activeProcess === "notes" ? routeTargetKey : ""}
          />
        ),
      }))}
    >
      {children}
    </WorkspaceProcessHost>
  );
}
