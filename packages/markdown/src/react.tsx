"use client";

import {
  type CSSProperties,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
  type UrlTransform,
} from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import { findAutocompleteQuery, type AutocompleteQuery } from "./autocomplete";
import {
  extractWikilinks,
  preprocessWikilinks,
  type Wikilink,
} from "./core";

export type RemarkFeature = "gfm" | "math";

export interface ResolvedWikilink {
  id: number;
  kind?: string;
}

export interface MarkdownRendererProps {
  content: string;
  emptyText?: string;
  imagePreviews?: ReadonlyMap<string, string>;
  /** The image placeholder scheme without ://, for example esperanto-upload. */
  uploadScheme?: string;
  remarkFeatures?: readonly RemarkFeature[];
  /** Used for unresolved typed links; a resolved target's kind takes precedence. */
  defaultWikilinkKind?: string;
  resolveWikilink?: (titleKey: string) => ResolvedWikilink | null;
  onNavigateWikilink?: (target: ResolvedWikilink, wikilink: Wikilink) => void;
  onCreateFromWikilink?: (wikilink: Wikilink) => void;
}

const HEADING_COMPONENTS: Components = {
  h1: "h2",
  h2: "h3",
  h3: "h4",
  h4: "h5",
  h5: "h6",
};

export function MarkdownRenderer({
  content,
  emptyText = "No content yet.",
  imagePreviews,
  uploadScheme,
  remarkFeatures = ["gfm"],
  defaultWikilinkKind,
  resolveWikilink,
  onNavigateWikilink,
  onCreateFromWikilink,
}: MarkdownRendererProps) {
  const renderedContent = useMemo(() => {
    return withImagePreviews(content, uploadScheme, imagePreviews);
  }, [content, imagePreviews, uploadScheme]);

  const targetsByKey = useMemo(() => {
    const nextTargets = new Map<string, ResolvedWikilink | null>();
    for (const wikilink of extractWikilinks(renderedContent)) {
      if (!nextTargets.has(wikilink.titleKey)) {
        nextTargets.set(wikilink.titleKey, resolveWikilink?.(wikilink.titleKey) ?? null);
      }
    }
    return nextTargets;
  }, [renderedContent, resolveWikilink]);

  const { preprocessedContent, wikilinksByOffset } = useMemo(() => {
    const nextWikilinksByOffset = new Map<number, Wikilink>();
    const nextContent = preprocessWikilinks(renderedContent, {
      targetKind: ({ titleKey }) => targetsByKey.get(titleKey)?.kind ?? defaultWikilinkKind,
      onWikilink: (wikilink, occurrence) => {
        nextWikilinksByOffset.set(occurrence.start, wikilink);
      },
    });
    return {
      preprocessedContent: nextContent,
      wikilinksByOffset: nextWikilinksByOffset,
    };
  }, [defaultWikilinkKind, renderedContent, targetsByKey]);

  const components = useMemo<Components>(() => {
    const nextComponents: Components = {
      ...HEADING_COMPONENTS,
      a: ({ href, children, className, node, ...props }) => {
        const parsed = parseWikilinkHref(href);
        if (parsed === null) {
          return <a {...props} className={className} href={href}>{children}</a>;
        }

        const wikilink = wikilinksByOffset.get(node?.position?.start.offset ?? -1) ?? {
          titleRaw: parsed.titleKey,
          titleKey: parsed.titleKey,
          alias: null,
        };
        const target = targetsByKey.get(parsed.titleKey) ?? null;
        const isActionable = target === null
          ? onCreateFromWikilink !== undefined
          : onNavigateWikilink !== undefined;
        const stateClass = target === null ? "wikilink-unresolved" : "wikilink-resolved";
        const classes = [className, "wikilink", stateClass].filter(Boolean).join(" ");

        return (
          <a
            {...props}
            className={classes}
            href={isActionable ? href : undefined}
            tabIndex={isActionable ? undefined : -1}
            data-wikilink-kind={target?.kind ?? parsed.kind}
            data-wikilink-title={wikilink.titleRaw}
            aria-disabled={!isActionable}
            onClick={(event) => {
              event.preventDefault();
              if (target !== null) {
                onNavigateWikilink?.(target, wikilink);
              } else {
                onCreateFromWikilink?.(wikilink);
              }
            }}
          >
            {children}
          </a>
        );
      },
    };

    if (uploadScheme !== undefined) {
      nextComponents.img = ({ alt, node, ...props }) => {
        void node;
        // Markdown images may be local, remote, or unsaved blob URLs with unknown dimensions.
        // eslint-disable-next-line @next/next/no-img-element
        return <img {...props} alt={alt ?? ""} loading="lazy" />;
      };
    }
    return nextComponents;
  }, [
    onCreateFromWikilink,
    onNavigateWikilink,
    targetsByKey,
    uploadScheme,
    wikilinksByOffset,
  ]);

  const useGfm = remarkFeatures.includes("gfm");
  const useMath = remarkFeatures.includes("math");

  if (!content.trim()) return <p className="empty-copy">{emptyText}</p>;

  return (
    <div className="markdown-body">
      <ReactMarkdown
        components={components}
        remarkPlugins={[
          ...(useGfm ? [remarkGfm] : []),
          ...(useMath ? [remarkMath] : []),
        ]}
        rehypePlugins={useMath ? [rehypeKatex] : []}
        urlTransform={wikilinkUrlTransform}
      >
        {preprocessedContent}
      </ReactMarkdown>
    </div>
  );
}

