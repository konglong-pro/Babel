"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { CanvasDetail, CanvasScene } from "./core";

export type CanvasSaveState = "saved" | "pending" | "saving" | "error";

/** Serializes writes; cancellation drops queued writes and drains an in-flight write. */
export function createCanvasSaveQueue(
  initialScene: CanvasScene,
) {
  let savedSnapshot = JSON.stringify(initialScene);
  let chain = Promise.resolve();
  let generation = 0;
  let outstanding = 0;

  return {
    isSaved(scene: CanvasScene): boolean {
      return outstanding === 0 && JSON.stringify(scene) === savedSnapshot;
    },
    save(scene: CanvasScene, write: (scene: CanvasScene) => Promise<void>): Promise<void> {
      const snapshot = JSON.stringify(scene);
      const requestedGeneration = generation;
      outstanding += 1;
      chain = chain.catch(() => undefined).then(async () => {
        if (requestedGeneration !== generation || snapshot === savedSnapshot) return;
        await write(scene);
        savedSnapshot = snapshot;
      }).finally(() => { outstanding -= 1; });
      return chain;
    },
    cancelPending(): Promise<void> {
      generation += 1;
      return chain.catch(() => undefined);
    },
  };
}

interface CanvasAutosaveOptions {
  canvas: CanvasDetail;
  scene: CanvasScene;
  updateCanvas: (id: number, input: { scene: CanvasScene }) => Promise<CanvasDetail>;
  errorMessage: (error: unknown) => string;
  onSaved: (canvas: CanvasDetail) => void;
  onSaveStateChange?: (state: CanvasSaveState) => void;
  onRegisterSave?: (action: (() => void) | null) => void;
  onRegisterDiscard?: (action: (() => Promise<void>) | null) => void;
}

export function useCanvasAutosave(options: CanvasAutosaveOptions) {
  const { scene, onSaveStateChange, onRegisterSave, onRegisterDiscard } = options;
  const callbacks = useRef(options);
  const sceneRef = useRef(scene);
  const mounted = useRef(false);
  const discarded = useRef(false);
  const requestVersion = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<{
    saveState: CanvasSaveState;
    saveError: string | null;
    snapshot: string | null;
  }>({ saveState: "saved", saveError: null, snapshot: null });
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify(options.canvas.scene));
  const [queue] = useState(() => createCanvasSaveQueue(options.canvas.scene));
  const snapshot = JSON.stringify(scene);
  const saveState = status.saveState === "saving" ? "saving"
    : snapshot === savedSnapshot ? "saved"
      : status.saveState === "error" && status.snapshot === snapshot ? "error" : "pending";
  const saveError = saveState === "error" ? status.saveError : null;

  useLayoutEffect(() => {
    callbacks.current = options;
    sceneRef.current = scene;
  });

  const clearTimer = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const save = useCallback(() => {
    clearTimer();
    if (discarded.current) return;
    const version = ++requestVersion.current;
    const requestedSnapshot = JSON.stringify(sceneRef.current);
    setStatus({ saveState: "saving", saveError: null, snapshot: requestedSnapshot });
    void queue.save(sceneRef.current, async (nextScene) => {
      const saved = await callbacks.current.updateCanvas(callbacks.current.canvas.id, { scene: nextScene });
      if (mounted.current) {
        setSavedSnapshot(JSON.stringify(nextScene));
        callbacks.current.onSaved(saved);
      }
    }).then(() => {
      if (mounted.current && !discarded.current && version === requestVersion.current) {
        setStatus({ saveState: "saved", saveError: null, snapshot: requestedSnapshot });
      }
    }, (error: unknown) => {
      if (mounted.current && !discarded.current && version === requestVersion.current) {
        setStatus({ saveState: "error", saveError: callbacks.current.errorMessage(error), snapshot: requestedSnapshot });
      }
    });
  }, [clearTimer, queue]);

  const discard = useCallback(async () => {
    discarded.current = true;
    clearTimer();
    await queue.cancelPending();
  }, [clearTimer, queue]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimer();
      void queue.cancelPending();
    };
  }, [clearTimer, queue]);

  useEffect(() => {
    if (discarded.current || queue.isSaved(scene)) return;
    timer.current = setTimeout(save, 500);
    return clearTimer;
  }, [clearTimer, queue, save, scene]);

  useEffect(() => onSaveStateChange?.(saveState), [onSaveStateChange, saveState]);
  useEffect(() => {
    onRegisterSave?.(save);
    return () => onRegisterSave?.(null);
  }, [onRegisterSave, save]);
  useEffect(() => {
    onRegisterDiscard?.(discard);
    return () => onRegisterDiscard?.(null);
  }, [discard, onRegisterDiscard]);

  return { saveState, saveError };
}
