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
  pagesShareScope,
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
  readonly pendingNavigationKey: string | null;
  openPage(page: PageSessionDescriptor, options?: OpenPageOptions): void;
  activatePage(key: string | null): void;
  beginPageNavigation(key: string): void;
  completePageNavigation(key?: string): void;
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

function otherPagesInScope(
  pages: readonly PageSessionDescriptor[],
  key: string,
): readonly PageSessionDescriptor[] {
  const target = pages.find((page) => page.key === key);
  if (target === undefined) return [];
  return pages.filter((page) =>
    page.key !== key && pagesShareScope(page, target)
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
  const [pendingNavigationKey, setPendingNavigationKey] = useState<string | null>(null);
  const [closePending, setClosePending] = useState(false);
  const [closeError, setCloseError] = useState("");
  const lifecycleRef = useRef(new Map<string, PageSessionLifecycle>());
  const restoredRef = useRef(false);
  const skipInitialPersistenceRef = useRef(storageKey !== undefined);
  const previousActivePageRef = useRef<PageSessionDescriptor | null>(null);
  const pendingNavigationKeyRef = useRef<string | null>(null);
  const pendingNavigationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const completePageNavigation = useCallback((key?: string) => {
    if (key !== undefined && pendingNavigationKeyRef.current !== key) return;
    pendingNavigationKeyRef.current = null;
    if (pendingNavigationTimerRef.current !== null) {
      clearTimeout(pendingNavigationTimerRef.current);
      pendingNavigationTimerRef.current = null;
    }
    setPendingNavigationKey(null);
  }, []);
  const beginPageNavigation = useCallback((key: string) => {
    if (pendingNavigationTimerRef.current !== null) {
      clearTimeout(pendingNavigationTimerRef.current);
    }
    pendingNavigationKeyRef.current = key;
    setPendingNavigationKey(key);
    pendingNavigationTimerRef.current = setTimeout(() => {
      pendingNavigationKeyRef.current = null;
      pendingNavigationTimerRef.current = null;
      setPendingNavigationKey(null);
    }, 10_000);
  }, []);

  useEffect(() => () => {
    if (pendingNavigationTimerRef.current !== null) {
      clearTimeout(pendingNavigationTimerRef.current);
    }
  }, []);

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
    const otherPages = otherPagesInScope(state.pages, key);
    const protectedPages = otherPages.filter((page) => page.dirty || page.pending);
    if (protectedPages.length === 0) {
      for (const page of otherPages) {
        lifecycleRef.current.delete(page.key);
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
      for (const page of otherPagesInScope(state.pages, pending.key)) {
        lifecycleRef.current.delete(page.key);
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
      ? otherPagesInScope(state.pages, pendingClose.key)
          .filter((page) => page.dirty || page.pending)
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
      ? otherPagesInScope(state.pages, pendingClose.key)
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
      ? otherPagesInScope(state.pages, pendingClose.key)
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
    pendingNavigationKey,
    openPage,
    activatePage,
    beginPageNavigation,
    completePageNavigation,
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
    beginPageNavigation,
    closePage,
    completePageNavigation,
    movePage,
    openPage,
    pendingNavigationKey,
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

export interface WorkspaceProcessPageMatcher {
  readonly scope: string;
  readonly legacyPageKinds?: readonly string[];
  readonly legacyPageKeys?: readonly string[];
}

export interface WorkspaceProcessDefinition extends WorkspaceProcessPageMatcher {
  readonly key: string;
  readonly content: ReactNode;
}

export interface WorkspaceProcessHostProps {
  readonly activeProcess: string | null;
  readonly children?: ReactNode;
  readonly processes: readonly WorkspaceProcessDefinition[];
}

interface WorkspaceProcessContextValue {
  readonly active: boolean;
  readonly key: string | null;
}

const WorkspaceProcessContext = createContext<WorkspaceProcessContextValue>({
  active: true,
  key: null,
});

export function useWorkspaceProcessActive(): boolean {
  return useContext(WorkspaceProcessContext).active;
}

export function useWorkspaceProcessKey(): string | null {
  return useContext(WorkspaceProcessContext).key;
}

export function pageBelongsToWorkspaceProcess(
  page: Pick<PageSessionDescriptor, "key" | "kind" | "scope">,
  process: WorkspaceProcessPageMatcher,
): boolean {
  return page.scope === process.scope || (
    page.scope === undefined &&
    process.legacyPageKinds?.includes(page.kind) === true &&
    (
      process.legacyPageKeys === undefined ||
      process.legacyPageKeys.includes(page.key)
    )
  );
}

export function workspaceProcessPageKey(
  pages: readonly PageSessionDescriptor[],
  process: WorkspaceProcessPageMatcher,
  rememberedKey: string | null,
): string | null {
  const processPages = pages.filter((page) =>
    pageBelongsToWorkspaceProcess(page, process)
  );
  return processPages.some((page) => page.key === rememberedKey)
    ? rememberedKey
    : processPages.at(-1)?.key ?? null;
}

export function workspaceProcessActivationKey(
  pages: readonly PageSessionDescriptor[],
  process: WorkspaceProcessPageMatcher,
  activeKey: string | null,
  rememberedKey: string | null | undefined,
  processChanged: boolean,
): string | null {
  const activePage = pages.find((page) => page.key === activeKey);
  if (activePage && pageBelongsToWorkspaceProcess(activePage, process)) {
    return activeKey;
  }
  if (activeKey === null && !processChanged) return null;
  if (rememberedKey === null) return null;
  return workspaceProcessPageKey(pages, process, rememberedKey ?? null);
}

export function workspaceProcessShouldRemainCached(
  process: WorkspaceProcessPageMatcher & { readonly key: string },
  availableProcessKeys: ReadonlySet<string>,
  pages: readonly PageSessionDescriptor[],
): boolean {
  return availableProcessKeys.has(process.key) || pages.some((page) =>
    pageBelongsToWorkspaceProcess(page, process)
  );
}

export interface WorkspaceProcessRouteTargetTracker {
  active: boolean;
  activated: boolean;
  preservingBareTarget: boolean;
}

export function createWorkspaceProcessRouteTargetTracker(): WorkspaceProcessRouteTargetTracker {
  return {
    active: false,
    activated: false,
    preservingBareTarget: false,
  };
}

export function workspaceProcessRouteTargetShouldApply(
  tracker: WorkspaceProcessRouteTargetTracker,
  active: boolean,
  routeTargetKey: string,
): boolean {
  const reactivated = active && tracker.activated && !tracker.active;
  tracker.active = active;
  if (!active) return false;
  if (!tracker.activated) {
    tracker.activated = true;
    tracker.preservingBareTarget = false;
    return true;
  }
  if (reactivated && routeTargetKey === "") {
    tracker.preservingBareTarget = true;
  } else if (routeTargetKey !== "") {
    tracker.preservingBareTarget = false;
  }
  return !tracker.preservingBareTarget;
}

export function WorkspaceProcessHost({
  activeProcess,
  children,
  processes,
}: WorkspaceProcessHostProps) {
  const {
    pages,
    activeKey,
    activatePage,
    pendingNavigationKey,
    completePageNavigation,
  } = usePageSessions();
  const lastActiveKeyRef = useRef(new Map<string, string | null>());
  const previousProcessKeyRef = useRef<string | null>(null);
  const currentProcess = processes.find((process) => process.key === activeProcess) ?? null;

  useEffect(() => {
    const availableProcessKeys = new Set(processes.map(({ key }) => key));
    for (const [processKey, rememberedKey] of lastActiveKeyRef.current) {
      if (
        !availableProcessKeys.has(processKey) &&
        (
          rememberedKey === null ||
          !pages.some((page) => page.key === rememberedKey)
        )
      ) {
        lastActiveKeyRef.current.delete(processKey);
      }
    }
    const activePage = pages.find((page) => page.key === activeKey);
    if (activeKey !== null && activePage !== undefined) {
      const activePageProcess = processes.find((process) =>
        pageBelongsToWorkspaceProcess(activePage, process)
      );
      if (activePageProcess !== undefined) {
        lastActiveKeyRef.current.set(activePageProcess.key, activeKey);
      }
    }
    if (pendingNavigationKey !== null) {
      const pendingPage = pages.find((page) => page.key === pendingNavigationKey);
      if (pendingPage === undefined) {
        completePageNavigation(pendingNavigationKey);
        return;
      }
      if (
        currentProcess !== null &&
        pageBelongsToWorkspaceProcess(pendingPage, currentProcess)
      ) {
        lastActiveKeyRef.current.set(currentProcess.key, pendingNavigationKey);
        if (activeKey !== pendingNavigationKey) activatePage(pendingNavigationKey);
        completePageNavigation(pendingNavigationKey);
      }
      return;
    }
    const processChanged = previousProcessKeyRef.current !== currentProcess?.key;
    previousProcessKeyRef.current = currentProcess?.key ?? null;
    if (currentProcess === null) return;
    if (!processChanged) {
      if (activeKey === null) {
        lastActiveKeyRef.current.set(currentProcess.key, null);
        return;
      }
      if (activePage && pageBelongsToWorkspaceProcess(activePage, currentProcess)) {
        return;
      }
    } else if (
      activePage && pageBelongsToWorkspaceProcess(activePage, currentProcess)
    ) {
      return;
    }
    const nextKey = workspaceProcessActivationKey(
      pages,
      currentProcess,
      activeKey,
      lastActiveKeyRef.current.get(currentProcess.key),
      processChanged,
    );
    if (activeKey !== nextKey) activatePage(nextKey);
  }, [
    activatePage,
    activeKey,
    completePageNavigation,
    currentProcess,
    pages,
    pendingNavigationKey,
    processes,
  ]);

  return (
    <WorkspaceProcessCache
      activeProcess={activeProcess}
      pages={pages}
      processes={processes}
    >
      {children}
    </WorkspaceProcessCache>
  );
}

interface WorkspaceProcessCacheProps {
  readonly activeProcess: string | null;
  readonly children?: ReactNode;
  readonly pages: readonly PageSessionDescriptor[];
  readonly processes: readonly WorkspaceProcessDefinition[];
}

interface WorkspaceProcessCacheState {
  readonly processes: ReadonlyMap<string, WorkspaceProcessDefinition>;
}

class WorkspaceProcessCache extends React.Component<
  WorkspaceProcessCacheProps,
  WorkspaceProcessCacheState
> {
  state: WorkspaceProcessCacheState = { processes: new Map() };

  static getDerivedStateFromProps(
    props: WorkspaceProcessCacheProps,
    state: WorkspaceProcessCacheState,
  ): WorkspaceProcessCacheState | null {
    const availableProcessKeys = new Set(
      props.processes.map((process) => process.key),
    );
    const processes = new Map(state.processes);
    let changed = false;
    for (const [key, process] of processes) {
      if (!workspaceProcessShouldRemainCached(
        process,
        availableProcessKeys,
        props.pages,
      )) {
        processes.delete(key);
        changed = true;
      }
    }
    if (props.activeProcess === null) {
      return changed ? { processes } : null;
    }
    const process = props.processes.find(({ key }) => key === props.activeProcess);
    if (process !== undefined && processes.get(process.key) !== process) {
      processes.set(process.key, process);
      changed = true;
    }
    return changed ? { processes } : null;
  }

  render() {
    const { activeProcess, children } = this.props;
    const activeProcessAvailable = activeProcess === null ||
      this.state.processes.has(activeProcess);
    return (
      <>
        {[...this.state.processes.values()].map((process) => {
          const active = process.key === activeProcess;
          return (
            <WorkspaceProcessContext.Provider
              key={process.key}
              value={{ active, key: process.key }}
            >
              <div
                className="babel-workspace-process"
                data-process={process.key}
                data-active={active ? "" : undefined}
                hidden={!active}
                inert={!active}
              >
                {process.content}
              </div>
            </WorkspaceProcessContext.Provider>
          );
        })}
        {activeProcess === null || !activeProcessAvailable ? children : null}
      </>
    );
  }
}

export interface PageSessionHistoryGuardOptions {
  readonly dirty?: boolean;
  readonly pending?: boolean;
  readonly onDiscard?: () => void;
  readonly message?: string;
  readonly preserveOnHistoryNavigation?: boolean;
}

export function usePageSessionHistoryGuard({
  dirty = false,
  pending = false,
  onDiscard,
  message = "Discard your unsaved changes?",
  preserveOnHistoryNavigation = false,
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
    if (preserveOnHistoryNavigation) return;
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
  }, [closePage, preserveOnHistoryNavigation]);

  useEffect(() => {
    if (preserveOnHistoryNavigation) return;
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
  }, [
    activeKey,
    dirty,
    pending,
    preserveOnHistoryNavigation,
    protectedKeys.length,
  ]);
}

export interface PageTabsProps {
  readonly className?: string;
  readonly label?: string;
  readonly onNavigate?: (href: string) => void;
}

export function PageTabs({
  className = "",
  label = "Open pages",
  onNavigate,
}: PageTabsProps) {
  const {
    pages,
    activeKey,
    activatePage,
    beginPageNavigation,
    completePageNavigation,
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
      if (onNavigate !== undefined) beginPageNavigation(page.key);
      activatePage(page.key);
      const href = `${target.pathname}${target.search}${target.hash}`;
      if (onNavigate === undefined) {
        window.location.assign(href);
      } else {
        try {
          onNavigate(href);
        } catch (error) {
          completePageNavigation(page.key);
          throw error;
        }
      }
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