export interface WikilinkTitleSuggestion {
  id: number;
  title: string;
  kind?: string;
}

const EMPTY_TITLE_SUGGESTIONS: readonly WikilinkTitleSuggestion[] = [];

export type FetchWikilinkTitles = (
  query: string,
  signal: AbortSignal,
) => Promise<readonly WikilinkTitleSuggestion[]>;

export interface UseWikilinkAutocompleteOptions {
  /** Required for a controlled textarea; otherwise the hook dispatches a native input event. */
  onTextChange?: (nextText: string) => void;
  /** Change this when the app, entity kind, or workspace queried by fetchTitles changes. */
  fetchScope?: string | number;
}

interface AutocompletePosition {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

export interface WikilinkAutocompleteController {
  isOpen: boolean;
  isLoading: boolean;
  query: string;
  suggestions: readonly WikilinkTitleSuggestion[];
  activeIndex: number;
  listboxId: string;
  position: AutocompletePosition | null;
  close: () => void;
  selectSuggestion: (index: number) => void;
}

export function useWikilinkAutocomplete(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  fetchTitles: FetchWikilinkTitles | null | undefined,
  options: UseWikilinkAutocompleteOptions = {},
): WikilinkAutocompleteController {
  const listboxId = useId();
  const [activeQuery, setActiveQuery] = useState<AutocompleteQuery | null>(null);
  const [suggestions, setSuggestions] = useState<readonly WikilinkTitleSuggestion[]>([]);
  const [suggestionScope, setSuggestionScope] = useState(options.fetchScope);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [position, setPosition] = useState<AutocompletePosition | null>(null);
  const [textareaElement, setTextareaElement] = useState<HTMLTextAreaElement | null>(null);
  const activeQueryRef = useRef(activeQuery);
  const suggestionsRef = useRef(suggestions);
  const activeIndexRef = useRef(activeIndex);
  const dismissedQueryRef = useRef<string | null>(null);
  const onTextChangeRef = useRef(options.onTextChange);
  const fetchTitlesRef = useRef(fetchTitles);
  const isComposingRef = useRef(false);
  const hasFetchTitles = fetchTitles != null;
  const scopeIsStale = suggestionScope !== options.fetchScope;
  const visibleSuggestions = scopeIsStale ? EMPTY_TITLE_SUGGESTIONS : suggestions;

  // RefObject.current can change without changing the RefObject identity (for
  // example when a keyed textarea is replaced), so observe it after every commit.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const nextElement = textareaRef.current;
    setTextareaElement((current) => current === nextElement ? current : nextElement);
  });

  useEffect(() => {
    activeQueryRef.current = activeQuery;
    suggestionsRef.current = visibleSuggestions;
    activeIndexRef.current = activeIndex;
    onTextChangeRef.current = options.onTextChange;
    fetchTitlesRef.current = fetchTitles;
  }, [
    activeIndex,
    activeQuery,
    fetchTitles,
    options.onTextChange,
    visibleSuggestions,
  ]);

  const close = useCallback(() => {
    const current = activeQueryRef.current;
    dismissedQueryRef.current = current === null ? null : querySignature(current);
    setActiveQuery(null);
    setSuggestions([]);
    setIsLoading(false);
  }, []);

  const refresh = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea === null || !hasFetchTitles) {
      setActiveQuery(null);
      return;
    }

    const nextQuery = findAutocompleteQuery(
      textarea.value,
      textarea.selectionStart,
      textarea.selectionEnd,
    );
    if (nextQuery === null || dismissedQueryRef.current === querySignature(nextQuery)) {
      setActiveQuery(null);
      setSuggestions([]);
      setIsLoading(false);
      return;
    }
    dismissedQueryRef.current = null;
    const current = activeQueryRef.current;
    const queryChanged = current?.openingIndex !== nextQuery.openingIndex ||
      current.query !== nextQuery.query;
    if (queryChanged) {
      setActiveQuery(nextQuery);
      setSuggestions([]);
      setActiveIndex(0);
      setIsLoading(true);
      setSuggestionScope(options.fetchScope);
    }
    setPosition(positionForTextarea(textarea));
  }, [hasFetchTitles, options.fetchScope, textareaRef]);

  const selectSuggestion = useCallback((index: number) => {
    const textarea = textareaRef.current;
    const suggestion = suggestionsRef.current[index];
    const query = activeQueryRef.current;
    if (
      textarea === null ||
      suggestion === undefined ||
      query === null ||
      isComposingRef.current ||
      suggestionScope !== options.fetchScope
    ) {
      return;
    }

    const currentQuery = findAutocompleteQuery(
      textarea.value,
      textarea.selectionStart,
      textarea.selectionEnd,
    );
    if (currentQuery === null || querySignature(currentQuery) !== querySignature(query)) {
      setActiveQuery(null);
      setSuggestions([]);
      setIsLoading(false);
      return;
    }

    const cursor = textarea.selectionStart;
    const replacement = `[[${suggestion.title}]]`;
    const nextText = `${textarea.value.slice(0, query.openingIndex)}${replacement}${textarea.value.slice(cursor)}`;
    const nextCursor = query.openingIndex + replacement.length;

    dismissedQueryRef.current = null;
    setActiveQuery(null);
    setSuggestions([]);
    setIsLoading(false);
    if (onTextChangeRef.current !== undefined) {
      onTextChangeRef.current(nextText);
    } else {
      setNativeTextareaValue(textarea, nextText);
    }
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(nextCursor, nextCursor);
    });
  }, [options.fetchScope, suggestionScope, textareaRef]);

  useEffect(() => {
    const textarea = textareaElement;
    if (textarea === null) return;
    const view = textarea.ownerDocument.defaultView;
    let pendingInputRefresh: number | null = null;

    const onInput = () => {
      if (view === null) {
        refresh();
        return;
      }
      if (pendingInputRefresh !== null) view.clearTimeout(pendingInputRefresh);
      // React handles controlled textarea input from a delegated listener.
      // Refresh after that handler commits so we do not render the old value
      // over the browser's edit before the app's onChange can observe it.
      pendingInputRefresh = view.setTimeout(() => {
        pendingInputRefresh = null;
        refresh();
      }, 0);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (activeQueryRef.current === null || event.isComposing || event.keyCode === 229) return;
      const count = suggestionsRef.current.length;

      if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (event.key === "ArrowDown" && count > 0) {
        event.preventDefault();
        setActiveIndex((current) => (current + 1) % count);
      } else if (event.key === "ArrowUp" && count > 0) {
        event.preventDefault();
        setActiveIndex((current) => (current - 1 + count) % count);
      } else if (event.key === "Enter" && count > 0) {
        event.preventDefault();
        selectSuggestion(activeIndexRef.current);
      }
    };
    const onDocumentPointerDown = (event: PointerEvent) => {
      const target = event.target;
      const NodeConstructor = textarea.ownerDocument.defaultView?.Node;
      if (NodeConstructor === undefined || !(target instanceof NodeConstructor) || target === textarea) {
        return;
      }
      const listbox = textarea.ownerDocument.getElementById(listboxId);
      if (listbox?.contains(target)) return;
      close();
    };
    const onCompositionStart = () => {
      isComposingRef.current = true;
    };
    const onCompositionEnd = () => {
      isComposingRef.current = false;
    };

    textarea.addEventListener("input", onInput);
    textarea.addEventListener("click", refresh);
    textarea.addEventListener("select", refresh);
    textarea.addEventListener("keydown", onKeyDown);
    textarea.addEventListener("compositionstart", onCompositionStart);
    textarea.addEventListener("compositionend", onCompositionEnd);
    textarea.ownerDocument.addEventListener("pointerdown", onDocumentPointerDown);
    refresh();
    return () => {
      textarea.removeEventListener("input", onInput);
      textarea.removeEventListener("click", refresh);
      textarea.removeEventListener("select", refresh);
      textarea.removeEventListener("keydown", onKeyDown);
      textarea.removeEventListener("compositionstart", onCompositionStart);
      textarea.removeEventListener("compositionend", onCompositionEnd);
      textarea.ownerDocument.removeEventListener("pointerdown", onDocumentPointerDown);
      if (pendingInputRefresh !== null) view?.clearTimeout(pendingInputRefresh);
    };
  }, [close, listboxId, refresh, selectSuggestion, textareaElement]);

  useEffect(() => {
    const requestTitles = fetchTitlesRef.current;
    if (activeQuery === null || requestTitles == null) return;
    const controller = new AbortController();
    const requestScope = options.fetchScope;

    void requestTitles(activeQuery.query, controller.signal).then(
      (nextSuggestions) => {
        if (controller.signal.aborted) return;
        setSuggestionScope(requestScope);
        setSuggestions(nextSuggestions);
        setActiveIndex(0);
        setIsLoading(false);
      },
      () => {
        if (controller.signal.aborted) return;
        setSuggestionScope(requestScope);
        setSuggestions([]);
        setActiveIndex(0);
        setIsLoading(false);
      },
    );
    return () => controller.abort();
  }, [activeQuery, hasFetchTitles, options.fetchScope]);

  useEffect(() => {
    const textarea = textareaElement;
    if (textarea === null || activeQuery === null) return;
    const updatePosition = () => setPosition(positionForTextarea(textarea));
    const view = textarea.ownerDocument.defaultView;
    view?.addEventListener("resize", updatePosition);
    view?.addEventListener("scroll", updatePosition, true);
    return () => {
      view?.removeEventListener("resize", updatePosition);
      view?.removeEventListener("scroll", updatePosition, true);
    };
  }, [activeQuery, textareaElement]);

  useEffect(() => {
    const textarea = textareaElement;
    if (textarea === null) return;
    const previous = new Map<string, string | null>();
    for (const attribute of ["aria-autocomplete", "aria-controls", "aria-haspopup"]) {
      previous.set(attribute, textarea.getAttribute(attribute));
    }
    textarea.setAttribute("aria-autocomplete", "list");
    textarea.setAttribute("aria-controls", listboxId);
    textarea.setAttribute("aria-haspopup", "listbox");
    return () => {
      for (const [attribute, value] of previous) {
        if (value === null) textarea.removeAttribute(attribute);
        else textarea.setAttribute(attribute, value);
      }
      textarea.removeAttribute("aria-expanded");
      textarea.removeAttribute("aria-activedescendant");
    };
  }, [listboxId, textareaElement]);

  useEffect(() => {
    const textarea = textareaElement;
    if (textarea === null) return;
    const isOpen = activeQuery !== null;
    textarea.setAttribute("aria-expanded", String(isOpen));
    if (isOpen && visibleSuggestions[activeIndex] !== undefined) {
      textarea.setAttribute("aria-activedescendant", optionId(listboxId, activeIndex));
    } else {
      textarea.removeAttribute("aria-activedescendant");
    }
  }, [activeIndex, activeQuery, listboxId, textareaElement, visibleSuggestions]);

  return {
    isOpen: activeQuery !== null,
    isLoading: isLoading || (activeQuery !== null && scopeIsStale),
    query: activeQuery?.query ?? "",
    suggestions: visibleSuggestions,
    activeIndex,
    listboxId,
    position,
    close,
    selectSuggestion,
  };
}

