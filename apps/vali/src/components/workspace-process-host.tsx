"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, type ReactNode, useMemo } from "react";
import { NextPageTabs } from "@babel-apps/platform/pages/next";
import {
  WorkspaceProcessHost,
  type WorkspaceProcessDefinition,
} from "@babel-apps/platform/pages/react";

import { NotesWorkspace } from "@/components/notes-workspace";
import { ReflectionWorkspace } from "@/components/reflection-workspace";
import { valiSearchFocusFromParams, type ValiSearchFocus } from "@/lib/search-focus";
import {
  VALI_WORKSPACE_PROCESSES,
  valiWorkspaceProcess,
  valiWorkspaceRegistration,
} from "@/lib/workspace-process";

interface NotesRouteTarget {
  readonly folderId: number | null;
  readonly noteId: number | null;
  readonly searchFocus: ValiSearchFocus | null;
  readonly key: string;
}

interface ReflectionRouteTarget {
  readonly date: string | null;
  readonly searchFocus: ValiSearchFocus | null;
  readonly key: string;
}

const EMPTY_NOTES_TARGET: NotesRouteTarget = {
  folderId: null,
  noteId: null,
  searchFocus: null,
  key: "",
};

const EMPTY_REFLECTION_TARGET: ReflectionRouteTarget = {
  date: null,
  searchFocus: null,
  key: "",
};

function positiveInteger(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function reflectionDate(value: string | null): string | null {
  return value !== null && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export function ValiPageTabs() {
  return <NextPageTabs />;
}

export function ValiWorkspaceProcessHost({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={children}>
      <ValiWorkspaceProcessRuntime>{children}</ValiWorkspaceProcessRuntime>
    </Suspense>
  );
}

function ValiWorkspaceProcessRuntime({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeProcess = valiWorkspaceProcess(pathname);
  const routeKey = searchParams.toString();
  const routeParams = useMemo(
    () => Object.fromEntries(searchParams.entries()),
    [searchParams],
  );
  const notesTarget = useMemo<NotesRouteTarget>(() => activeProcess === "notes"
    ? {
        folderId: positiveInteger(searchParams.get("folder")),
        noteId: positiveInteger(searchParams.get("note")),
        searchFocus: valiSearchFocusFromParams(routeParams),
        key: routeKey,
      }
    : EMPTY_NOTES_TARGET,
  [activeProcess, routeKey, routeParams, searchParams]);
  const reflectionTarget = useMemo<ReflectionRouteTarget>(
    () => activeProcess === "reflection"
      ? {
          date: reflectionDate(searchParams.get("date")),
          searchFocus: valiSearchFocusFromParams(routeParams),
          key: routeKey,
        }
      : EMPTY_REFLECTION_TARGET,
    [activeProcess, routeKey, routeParams, searchParams],
  );
  const processes: WorkspaceProcessDefinition[] = VALI_WORKSPACE_PROCESSES.map(
    (process) => process === "notes"
      ? {
          ...valiWorkspaceRegistration(process),
          content: (
            <NotesWorkspace
              initialFolderId={notesTarget.folderId}
              initialNoteId={notesTarget.noteId}
              initialSearchFocus={notesTarget.searchFocus}
              routeTargetKey={notesTarget.key}
            />
          ),
        }
      : {
          ...valiWorkspaceRegistration(process),
          content: (
            <ReflectionWorkspace
              initialDate={reflectionTarget.date}
              initialSearchFocus={reflectionTarget.searchFocus}
              routeTargetKey={reflectionTarget.key}
            />
          ),
        },
  );

  return (
    <WorkspaceProcessHost activeProcess={activeProcess} processes={processes}>
      {children}
    </WorkspaceProcessHost>
  );
}
