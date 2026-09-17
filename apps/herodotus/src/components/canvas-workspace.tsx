"use client";

import { createCanvasFetchApiClient } from "@babel-apps/platform/canvas/client";
import { SharedCanvasWorkspace } from "@babel-apps/platform/canvas/workspace";

import { BEFORE_NAVIGATE_EVENT } from "@/components/app-header";

const canvasApi = createCanvasFetchApiClient();
const canvasProcess = {
  key: "canvases",
  pathname: "/canvases",
  scope: "canvases",
  legacyPageKinds: ["Canvas"],
} as const;
const workspacePaths = new Set(["/notes","/canvases"]);

function isWorkspaceDestination(destination: string): boolean {
  return workspacePaths.has(destination.split(/[?#]/u, 1)[0] ?? "");
}

export interface CanvasWorkspaceProps {
  initialCanvasId: number | null;
  routeTargetKey?: string;
  creationRequestKey?: string | null;
}

export function CanvasWorkspace({
  initialCanvasId,
  routeTargetKey,
  creationRequestKey,
}: CanvasWorkspaceProps) {
  return (
    <SharedCanvasWorkspace
      appId="herodotus"
      appName="Herodotus"
      api={canvasApi}
      process={canvasProcess}
      initialCanvasId={initialCanvasId}
      routeTargetKey={routeTargetKey}
      creationRequestKey={creationRequestKey}
      beforeNavigateEvent={BEFORE_NAVIGATE_EVENT}
      isWorkspaceDestination={isWorkspaceDestination}
    />
  );
}