export interface WikilinkAutocompleteProps {
  autocomplete: WikilinkAutocompleteController;
  className?: string;
  style?: CSSProperties;
}

export function WikilinkAutocomplete({
  autocomplete,
  className,
  style,
}: WikilinkAutocompleteProps) {
  useEffect(() => {
    if (!autocomplete.isOpen || typeof document === "undefined") return;
    document
      .getElementById(optionId(autocomplete.listboxId, autocomplete.activeIndex))
      ?.scrollIntoView({ block: "nearest" });
  }, [
    autocomplete.activeIndex,
    autocomplete.isOpen,
    autocomplete.listboxId,
    autocomplete.suggestions,
  ]);

  if (!autocomplete.isOpen || autocomplete.position === null || typeof document === "undefined") {
    return null;
  }

  const { left, top, width, maxHeight } = autocomplete.position;
  return createPortal(
    <div
      id={autocomplete.listboxId}
      className={["wikilink-autocomplete", className].filter(Boolean).join(" ")}
      role="listbox"
      aria-label="Note titles"
      style={{
        position: "fixed",
        zIndex: 1000,
        left,
        top,
        width,
        maxHeight,
        overflowY: "auto",
        ...style,
      }}
    >
      {autocomplete.isLoading ? (
        <div className="wikilink-autocomplete-status" role="status">Loading…</div>
      ) : autocomplete.suggestions.length === 0 ? (
        <div className="wikilink-autocomplete-status" role="status">No matching notes</div>
      ) : (
        autocomplete.suggestions.map((suggestion, index) => (
          <button
            key={`${suggestion.kind ?? "note"}:${suggestion.id}`}
            id={optionId(autocomplete.listboxId, index)}
            className="wikilink-autocomplete-option"
            type="button"
            role="option"
            aria-selected={index === autocomplete.activeIndex}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => autocomplete.selectSuggestion(index)}
          >
            <span>{suggestion.title}</span>
            {suggestion.kind === undefined ? null : (
              <span className="wikilink-autocomplete-kind">{suggestion.kind}</span>
            )}
          </button>
        ))
      )}
    </div>,
    document.body,
  );
}

