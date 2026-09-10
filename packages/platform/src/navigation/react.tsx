"use client";

import {
  default as React,
  createContext,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  cyclicNavigationIndex,
  enabledNavigationItems,
  findTypeaheadItem,
  isEditableKeyboardTarget,
  isPaneAvailable,
  type NavigationId,
  type NavigationItem,
  type NavigationMovement,
  navigationMovementIndex,
  type TreeNavigationItem,
  treeItemLevel,
} from "./core";

export type { NavigationId, NavigationItem, TreeNavigationItem } from "./core";

const DEFAULT_PAGE_SIZE = 10;
const DEFAULT_TYPEAHEAD_TIMEOUT = 700;
const PANE_SELECTOR = "[data-babel-pane]";
const FOCUS_SCOPE_SELECTOR = "[data-babel-focus-scope]";
const PANE_ORDER = new Map([
  ["tree", 0],
  ["items", 1],
  ["tabs", 2],
  ["detail", 3],
]);

export interface BabelPaneProps extends HTMLAttributes<HTMLElement> {
  readonly "data-babel-pane": string;
}

export function babelPaneProps(paneId: string): BabelPaneProps {
  return { "data-babel-pane": paneId, tabIndex: -1 };
}

export interface PaneFocusContextValue {
  focusNextPane(): boolean;
  focusPreviousPane(): boolean;
  focusPane(paneId: string): boolean;
  rememberFocus(element?: HTMLElement | null): void;
}

const PaneFocusContext = createContext<PaneFocusContextValue | null>(null);

function availablePanes(): HTMLElement[] {
  if (typeof document === "undefined") return [];
  const activeFocusScope = Array.from(
    document.querySelectorAll<HTMLElement>(FOCUS_SCOPE_SELECTOR),
  ).filter(isPaneAvailable).at(-1) ?? null;
  return Array.from(document.querySelectorAll<HTMLElement>(PANE_SELECTOR))
    .filter(isPaneAvailable)
    .filter((pane) => activeFocusScope === null || activeFocusScope.contains(pane))
    .map((pane, domIndex) => ({ pane, domIndex }))
    .sort((left, right) => {
      const leftOrder = PANE_ORDER.get(left.pane.dataset.babelPane ?? "") ?? PANE_ORDER.size;
      const rightOrder = PANE_ORDER.get(right.pane.dataset.babelPane ?? "") ?? PANE_ORDER.size;
      return leftOrder - rightOrder || left.domIndex - right.domIndex;
    })
    .map(({ pane }) => pane);
}

function canReceivePaneFocus(element: HTMLElement): boolean {
  if (!isPaneAvailable(element)) return false;
  if (element.matches(":disabled, [aria-disabled='true']")) return false;
  return true;
}

function defaultPaneFocusTarget(pane: HTMLElement): HTMLElement {
  const candidateSelectors = [
    "[data-babel-pane-default]",
    "[role='treeitem'][tabindex='0']",
    "[role='option'][tabindex='0']",
    "[role='tab'][tabindex='0']",
    "[tabindex='0']",
    "button:not(:disabled)",
    "a[href]",
    "input:not(:disabled)",
    "textarea:not(:disabled)",
    "select:not(:disabled)",
  ];
  for (const selector of candidateSelectors) {
    const target = pane.querySelector<HTMLElement>(selector);
    if (target !== null && canReceivePaneFocus(target)) return target;
  }
  if (!pane.hasAttribute("tabindex")) pane.tabIndex = -1;
  return pane;
}

export interface PaneFocusProviderProps {
  readonly children?: ReactNode;
}

