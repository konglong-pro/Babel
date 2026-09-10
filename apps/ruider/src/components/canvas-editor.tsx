"use client";

import {
  CanvasEditor as SharedCanvasEditor,
  type CanvasEditorProps as SharedCanvasEditorProps,
} from "@babel-apps/platform/canvas/react";

import { getErrorMessage, updateCanvas } from "@/lib/api-client";

type CanvasEditorProps = Omit<SharedCanvasEditorProps, "updateCanvas" | "errorMessage">;

export function CanvasEditor(props: CanvasEditorProps) {
  return (
    <SharedCanvasEditor
      {...props}
      updateCanvas={updateCanvas}
      errorMessage={getErrorMessage}
    />
  );
}
