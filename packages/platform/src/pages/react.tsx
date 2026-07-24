"use client";

import {
  default as React,
  createContext,
  type DragEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";

import {
  createPageSessionsState,
  pageSessionsReducer,
  parsePageSessions,
  serializePageSessions,
  type PageSessionDescriptor,
  type PageSessionsState,
} from "./core";

export interface PageSessionLifecycle {
  readonly save?: () => boolean | void | Promise<boolean | void>;
  readonly discard?: () => void | Promise<void>;
}

export interface OpenPageOptions {
  readonly activate?: boolean;
}

export interface PageSessionsContextValue extends PageSessionsState {
  openPage(page: PageSessionDescriptor, options?: OpenPageOptions): void;
  activatePage(key: string | null): void;
  updatePage(
    key: string,
    patch: Partial<Omit<PageSessionDescriptor, "key">>,
  ): void;
  setPageStatus(
    key: string,
    status: { readonly dirty?: boolean; readonly pending?: boolean },
  ): void;
  rekeyPage(key: string, page: PageSessionDescriptor): void;
  requestClosePage(key: string): void;
  closePage(key: string): void;
  requestCloseOtherPages(key: string): void;
  movePage(key: string, toIndex: number): void;
  registerLifecycle(key: string, lifecycle: PageSessionLifecycle | null): void;
}

export interface PageSessionProviderProps {
  readonly children?: ReactNode;
  readonly initialPages?: readonly PageSessionDescriptor[];
  readonly initialActiveKey?: string | null;
  readonly storageKey?: string;
  readonly onActivePageChange?: (
    page: PageSessionDescriptor | null,
    previousPage: PageSessionDescriptor | null,
  ) => void;
}

interface PendingClose {
  readonly key: string;
  readonly others: boolean;
}

const PageSessionsContext = createContext<PageSessionsContextValue | null>(null);
const PAGE_HISTORY_GUARD_KEY = "__babelPageSessionGuard";

function currentRelativeUrl(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function guardedHistoryState(): Record<string, unknown> {
  const current = window.history.state;
  const state = current && typeof current === "object"
    ? (current as Record<string, unknown>)
    : {};
  return { ...state, [PAGE_HISTORY_GUARD_KEY]: true };
}

function isGuardedHistoryState(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as Record<string, unknown>)[PAGE_HISTORY_GUARD_KEY],
  );
}

