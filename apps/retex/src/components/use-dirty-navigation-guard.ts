"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  BEFORE_NAVIGATE_EVENT,
  type BeforeNavigateDetail,
} from "@/components/app-header";

const HISTORY_GUARD_KEY = "__retexDirtyGuard";
const POPSTATE_FALLBACK_DELAY_MS = 500;

function currentRelativeUrl(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function guardedHistoryState(): Record<string, unknown> {
  const current = window.history.state;
  const state = current && typeof current === "object"
    ? (current as Record<string, unknown>)
    : {};
  return { ...state, [HISTORY_GUARD_KEY]: true };
}

function unguardedHistoryState(): unknown {
  const current = window.history.state;
  if (!current || typeof current !== "object") return current;
  const state = { ...(current as Record<string, unknown>) };
  delete state[HISTORY_GUARD_KEY];
  return state;
}

function isGuardedHistoryState(value: unknown): boolean {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as Record<string, unknown>)[HISTORY_GUARD_KEY],
  );
}

export interface DirtyNavigationGuard {
  dirty: boolean;
  setDirty: (dirty: boolean) => void;
  registerSave: (action: (() => void) | null) => void;
  confirmDiscard: () => boolean;
  discardAndRun: (action: () => void) => void;
  replaceLocation: (url: string) => void;
}