export function PaneFocusProvider({ children }: PaneFocusProviderProps) {
  const rememberedFocusRef = useRef(new WeakMap<HTMLElement, HTMLElement>());
  const lastPaneRef = useRef<HTMLElement | null>(null);

  const rememberFocus = useCallback((element?: HTMLElement | null) => {
    const target = element ?? (
      typeof document === "undefined" ? null : document.activeElement as HTMLElement | null
    );
    if (target === null || typeof target.closest !== "function") return;
    const pane = target.closest<HTMLElement>(PANE_SELECTOR);
    if (pane === null) return;
    rememberedFocusRef.current.set(pane, target);
    lastPaneRef.current = pane;
  }, []);

  useEffect(() => {
    const focusIn = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement) rememberFocus(event.target);
    };
    document.addEventListener("focusin", focusIn, true);
    return () => document.removeEventListener("focusin", focusIn, true);
  }, [rememberFocus]);

  const focusAvailablePane = useCallback((pane: HTMLElement): boolean => {
    const remembered = rememberedFocusRef.current.get(pane);
    const target = remembered !== undefined && pane.contains(remembered) && canReceivePaneFocus(remembered)
      ? remembered
      : defaultPaneFocusTarget(pane);
    target.focus({ preventScroll: false });
    if (document.activeElement !== target && target !== pane) {
      defaultPaneFocusTarget(pane).focus({ preventScroll: false });
    }
    const focused = pane.contains(document.activeElement);
    if (focused) rememberFocus(document.activeElement as HTMLElement);
    return focused;
  }, [rememberFocus]);

  const focusPane = useCallback((paneId: string): boolean => {
    const pane = availablePanes().find(
      (candidate) => candidate.dataset.babelPane === paneId,
    );
    return pane === undefined ? false : focusAvailablePane(pane);
  }, [focusAvailablePane]);

  const movePaneFocus = useCallback((direction: 1 | -1): boolean => {
    const panes = availablePanes();
    if (panes.length === 0) return false;
    const activeElement = document.activeElement;
    let currentIndex = panes.findIndex((pane) => pane.contains(activeElement));
    if (currentIndex < 0 && lastPaneRef.current !== null) {
      currentIndex = panes.indexOf(lastPaneRef.current);
    }
    const nextIndex = cyclicNavigationIndex(panes.length, currentIndex, direction);
    const pane = nextIndex === null ? undefined : panes[nextIndex];
    return pane === undefined ? false : focusAvailablePane(pane);
  }, [focusAvailablePane]);

  const value = useMemo<PaneFocusContextValue>(() => ({
    focusNextPane: () => movePaneFocus(1),
    focusPreviousPane: () => movePaneFocus(-1),
    focusPane,
    rememberFocus,
  }), [focusPane, movePaneFocus, rememberFocus]);

  return (
    <PaneFocusContext.Provider value={value}>
      {children}
      <button
        hidden
        type="button"
        data-babel-command-adapter=""
        data-babel-command="focusNextPane"
        onClick={value.focusNextPane}
      />
      <button
        hidden
        type="button"
        data-babel-command-adapter=""
        data-babel-command="focusPreviousPane"
        onClick={value.focusPreviousPane}
      />
    </PaneFocusContext.Provider>
  );
}

export function usePaneFocus(): PaneFocusContextValue {
  const context = useContext(PaneFocusContext);
  if (context === null) {
    throw new Error("usePaneFocus must be used within PaneFocusProvider.");
  }
  return context;
}

export type NavigationElementProps = HTMLAttributes<HTMLElement> & {
  readonly ref: (element: HTMLElement | null) => void;
  readonly tabIndex: 0 | -1;
};

export type TreeNavigationElementProps = NavigationElementProps & {
  readonly role: "treeitem";
  readonly "aria-selected": boolean;
  readonly "aria-expanded"?: boolean;
  readonly "aria-level": number;
  readonly "aria-posinset": number;
  readonly "aria-setsize": number;
  readonly "data-babel-navigation-id": string;
};

export type ListNavigationElementProps = NavigationElementProps & {
  readonly role: "option";
  readonly "aria-selected": boolean;
  readonly "data-babel-navigation-id": string;
};

interface BaseKeyboardNavigationOptions<Id extends NavigationId> {
  readonly selectedId?: Id | null;
  readonly defaultFocusedId?: Id | null;
  readonly onActivate: (id: Id) => void;
  readonly onEdit?: (id: Id) => void;
  readonly onFocusChange?: (id: Id) => void;
  readonly label?: string;
  readonly pageSize?: number;
  readonly typeaheadTimeout?: number;
}