export function PageSessionProvider({
  children,
  initialPages = [],
  initialActiveKey,
  storageKey,
  onActivePageChange,
}: PageSessionProviderProps) {
  const [state, dispatch] = useReducer(
    pageSessionsReducer,
    createPageSessionsState(initialPages, initialActiveKey),
  );
  const [pendingClose, setPendingClose] = useState<PendingClose | null>(null);
  const [closePending, setClosePending] = useState(false);
  const [closeError, setCloseError] = useState("");
  const lifecycleRef = useRef(new Map<string, PageSessionLifecycle>());
  const restoredRef = useRef(false);
  const skipInitialPersistenceRef = useRef(storageKey !== undefined);
  const previousActivePageRef = useRef<PageSessionDescriptor | null>(null);

  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    if (!storageKey) return;
    try {
      const saved = window.sessionStorage.getItem(storageKey);
      if (saved) dispatch({ type: "restore", state: parsePageSessions(saved) });
    } catch {
      // Invalid or unavailable session storage must not prevent the app from opening.
    }
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey) return;
    if (skipInitialPersistenceRef.current) {
      skipInitialPersistenceRef.current = false;
      return;
    }
    try {
      window.sessionStorage.setItem(storageKey, serializePageSessions(state));
    } catch {
      // Session persistence is best effort.
    }
  }, [state, storageKey]);

  const activePage = state.pages.find((page) => page.key === state.activeKey) ?? null;
  useEffect(() => {
    const previousPage = previousActivePageRef.current;
    if (previousPage?.key === activePage?.key) return;
    previousActivePageRef.current = activePage;
    onActivePageChange?.(activePage, previousPage);
  }, [activePage, onActivePageChange]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!state.pages.some((page) => page.dirty || page.pending)) return;
      event.preventDefault();
      event.returnValue = true;
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [state.pages]);

  const openPage = useCallback((
    page: PageSessionDescriptor,
    options?: OpenPageOptions,
  ) => {
    dispatch({ type: "open", page, activate: options?.activate });
  }, []);
  const activatePage = useCallback((key: string | null) => {
    dispatch({ type: "activate", key });
  }, []);
  const updatePage = useCallback((
    key: string,
    patch: Partial<Omit<PageSessionDescriptor, "key">>,
  ) => {
    dispatch({ type: "update", key, patch });
  }, []);
  const setPageStatus = useCallback((
    key: string,
    status: { readonly dirty?: boolean; readonly pending?: boolean },
  ) => {
    dispatch({ type: "status", key, ...status });
  }, []);
  const rekeyPage = useCallback((key: string, page: PageSessionDescriptor) => {
    const lifecycle = lifecycleRef.current.get(key);
    lifecycleRef.current.delete(key);
    if (lifecycle !== undefined) lifecycleRef.current.set(page.key, lifecycle);
    dispatch({ type: "rekey", key, page });
  }, []);
  const closePage = useCallback((key: string) => {
    lifecycleRef.current.delete(key);
    dispatch({ type: "close", key });
  }, []);
  const requestClosePage = useCallback((key: string) => {
    const page = state.pages.find((candidate) => candidate.key === key);
    if (page === undefined) return;
    if (!page.dirty && !page.pending) {
      closePage(key);
      return;
    }
    setCloseError("");
    setPendingClose({ key, others: false });
  }, [closePage, state.pages]);
  const requestCloseOtherPages = useCallback((key: string) => {
    const protectedPages = state.pages.filter(
      (page) => page.key !== key && (page.dirty || page.pending),
    );
    if (protectedPages.length === 0) {
      for (const page of state.pages) {
        if (page.key !== key) lifecycleRef.current.delete(page.key);
      }
      dispatch({ type: "close-others", key });
      return;
    }
    setCloseError("");
    setPendingClose({ key, others: true });
  }, [state.pages]);
  const movePage = useCallback((key: string, toIndex: number) => {
    dispatch({ type: "move", key, toIndex });
  }, []);
  const registerLifecycle = useCallback((
    key: string,
    lifecycle: PageSessionLifecycle | null,
  ) => {
    if (lifecycle === null) lifecycleRef.current.delete(key);
    else lifecycleRef.current.set(key, lifecycle);
  }, []);

  const finishPendingClose = useCallback(() => {
    const pending = pendingClose;
    if (pending === null) return;
    if (pending.others) {
      for (const page of state.pages) {
        if (page.key !== pending.key) lifecycleRef.current.delete(page.key);
      }
      dispatch({ type: "close-others", key: pending.key });
    } else {
      lifecycleRef.current.delete(pending.key);
      dispatch({ type: "close", key: pending.key });
    }
    setPendingClose(null);
  }, [pendingClose, state.pages]);

  const saveAndClose = useCallback(async () => {
    if (pendingClose === null || closePending) return;
    const targets = pendingClose.others
      ? state.pages.filter(
          (page) => page.key !== pendingClose.key && (page.dirty || page.pending),
        )
      : state.pages.filter((page) => page.key === pendingClose.key);
    setClosePending(true);
    setCloseError("");
    try {
      let waitingForPageSave = false;
      for (const page of targets) {
        const save = lifecycleRef.current.get(page.key)?.save;
        if (save === undefined) {
          throw new Error(`Could not find the save action for ${page.title}.`);
        }
        if (await save() === false) waitingForPageSave = true;
      }
      if (!waitingForPageSave) finishPendingClose();
    } catch (error) {
      setCloseError(error instanceof Error ? error.message : "Could not save this page.");
    } finally {
      setClosePending(false);
    }
  }, [closePending, finishPendingClose, pendingClose, state.pages]);

  const discardAndClose = useCallback(async () => {
    if (pendingClose === null || closePending) return;
    const targets = pendingClose.others
      ? state.pages.filter((page) => page.key !== pendingClose.key)
      : state.pages.filter((page) => page.key === pendingClose.key);
    setClosePending(true);
    setCloseError("");
    try {
      for (const page of targets) {
        await lifecycleRef.current.get(page.key)?.discard?.();
      }
      finishPendingClose();
    } catch (error) {
      setCloseError(error instanceof Error ? error.message : "Could not discard this page.");
    } finally {
      setClosePending(false);
    }
  }, [closePending, finishPendingClose, pendingClose, state.pages]);

  useEffect(() => {
    if (pendingClose === null || closePending) return;
    const protectedPages = pendingClose.others
      ? state.pages.filter((page) => page.key !== pendingClose.key)
      : state.pages.filter((page) => page.key === pendingClose.key);
    if (
      protectedPages.length > 0 &&
      protectedPages.every((page) => !page.dirty && !page.pending)
    ) {
      void Promise.resolve().then(finishPendingClose);
    }
  }, [closePending, finishPendingClose, pendingClose, state.pages]);

  const context = useMemo<PageSessionsContextValue>(() => ({
    ...state,
    openPage,
    activatePage,
    updatePage,
    setPageStatus,
    rekeyPage,
    requestClosePage,
    closePage,
    requestCloseOtherPages,
    movePage,
    registerLifecycle,
  }), [
    activatePage,
    closePage,
    movePage,
    openPage,
    registerLifecycle,
    rekeyPage,
    requestCloseOtherPages,
    requestClosePage,
    setPageStatus,
    state,
    updatePage,
  ]);

  const pendingClosePage = pendingClose === null
    ? null
    : state.pages.find((page) => page.key === pendingClose.key) ?? null;

  return (
    <PageSessionsContext.Provider value={context}>
      {children}
      {pendingClose === null ? null : (
        <div className="babel-page-close-backdrop" role="presentation">
          <section
            className="babel-page-close-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="babel-page-close-title"
          >
            <p className="babel-page-close-dialog__eyebrow">Unsaved changes</p>
            <h2 id="babel-page-close-title">
              {pendingClose.others
                ? "Close the other open pages?"
                : `Close ${pendingClosePage?.title ?? "this page"}?`}
            </h2>
            <p>
              {pendingClose.others
                ? "One or more other pages have changes that have not finished saving."
                : "This page has changes that have not finished saving."}
            </p>
            {closeError ? <p className="babel-page-close-dialog__error" role="alert">{closeError}</p> : null}
            <div className="babel-page-close-dialog__actions">
              <button
                type="button"
                disabled={closePending}
                onClick={() => setPendingClose(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={closePending}
                onClick={() => void discardAndClose()}
              >
                Discard
              </button>
              <button
                className="babel-page-close-dialog__primary"
                type="button"
                disabled={closePending}
                onClick={() => void saveAndClose()}
              >
                {closePending ? "Saving…" : "Save and close"}
              </button>
            </div>
          </section>
        </div>
      )}
    </PageSessionsContext.Provider>
  );
}

export function usePageSessions(): PageSessionsContextValue {
  const context = useContext(PageSessionsContext);
  if (context === null) {
    throw new Error("usePageSessions must be used inside PageSessionProvider.");
  }
  return context;
}

export interface PageSessionHistoryGuardOptions {
  readonly dirty?: boolean;
  readonly pending?: boolean;
  readonly onDiscard?: () => void;
  readonly message?: string;
}

export function usePageSessionHistoryGuard({
  dirty = false,
  pending = false,
  onDiscard,
  message = "Discard your unsaved changes?",
}: PageSessionHistoryGuardOptions = {}): void {
  const { pages, activeKey, closePage } = usePageSessions();
  const protectedKeys = pages
    .filter((page) => page.dirty || page.pending)
    .map((page) => page.key);
  const protectedSnapshotRef = useRef({
    keys: protectedKeys,
    extra: dirty || pending,
  });
  const onDiscardRef = useRef(onDiscard);
  const messageRef = useRef(message);
  const guardEntryPresentRef = useRef(false);
  const allowNextPopRef = useRef(false);
  const guardedUrlRef = useRef("");
  const popFallbackTimerRef = useRef<number | null>(null);

  useEffect(() => {
    protectedSnapshotRef.current = {
      keys: protectedKeys,
      extra: dirty || pending,
    };
  }, [dirty, pages, pending, protectedKeys]);

  useEffect(() => {
    onDiscardRef.current = onDiscard;
  }, [onDiscard]);

  useEffect(() => {
    messageRef.current = message;
  }, [message]);

  useEffect(() => {
    guardedUrlRef.current = currentRelativeUrl();
    guardEntryPresentRef.current = isGuardedHistoryState(window.history.state);

    const popState = (event: PopStateEvent) => {
      if (allowNextPopRef.current) {
        allowNextPopRef.current = false;
        if (popFallbackTimerRef.current !== null) {
          window.clearTimeout(popFallbackTimerRef.current);
          popFallbackTimerRef.current = null;
        }
        return;
      }
      if (!guardEntryPresentRef.current) return;

      event.stopImmediatePropagation();
      const snapshot = protectedSnapshotRef.current;
      if (
        (snapshot.keys.length > 0 || snapshot.extra) &&
        !window.confirm(messageRef.current)
      ) {
        window.history.pushState(
          guardedHistoryState(),
          "",
          guardedUrlRef.current,
        );
        guardEntryPresentRef.current = true;
        return;
      }

      for (const key of snapshot.keys) closePage(key);
      if (snapshot.extra) onDiscardRef.current?.();
      guardEntryPresentRef.current = false;
      allowNextPopRef.current = true;
      window.history.back();
      popFallbackTimerRef.current = window.setTimeout(() => {
        if (!allowNextPopRef.current) return;
        allowNextPopRef.current = false;
        popFallbackTimerRef.current = null;
      }, 500);
    };

    window.addEventListener("popstate", popState, true);
    return () => {
      window.removeEventListener("popstate", popState, true);
      if (popFallbackTimerRef.current !== null) {
        window.clearTimeout(popFallbackTimerRef.current);
        popFallbackTimerRef.current = null;
      }
    };
  }, [closePage]);

  useEffect(() => {
    guardedUrlRef.current = currentRelativeUrl();
    if (
      (protectedKeys.length === 0 && !dirty && !pending) ||
      guardEntryPresentRef.current
    ) return;
    window.history.pushState(
      guardedHistoryState(),
      "",
      guardedUrlRef.current,
    );
    guardEntryPresentRef.current = true;
  }, [activeKey, dirty, pending, protectedKeys.length]);
}

export interface PageTabsProps {
  readonly className?: string;
  readonly label?: string;
}

export function PageTabs({
  className = "",
  label = "Open pages",
}: PageTabsProps) {
  const {
    pages,
    activeKey,
    activatePage,
    requestClosePage,
    requestCloseOtherPages,
    movePage,
  } = usePageSessions();
  const dragKeyRef = useRef<string | null>(null);
  if (pages.length === 0) return null;

  const drop = (event: DragEvent<HTMLLIElement>, toIndex: number) => {
    event.preventDefault();
    const key = dragKeyRef.current;
    dragKeyRef.current = null;
    if (key !== null) movePage(key, toIndex);
  };

  const activate = (page: PageSessionDescriptor) => {
    const target = new URL(page.href, window.location.origin);
    if (target.pathname !== window.location.pathname) {
      window.location.assign(`${target.pathname}${target.search}${target.hash}`);
      return;
    }
    activatePage(page.key);
  };

  return (
    <nav className={`babel-page-tabs ${className}`.trim()} aria-label={label}>
      <ul role="tablist">
        {pages.map((page, index) => {
          const active = page.key === activeKey;
          return (
            <li
              key={page.key}
              draggable
              onDragStart={() => {
                dragKeyRef.current = page.key;
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => drop(event, index)}
            >
              <button
                className="babel-page-tab"
                type="button"
                role="tab"
                aria-selected={active}
                data-active={active ? "" : undefined}
                onClick={() => activate(page)}
                onDoubleClick={() => requestCloseOtherPages(page.key)}
              >
                <span className="babel-page-tab__kind">{page.kind}</span>
                <span className="babel-page-tab__title">{page.title}</span>
                {page.pending ? (
                  <span className="babel-page-tab__status is-pending" title="Saving" aria-label="Saving" />
                ) : page.dirty ? (
                  <span className="babel-page-tab__status is-dirty" title="Unsaved changes" aria-label="Unsaved changes" />
                ) : null}
              </button>
              <button
                className="babel-page-tab__close"
                type="button"
                aria-label={`Close ${page.title}`}
                onClick={() => requestClosePage(page.key)}
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export interface PageDeckProps {
  readonly children?: ReactNode;
  readonly pageKey: string;
  readonly className?: string;
}

export function PageDeckPage({
  children,
  pageKey,
  className = "",
}: PageDeckProps) {
  const { activeKey } = usePageSessions();
  const active = activeKey === pageKey;
  return (
    <section
      className={`babel-page-deck__page ${className}`.trim()}
      data-page-key={pageKey}
      data-active={active ? "" : undefined}
      hidden={!active}
      aria-hidden={!active}
      inert={!active}
    >
      {children}
    </section>
  );
}

export function usePageSessionLifecycle(
  pageKey: string,
  lifecycle: PageSessionLifecycle,
): void {
  const { registerLifecycle } = usePageSessions();
  const lifecycleRef = useRef(lifecycle);
  useEffect(() => {
    lifecycleRef.current = lifecycle;
  }, [lifecycle]);
  useEffect(() => {
    const adapter: PageSessionLifecycle = {
      save: () => lifecycleRef.current.save?.(),
      discard: () => lifecycleRef.current.discard?.(),
    };
    registerLifecycle(pageKey, adapter);
    return () => registerLifecycle(pageKey, null);
  }, [pageKey, registerLifecycle]);
}