export function useDirtyNavigationGuard(): DirtyNavigationGuard {
  const [dirty, setDirtyStateValue] = useState(false);
  const dirtyRef = useRef(false);
  const saveActionRef = useRef<(() => void) | null>(null);
  const guardedUrlRef = useRef("");
  const guardEntryPresentRef = useRef(false);
  const collapsePendingRef = useRef(false);
  const collapseFallbackTimerRef = useRef<number | null>(null);
  const pendingLocationRef = useRef<string | null>(null);
  const afterCollapseRef = useRef<(() => void) | null>(null);
  const discardAfterCollapseRef = useRef(false);
  const backNavigationPendingRef = useRef(false);
  const backNavigationFallbackTimerRef = useRef<number | null>(null);

  const pushGuardEntry = useCallback(() => {
    const guardedUrl = guardedUrlRef.current || currentRelativeUrl();
    guardedUrlRef.current = guardedUrl;
    window.history.pushState(guardedHistoryState(), "", guardedUrl);
    guardEntryPresentRef.current = true;
  }, []);

  const runAfterCollapse = useCallback(() => {
    const afterCollapse = afterCollapseRef.current;
    afterCollapseRef.current = null;
    const discard = discardAfterCollapseRef.current;
    discardAfterCollapseRef.current = false;
    if (dirtyRef.current && !discard) {
      pushGuardEntry();
      return;
    }
    if (discard) {
      dirtyRef.current = false;
      setDirtyStateValue(false);
    }
    afterCollapse?.();
  }, [pushGuardEntry]);

  const completeCollapse = useCallback(() => {
    if (collapseFallbackTimerRef.current !== null) {
      window.clearTimeout(collapseFallbackTimerRef.current);
      collapseFallbackTimerRef.current = null;
    }
    collapsePendingRef.current = false;

    const nextUrl = pendingLocationRef.current
      ?? (guardedUrlRef.current || currentRelativeUrl());
    pendingLocationRef.current = null;
    guardedUrlRef.current = nextUrl;
    window.history.replaceState(unguardedHistoryState(), "", nextUrl);
    guardEntryPresentRef.current = false;
    runAfterCollapse();
  }, [runAfterCollapse]);

  const startCollapse = useCallback((afterCollapse?: () => void) => {
    if (afterCollapse && afterCollapseRef.current === null) {
      afterCollapseRef.current = afterCollapse;
    }
    if (collapsePendingRef.current) return;

    const hasGuardEntry = guardEntryPresentRef.current
      || isGuardedHistoryState(window.history.state);
    if (!hasGuardEntry) {
      runAfterCollapse();
      return;
    }

    collapsePendingRef.current = true;
    guardEntryPresentRef.current = false;
    window.history.back();
    collapseFallbackTimerRef.current = window.setTimeout(
      completeCollapse,
      POPSTATE_FALLBACK_DELAY_MS,
    );
  }, [completeCollapse, runAfterCollapse]);

  const clearDirty = useCallback((afterCollapse?: () => void) => {
    dirtyRef.current = false;
    setDirtyStateValue(false);
    if (backNavigationFallbackTimerRef.current !== null) {
      window.clearTimeout(backNavigationFallbackTimerRef.current);
      backNavigationFallbackTimerRef.current = null;
    }
    backNavigationPendingRef.current = false;
    startCollapse(afterCollapse);
  }, [startCollapse]);

  const setDirty = useCallback((nextDirty: boolean) => {
    if (!nextDirty) {
      clearDirty();
      return;
    }

    dirtyRef.current = true;
    setDirtyStateValue(true);
    if (collapsePendingRef.current) {
      afterCollapseRef.current = null;
      discardAfterCollapseRef.current = false;
      return;
    }
    if (!guardEntryPresentRef.current) pushGuardEntry();
  }, [clearDirty, pushGuardEntry]);

  const registerSave = useCallback((action: (() => void) | null) => {
    saveActionRef.current = action;
  }, []);

  const confirmDiscard = useCallback((): boolean => {
    return !dirtyRef.current || window.confirm("Discard your unsaved changes?");
  }, []);

  const discardAndRun = useCallback((action: () => void) => {
    discardAfterCollapseRef.current = true;
    startCollapse(action);
  }, [startCollapse]);

  const replaceLocation = useCallback((url: string) => {
    guardedUrlRef.current = url;
    if (collapsePendingRef.current) {
      pendingLocationRef.current = url;
      return;
    }
    window.history.replaceState(window.history.state, "", url);
  }, []);

  useEffect(() => {
    guardedUrlRef.current = currentRelativeUrl();
    guardEntryPresentRef.current = isGuardedHistoryState(window.history.state);

    function beforeUnload(event: BeforeUnloadEvent) {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = true;
    }

    function beforeNavigate(event: Event) {
      const navigationEvent = event as CustomEvent<BeforeNavigateDetail>;
      const proceed = navigationEvent.detail?.proceed;
      if (collapsePendingRef.current && proceed) {
        event.preventDefault();
        if (afterCollapseRef.current === null) afterCollapseRef.current = proceed;
        return;
      }
      if (!dirtyRef.current) return;
      if (!confirmDiscard()) {
        event.preventDefault();
        return;
      }
      if (!proceed) return;
      event.preventDefault();
      discardAndRun(proceed);
    }

    function popState(event: PopStateEvent) {
      if (collapsePendingRef.current) {
        event.stopImmediatePropagation();
        completeCollapse();
        return;
      }

      if (backNavigationPendingRef.current) {
        if (backNavigationFallbackTimerRef.current !== null) {
          window.clearTimeout(backNavigationFallbackTimerRef.current);
          backNavigationFallbackTimerRef.current = null;
        }
        backNavigationPendingRef.current = false;
        dirtyRef.current = false;
        setDirtyStateValue(false);
        return;
      }

      if (!guardEntryPresentRef.current) return;

      event.stopImmediatePropagation();
      if (!confirmDiscard()) {
        pushGuardEntry();
        return;
      }

      guardEntryPresentRef.current = false;
      backNavigationPendingRef.current = true;
      dirtyRef.current = false;
      setDirtyStateValue(false);
      window.history.back();
      backNavigationFallbackTimerRef.current = window.setTimeout(() => {
        if (!backNavigationPendingRef.current) return;
        backNavigationPendingRef.current = false;
        dirtyRef.current = true;
        setDirtyStateValue(true);
        pushGuardEntry();
        backNavigationFallbackTimerRef.current = null;
      }, POPSTATE_FALLBACK_DELAY_MS);
    }

    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener(BEFORE_NAVIGATE_EVENT, beforeNavigate);
    window.addEventListener("popstate", popState, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener(BEFORE_NAVIGATE_EVENT, beforeNavigate);
      window.removeEventListener("popstate", popState, true);
      if (collapseFallbackTimerRef.current !== null) {
        window.clearTimeout(collapseFallbackTimerRef.current);
        collapseFallbackTimerRef.current = null;
      }
      if (backNavigationFallbackTimerRef.current !== null) {
        window.clearTimeout(backNavigationFallbackTimerRef.current);
        backNavigationFallbackTimerRef.current = null;
      }
    };
  }, [completeCollapse, confirmDiscard, discardAndRun, pushGuardEntry]);

  return {
    dirty,
    setDirty,
    registerSave,
    confirmDiscard,
    discardAndRun,
    replaceLocation,
  };
}