interface BaseNavigationController<Id extends NavigationId> {
  readonly focusedId: Id | null;
  focusItem(id: Id): boolean;
}

function isComposing(event: KeyboardEvent<HTMLElement>): boolean {
  return event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.key === "Process";
}

function movementForKey(key: string): NavigationMovement | null {
  if (key === "ArrowDown") return "next";
  if (key === "ArrowUp") return "previous";
  if (key === "Home") return "first";
  if (key === "End") return "last";
  if (key === "PageDown") return "page-next";
  if (key === "PageUp") return "page-previous";
  return null;
}

function hasFixedKeyModifier(event: KeyboardEvent<HTMLElement>): boolean {
  return event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
}

function isTypeaheadKey(event: KeyboardEvent<HTMLElement>): boolean {
  return !event.altKey && !event.ctrlKey && !event.metaKey &&
    event.key.length === 1 && event.key.trim().length > 0;
}

function useNavigationState<
  Id extends NavigationId,
  Item extends NavigationItem<Id>,
>(
  items: readonly Item[],
  selectedId: Id | null | undefined,
  defaultFocusedId: Id | null | undefined,
  onFocusChange: ((id: Id) => void) | undefined,
) {
  const availableItems = useMemo(() => enabledNavigationItems(items), [items]);
  const initialId = defaultFocusedId ?? selectedId ?? availableItems[0]?.id ?? null;
  const [storedFocusedId, setStoredFocusedId] = useState<Id | null>(initialId);
  const focusedId = availableItems.some((item) => item.id === storedFocusedId)
    ? storedFocusedId
    : selectedId !== null && selectedId !== undefined &&
        availableItems.some((item) => item.id === selectedId)
      ? selectedId
      : availableItems[0]?.id ?? null;
  const focusedIdRef = useRef<Id | null>(focusedId);
  const elementsRef = useRef(new Map<Id, HTMLElement>());

  const setRovingFocus = useCallback((id: Id, focus: boolean): boolean => {
    if (!availableItems.some((item) => item.id === id)) return false;
    const changed = focusedIdRef.current !== id;
    focusedIdRef.current = id;
    setStoredFocusedId(id);
    if (changed) onFocusChange?.(id);
    const element = elementsRef.current.get(id);
    if (focus && element !== undefined) element.focus();
    return element !== undefined;
  }, [availableItems, onFocusChange]);

  const targetId = useCallback((target: EventTarget | null): Id | null => {
    if (!(target instanceof Node)) return focusedIdRef.current;
    for (const [id, element] of elementsRef.current) {
      if (element === target || element.contains(target)) return id;
    }
    return focusedIdRef.current;
  }, []);

  const itemRef = useCallback((id: Id) => (element: HTMLElement | null) => {
    if (element === null) elementsRef.current.delete(id);
    else elementsRef.current.set(id, element);
  }, []);

  const itemFocus = useCallback((id: Id) => () => {
    if (focusedIdRef.current === id) return;
    focusedIdRef.current = id;
    setStoredFocusedId(id);
    onFocusChange?.(id);
  }, [onFocusChange]);

  return {
    availableItems,
    elementsRef,
    focusedId,
    focusedIdRef,
    itemFocus,
    itemRef,
    setRovingFocus,
    targetId,
  };
}

function useTypeahead<Id extends NavigationId, Item extends NavigationItem<Id>>(
  items: readonly Item[],
  focusedIdRef: { current: Id | null },
  setRovingFocus: (id: Id, focus: boolean) => boolean,
  timeout: number,
) {
  const bufferRef = useRef("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
  }, []);

  return useCallback((key: string): boolean => {
    const normalizedKey = key.toLocaleLowerCase();
    const previous = bufferRef.current;
    const repeatedCharacter = previous.length > 0 &&
      Array.from(previous).every((character) => character === normalizedKey);
    const query = repeatedCharacter ? normalizedKey : `${previous}${normalizedKey}`;
    bufferRef.current = query;
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      bufferRef.current = "";
      timerRef.current = null;
    }, timeout);
    const match = findTypeaheadItem(items, focusedIdRef.current, query);
    if (match === null) return false;
    setRovingFocus(match.id, true);
    return true;
  }, [focusedIdRef, items, setRovingFocus, timeout]);
}

