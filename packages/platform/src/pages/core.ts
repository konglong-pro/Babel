export interface PageSessionDescriptor {
  readonly key: string;
  readonly kind: string;
  readonly title: string;
  readonly href: string;
  readonly restorable?: boolean;
  readonly dirty?: boolean;
  readonly pending?: boolean;
}

export interface PageSessionsState {
  readonly pages: readonly PageSessionDescriptor[];
  readonly activeKey: string | null;
}

export type PageSessionsAction =
  | {
      readonly type: "open";
      readonly page: PageSessionDescriptor;
      readonly activate?: boolean;
    }
  | {
      readonly type: "activate";
      readonly key: string | null;
    }
  | {
      readonly type: "update";
      readonly key: string;
      readonly patch: Partial<Omit<PageSessionDescriptor, "key">>;
    }
  | {
      readonly type: "status";
      readonly key: string;
      readonly dirty?: boolean;
      readonly pending?: boolean;
    }
  | {
      readonly type: "rekey";
      readonly key: string;
      readonly page: PageSessionDescriptor;
    }
  | {
      readonly type: "close";
      readonly key: string;
    }
  | {
      readonly type: "close-others";
      readonly key: string;
    }
  | {
      readonly type: "move";
      readonly key: string;
      readonly toIndex: number;
    }
  | {
      readonly type: "restore";
      readonly state: PageSessionsState;
    };

export interface SerializedPageSessions {
  readonly version: 1;
  readonly activeKey: string | null;
  readonly pages: readonly PageSessionDescriptor[];
}

export function createPageSessionsState(
  pages: readonly PageSessionDescriptor[] = [],
  activeKey?: string | null,
): PageSessionsState {
  const uniquePages = deduplicatePages(pages);
  const requestedActiveKey = activeKey === undefined
    ? uniquePages.at(-1)?.key ?? null
    : activeKey;
  return {
    pages: uniquePages,
    activeKey: requestedActiveKey !== null &&
      uniquePages.some((page) => page.key === requestedActiveKey)
      ? requestedActiveKey
      : uniquePages.at(-1)?.key ?? null,
  };
}

export function pageSessionsReducer(
  state: PageSessionsState,
  action: PageSessionsAction,
): PageSessionsState {
  switch (action.type) {
    case "open": {
      const index = state.pages.findIndex((page) => page.key === action.page.key);
      const pages = index < 0
        ? [...state.pages, normalizePage(action.page)]
        : state.pages.map((page, pageIndex) =>
            pageIndex === index
              ? normalizePage({ ...page, ...action.page })
              : page
          );
      return {
        pages,
        activeKey: action.activate === false ? state.activeKey : action.page.key,
      };
    }
    case "activate":
      if (action.key === null) return { ...state, activeKey: null };
      return state.pages.some((page) => page.key === action.key)
        ? { ...state, activeKey: action.key }
        : state;
    case "update":
      return updatePage(state, action.key, action.patch);
    case "status":
      return updatePage(state, action.key, {
        ...(action.dirty === undefined ? {} : { dirty: action.dirty }),
        ...(action.pending === undefined ? {} : { pending: action.pending }),
      });
    case "rekey":
      return rekeyPage(state, action.key, action.page);
    case "close":
      return closePage(state, action.key);
    case "close-others": {
      const page = state.pages.find((candidate) => candidate.key === action.key);
      return page === undefined
        ? state
        : { pages: [page], activeKey: page.key };
    }
    case "move":
      return movePage(state, action.key, action.toIndex);
    case "restore":
      return createPageSessionsState(action.state.pages, action.state.activeKey);
  }
}

export function serializePageSessions(state: PageSessionsState): string {
  const pages = state.pages
    .filter((page) => page.restorable !== false)
    .map((page) => ({
      ...page,
      dirty: false,
      pending: false,
    }));
  const activeKey = pages.some((page) => page.key === state.activeKey)
    ? state.activeKey
    : pages.at(-1)?.key ?? null;
  const serialized: SerializedPageSessions = {
    version: 1,
    activeKey,
    pages,
  };
  return JSON.stringify(serialized);
}