function withImagePreviews(
  content: string,
  uploadScheme?: string,
  previews?: ReadonlyMap<string, string>,
): string {
  if (uploadScheme === undefined || !previews?.size) return content;
  const pattern = new RegExp(
    `${escapeRegExp(uploadScheme)}:\\/\\/([A-Za-z0-9._-]+)`,
    "g",
  );
  return content.replace(pattern, (placeholder, token: string) => {
    return previews.get(token) ?? placeholder;
  });
}

const wikilinkUrlTransform: UrlTransform = (value, key) => {
  if (value.startsWith("blob:")) return value;
  if (value.startsWith("babel-note:")) {
    return key === "href" && parseWikilinkHref(value) !== null ? value : undefined;
  }
  return defaultUrlTransform(value);
};

function parseWikilinkHref(href: string | undefined): { titleKey: string; kind?: string } | null {
  const prefix = "babel-note://";
  if (href === undefined || !href.startsWith(prefix)) return null;
  const encoded = href.slice(prefix.length);
  const separator = encoded.indexOf("/");

  try {
    if (separator === -1) {
      const titleKey = decodeURIComponent(encoded);
      return titleKey === "" ? null : { titleKey };
    }
    const kind = decodeURIComponent(encoded.slice(0, separator));
    const titleKey = decodeURIComponent(encoded.slice(separator + 1));
    return kind === "" || titleKey === "" ? null : { titleKey, kind };
  } catch {
    return null;
  }
}

function setNativeTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const view = textarea.ownerDocument.defaultView;
  const prototype = view?.HTMLTextAreaElement.prototype;
  const setter = prototype === undefined
    ? undefined
    : Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (setter === undefined) textarea.value = value;
  else setter.call(textarea, value);
  const InputEventConstructor = view?.InputEvent ?? view?.Event;
  if (InputEventConstructor !== undefined) {
    textarea.dispatchEvent(new InputEventConstructor("input", { bubbles: true }));
  }
}

function positionForTextarea(textarea: HTMLTextAreaElement): AutocompletePosition {
  const rect = textarea.getBoundingClientRect();
  const view = textarea.ownerDocument.defaultView;
  const viewportWidth = view?.innerWidth ?? rect.right + 8;
  const viewportHeight = view?.innerHeight ?? rect.bottom + 240;
  const width = Math.min(Math.max(rect.width, 220), 420, Math.max(0, viewportWidth - 16));
  const left = Math.min(Math.max(8, rect.left), Math.max(8, viewportWidth - width - 8));
  const spaceBelow = viewportHeight - rect.bottom - 8;
  const showAbove = spaceBelow < 160 && rect.top > spaceBelow;
  const maxHeight = Math.max(80, Math.min(240, showAbove ? rect.top - 12 : spaceBelow));
  const top = showAbove ? Math.max(8, rect.top - maxHeight - 4) : rect.bottom + 4;
  return { left, top, width, maxHeight };
}

function optionId(listboxId: string, index: number): string {
  return `${listboxId}-option-${index}`;
}

function querySignature(query: AutocompleteQuery): string {
  return `${query.openingIndex}:${query.query}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