export interface UseTreeKeyboardNavigationOptions<Id extends NavigationId>
  extends BaseKeyboardNavigationOptions<Id> {
  readonly items: readonly TreeNavigationItem<Id>[];
  readonly onExpandedChange?: (id: Id, expanded: boolean) => void;
}

export interface TreeKeyboardNavigationController<Id extends NavigationId>
  extends BaseNavigationController<Id> {
  readonly treeProps: HTMLAttributes<HTMLElement> & {
    readonly role: "tree";
  };
  getTreeItemProps(id: Id): TreeNavigationElementProps;
}

export function useTreeKeyboardNavigation<Id extends NavigationId>({
  items,
  selectedId,
  defaultFocusedId,
  onActivate,
  onEdit,
  onExpandedChange,
  onFocusChange,
  label,
  pageSize = DEFAULT_PAGE_SIZE,
  typeaheadTimeout = DEFAULT_TYPEAHEAD_TIMEOUT,
}: UseTreeKeyboardNavigationOptions<Id>): TreeKeyboardNavigationController<Id> {
  const navigation = useNavigationState(items, selectedId, defaultFocusedId, onFocusChange);
  const typeahead = useTypeahead(
    navigation.availableItems,
    navigation.focusedIdRef,
    navigation.setRovingFocus,
    typeaheadTimeout,
  );
  const itemMap = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || isComposing(event) || isEditableKeyboardTarget(event.target)) return;
    const id = navigation.targetId(event.target);
    if (id === null) return;
    const item = itemMap.get(id);
    if (item === undefined) return;
    const movement = movementForKey(event.key);
    if (movement !== null && !hasFixedKeyModifier(event)) {
      const currentIndex = navigation.availableItems.findIndex((candidate) => candidate.id === id);
      const nextIndex = navigationMovementIndex(
        navigation.availableItems.length,
        currentIndex,
        movement,
        pageSize,
      );
      const next = nextIndex === null ? undefined : navigation.availableItems[nextIndex];
      if (next !== undefined) navigation.setRovingFocus(next.id, true);
      event.preventDefault();
      return;
    }
    if (event.key === "ArrowRight" && !hasFixedKeyModifier(event)) {
      if (item.hasChildren && !item.expanded) {
        onExpandedChange?.(id, true);
      } else if (item.hasChildren && item.expanded) {
        const child = navigation.availableItems.find((candidate) =>
          candidate.parentId === id
        );
        if (child !== undefined) navigation.setRovingFocus(child.id, true);
      }
      event.preventDefault();
      return;
    }
    if (event.key === "ArrowLeft" && !hasFixedKeyModifier(event)) {
      if (item.hasChildren && item.expanded) {
        onExpandedChange?.(id, false);
      } else if (item.parentId !== null && item.parentId !== undefined) {
        navigation.setRovingFocus(item.parentId, true);
      }
      event.preventDefault();
      return;
    }
    if (event.key === "Enter" && !hasFixedKeyModifier(event)) {
      event.preventDefault();
      onActivate(id);
      return;
    }
    if (event.key === "F2" && !hasFixedKeyModifier(event) && onEdit !== undefined) {
      event.preventDefault();
      onEdit(id);
      return;
    }
    if (isTypeaheadKey(event) && typeahead(event.key)) event.preventDefault();
  }, [
    itemMap,
    navigation,
    onActivate,
    onEdit,
    onExpandedChange,
    pageSize,
    typeahead,
  ]);

  const getTreeItemProps = useCallback((id: Id): TreeNavigationElementProps => {
    const item = itemMap.get(id);
    const siblings = item === undefined
      ? []
      : items.filter((candidate) =>
          candidate.visible !== false && candidate.parentId === item.parentId
        );
    return {
      ref: navigation.itemRef(id),
      role: "treeitem",
      tabIndex: navigation.focusedId === id && !item?.disabled ? 0 : -1,
      "aria-selected": selectedId === id,
      "aria-disabled": item?.disabled || undefined,
      "aria-expanded": item?.hasChildren ? Boolean(item.expanded) : undefined,
      "aria-level": treeItemLevel(items, id),
      "aria-posinset": Math.max(1, siblings.findIndex((candidate) => candidate.id === id) + 1),
      "aria-setsize": Math.max(1, siblings.length),
      "data-babel-navigation-id": String(id),
      onFocus: navigation.itemFocus(id),
    };
  }, [itemMap, items, navigation, selectedId]);

  return {
    focusedId: navigation.focusedId,
    focusItem: (id) => navigation.setRovingFocus(id, true),
    treeProps: {
      role: "tree",
      "aria-label": label,
      onKeyDown,
    },
    getTreeItemProps,
  };
}