export function parsePageSessions(value: string): PageSessionsState {
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.pages)) {
    throw new TypeError("Page session data is invalid.");
  }
  const pages = parsed.pages.map(parsePage);
  const activeKey = parsed.activeKey === null || typeof parsed.activeKey === "string"
    ? parsed.activeKey
    : null;
  return createPageSessionsState(pages, activeKey);
}

function updatePage(
  state: PageSessionsState,
  key: string,
  patch: Partial<Omit<PageSessionDescriptor, "key">>,
): PageSessionsState {
  let changed = false;
  const pages = state.pages.map((page) => {
    if (page.key !== key) return page;
    changed = true;
    return normalizePage({ ...page, ...patch });
  });
  return changed ? { ...state, pages } : state;
}

function rekeyPage(
  state: PageSessionsState,
  key: string,
  nextPage: PageSessionDescriptor,
): PageSessionsState {
  const sourceIndex = state.pages.findIndex((page) => page.key === key);
  if (sourceIndex < 0) return state;

  const existingIndex = state.pages.findIndex(
    (page, index) => index !== sourceIndex && page.key === nextPage.key,
  );
  if (existingIndex >= 0) {
    const pages = state.pages
      .filter((_, index) => index !== sourceIndex)
      .map((page) => page.key === nextPage.key
        ? normalizePage({ ...page, ...nextPage })
        : page);
    return {
      pages,
      activeKey:
        state.activeKey === key || state.activeKey === nextPage.key
          ? nextPage.key
          : state.activeKey,
    };
  }

  const pages = state.pages.map((page, index) =>
    index === sourceIndex ? normalizePage(nextPage) : page
  );
  return {
    pages,
    activeKey: state.activeKey === key ? nextPage.key : state.activeKey,
  };
}

function closePage(state: PageSessionsState, key: string): PageSessionsState {
  const index = state.pages.findIndex((page) => page.key === key);
  if (index < 0) return state;
  const pages = state.pages.filter((page) => page.key !== key);
  if (state.activeKey !== key) return { ...state, pages };
  return {
    pages,
    activeKey: pages[index]?.key ?? pages[index - 1]?.key ?? null,
  };
}

function movePage(
  state: PageSessionsState,
  key: string,
  requestedIndex: number,
): PageSessionsState {
  const currentIndex = state.pages.findIndex((page) => page.key === key);
  if (currentIndex < 0 || state.pages.length < 2) return state;
  const toIndex = Math.max(0, Math.min(Math.trunc(requestedIndex), state.pages.length - 1));
  if (currentIndex === toIndex) return state;
  const pages = [...state.pages];
  const [page] = pages.splice(currentIndex, 1);
  if (page === undefined) return state;
  pages.splice(toIndex, 0, page);
  return { ...state, pages };
}

function deduplicatePages(
  pages: readonly PageSessionDescriptor[],
): PageSessionDescriptor[] {
  const unique = new Map<string, PageSessionDescriptor>();
  for (const page of pages) {
    const normalized = normalizePage(page);
    unique.delete(normalized.key);
    unique.set(normalized.key, normalized);
  }
  return [...unique.values()];
}

function normalizePage(page: PageSessionDescriptor): PageSessionDescriptor {
  const key = page.key.trim();
  const kind = page.kind.trim();
  const title = page.title.trim();
  const href = page.href.trim();
  if (!key || !kind || !title || !href) {
    throw new TypeError("Page sessions require non-empty key, kind, title, and href.");
  }
  return {
    ...page,
    key,
    kind,
    title,
    href,
    dirty: page.dirty === true,
    pending: page.pending === true,
  };
}

function parsePage(value: unknown): PageSessionDescriptor {
  if (!isRecord(value)) throw new TypeError("Page session data is invalid.");
  return normalizePage({
    key: requiredString(value, "key"),
    kind: requiredString(value, "kind"),
    title: requiredString(value, "title"),
    href: requiredString(value, "href"),
    restorable: value.restorable !== false,
    dirty: false,
    pending: false,
  });
}

function requiredString(value: Record<string, unknown>, key: string): string {
  const candidate = value[key];
  if (typeof candidate !== "string") {
    throw new TypeError(`Page session ${key} must be a string.`);
  }
  return candidate;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
