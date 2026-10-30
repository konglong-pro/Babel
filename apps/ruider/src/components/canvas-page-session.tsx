"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PageSessionDescriptor } from "@babel-apps/platform/pages/core";
import {
  PageDeckPage,
  usePageSessionLifecycle,
  usePageSessions,
} from "@babel-apps/platform/pages/react";
import { useCommandPaletteActions } from "@babel-apps/platform/shortcuts/react";

import { CanvasEditor } from "@/components/canvas-editor";
import {
  deleteCanvas,
  getCanvas,
  getErrorMessage,
  updateCanvas,
} from "@/lib/api-client";
import type { CanvasDetailDto } from "@/lib/types";

interface CanvasPageSessionProps {
  pageKey: string;
  canvasId: number;
  renameRequested: boolean;
  onRenameRequestConsumed: () => void;
  onSaved: (canvas: CanvasDetailDto) => void;
  onDeleted: (id: number) => void;
  onError: (message: string) => void;
  onShowList: () => void;
}

export function savedCanvasPage(
  canvas: Pick<CanvasDetailDto, "id" | "title">,
): PageSessionDescriptor {
  return {
    key: `canvas:${canvas.id}`,
    kind: "Canvas",
    scope: "canvases",
    title: canvas.title,
    href: `/canvases?canvas=${canvas.id}`,
  };
}

export function CanvasPageSession({
  pageKey,
  canvasId,
  renameRequested,
  onRenameRequestConsumed,
  onSaved,
  onDeleted,
  onError,
  onShowList,
}: CanvasPageSessionProps) {
  const { activeKey, closePage, setPageStatus, updatePage } = usePageSessions();
  const [canvas, setCanvas] = useState<CanvasDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reloadVersion, setReloadVersion] = useState(0);
  const [saveState, setSaveState] = useState<
    "saved" | "pending" | "saving" | "error"
  >("saved");
  const saveActionRef = useRef<(() => void) | null>(null);
  const discardActionRef = useRef<(() => Promise<void>) | null>(null);

  const dirty = saveState === "pending" || saveState === "error";
  const pending = saveState === "saving";

  useEffect(() => {
    setPageStatus(pageKey, { dirty, pending });
  }, [dirty, pageKey, pending, setPageStatus]);

  usePageSessionLifecycle(pageKey, {
    save: () => {
      if (!dirty && !pending) return true;
      saveActionRef.current?.();
      return false;
    },
    discard: () => discardActionRef.current?.(),
  });

  useEffect(() => {
    const controller = new AbortController();
    getCanvas(canvasId, controller.signal)
      .then((nextCanvas) => {
        setCanvas(nextCanvas);
        setLoadError("");
        updatePage(pageKey, {
          scope: "canvases",
          title: nextCanvas.title,
          href: savedCanvasPage(nextCanvas).href,
        });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setLoadError(getErrorMessage(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [canvasId, pageKey, reloadVersion, updatePage]);

  const reflectSaved = useCallback((nextCanvas: CanvasDetailDto) => {
    setCanvas(nextCanvas);
    onSaved(nextCanvas);
  }, [onSaved]);

  const renameCanvas = useCallback(async () => {
    if (!canvas) return;
    const title = window.prompt("Canvas name", canvas.title)?.trim();
    if (!title || title === canvas.title) return;
    try {
      const updated = await updateCanvas(canvas.id, { title });
      reflectSaved(updated);
      updatePage(pageKey, { scope: "canvases", title: updated.title });
    } catch (cause) {
      onError(getErrorMessage(cause));
    }
  }, [canvas, onError, pageKey, reflectSaved, updatePage]);

  async function removeCanvas() {
    if (!canvas) return;
    if (!window.confirm(`Delete “${canvas.title}”? This cannot be undone.`)) return;
    try {
      await deleteCanvas(canvas.id);
      closePage(pageKey);
      onDeleted(canvas.id);
    } catch (cause) {
      onError(getErrorMessage(cause));
    }
  }

  function retryLoading() {
    setLoading(true);
    setLoadError("");
    setReloadVersion((version) => version + 1);
  }

  useEffect(() => {
    if (!renameRequested || canvas === null || loading) return;
    const frame = window.requestAnimationFrame(() => {
      onRenameRequestConsumed();
      void renameCanvas();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [canvas, loading, onRenameRequestConsumed, renameCanvas, renameRequested]);

  useCommandPaletteActions(`ruider.canvas-detail.${pageKey}`, activeKey === pageKey ? [
    ...(canvas !== null && !loading ? [{
      id: "ruider.canvas.rename",
      label: "Rename canvas",
      keywords: ["title", "edit", "canvas"],
      group: "Canvas",
      run: () => void renameCanvas(),
    }] : []),
    ...(canvas !== null && !loading ? [{
      id: "ruider.canvas.delete",
      label: "Delete canvas",
      keywords: ["remove", "canvas"],
      group: "Canvas",
      run: () => void removeCanvas(),
    }] : []),
    ...(loadError && !loading ? [{
      id: "ruider.canvas.retry",
      label: "Retry loading canvas",
      keywords: ["reload", "error", "canvas"],
      group: "Canvas",
      run: retryLoading,
    }] : []),
  ] : []);

  return (
    <PageDeckPage pageKey={pageKey}>
      <div className="canvas-main" data-babel-pane="detail" tabIndex={-1}>
        <button
          className="content-back"
          data-babel-escape="list"
          type="button"
          onClick={onShowList}
        >
          <span aria-hidden="true">←</span> Canvases
        </button>
        {loadError ? (
          <div className="canvas-alert" role="alert">
            <span>{loadError}</span>
            <button type="button" onClick={retryLoading}>Retry</button>
          </div>
        ) : null}
        {loading ? <div className="standalone-status">Opening canvas…</div> : null}
        {!loading && canvas ? (
          <>
            <div className="canvas-document-bar">
              <div>
                <span className="eyebrow">Open canvas</span>
                <h2>{canvas.title}</h2>
              </div>
              <div className="canvas-document-actions">
                <button type="button" onClick={() => void renameCanvas()}>Rename</button>
                <button className="danger-ghost" type="button" onClick={() => void removeCanvas()}>
                  Delete
                </button>
              </div>
            </div>
            <CanvasEditor
              key={canvas.id}
              canvas={canvas}
              onSaved={reflectSaved}
              onSaveStateChange={setSaveState}
              onRegisterDiscard={(action) => { discardActionRef.current = action; }}
              onRegisterSave={(action) => {
                saveActionRef.current = action;
              }}
            />
          </>
        ) : null}
      </div>
    </PageDeckPage>
  );
}