export interface UseListKeyboardNavigationOptions<Id extends NavigationId>
  extends BaseKeyboardNavigationOptions<Id> {
  readonly items: readonly NavigationItem<Id>[];
}

export interface ListKeyboardNavigationController<Id extends NavigationId>
  extends BaseNavigationController<Id> {
  readonly listboxProps: HTMLAttributes<HTMLElement> & {
    readonly role: "listbox";
  };
  getOptionProps(id: Id): ListNavigationElementProps;
}

export function useListKeyboardNavigation<Id extends NavigationId>({
  items,
  selectedId,
  defaultFocusedId,
  onActivate,
  onEdit,
  onFocusChange,
  label,
  pageSize = DEFAULT_PAGE_SIZE,
  typeaheadTimeout = DEFAULT_TYPEAHEAD_TIMEOUT,
}: UseListKeyboardNavigationOptions<Id>): ListKeyboardNavigationController<Id> {
  const navigation = useNavigationState(items, selectedId, defaultFocusedId, onFocusChange);
  const typeahead = useTypeahead(
    navigation.availableItems,
    navigation.focusedIdRef,
    navigation.setRovingFocus,
    typeaheadTimeout,
  );

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || isComposing(event) || isEditableKeyboardTarget(event.target)) return;
    const id = navigation.targetId(event.target);
    if (id === null) return;
    const movement = movementForKey(event.key);
    if (movement !== null && !hasFixedKeyModifier(event)) {
      const currentIndex = navigation.availableItems.findIndex((candidate) => candidate.id === id);
      const nextIndex = navigationMovementIndex(
        navigation.availableItems.length,
        currentIndex,
        movement,
        pageSize,
      );
      const next = nextIndex === null ? undefined : navigation.availableItems[nextIndex];
      if (next !== undefined) navigation.setRovingFocus(next.id, true);
      event.preventDefault();
      return;
    }
    if (event.key === "Enter" && !hasFixedKeyModifier(event)) {
      event.preventDefault();
      onActivate(id);
      return;
    }
    if (event.key === "F2" && !hasFixedKeyModifier(event) && onEdit !== undefined) {
      event.preventDefault();
      onEdit(id);
      return;
    }
    if (isTypeaheadKey(event) && typeahead(event.key)) event.preventDefault();
  }, [navigation, onActivate, onEdit, pageSize, typeahead]);

  const getOptionProps = useCallback((id: Id): ListNavigationElementProps => {
    const item = items.find((candidate) => candidate.id === id);
    return {
      ref: navigation.itemRef(id),
      role: "option",
      tabIndex: navigation.focusedId === id && !item?.disabled ? 0 : -1,
      "aria-selected": selectedId === id,
      "aria-disabled": item?.disabled || undefined,
      "data-babel-navigation-id": String(id),
      onFocus: navigation.itemFocus(id),
    };
  }, [items, navigation, selectedId]);

  return {
    focusedId: navigation.focusedId,
    focusItem: (id) => navigation.setRovingFocus(id, true),
    listboxProps: {
      role: "listbox",
      "aria-label": label,
      onKeyDown,
    },
    getOptionProps,
  };
}
