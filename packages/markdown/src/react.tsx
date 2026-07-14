"use client";

import {
  Children,
  cloneElement,
  createContext,
  createElement,
  type CSSProperties,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type RefObject,
  isValidElement,
  useCallback,
  useContext,
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
import {
  continueFenceOnEnter,
  continueListOnEnter,
  indentListItem,
  linkFromPastedUrl,
  outdentListItem,
  toggleTaskListSelection,
  wrapInlineSelection,
  type InlineMarker,
  type TextEditResult,
} from "./editing";
import { extractOutline, outlineSlugs } from "./outline";

export type RemarkFeature = "gfm" | "math";

export interface ResolvedWikilink {
  id: number;
  kind?: string;
}

type TaskInputProps = InputHTMLAttributes<HTMLInputElement> & {
  "data-source-line"?: number;
};

const TaskToggleContext = createContext<((line: number) => void) | undefined>(undefined);

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
  /** Enables task checkbox changes to be written back by source line. */
  onToggleTask?: (line: number) => void;
  /** Optional namespace when a page renders more than one Markdown document. */
  headingIdPrefix?: string;
}

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
  onToggleTask,
  headingIdPrefix = "",
}: MarkdownRendererProps) {
  const renderedContent = useMemo(() => {
    return withImagePreviews(content, uploadScheme, imagePreviews);
  }, [content, imagePreviews, uploadScheme]);

  const headingIds = useMemo(() => {
    const outline = extractOutline(renderedContent);
    const slugs = outlineSlugs(outline);
    return new Map(outline.map((item, index) => [
      `${item.line}:${item.level}`,
      `${headingIdPrefix}${slugs[index]}`,
    ]));
  }, [headingIdPrefix, renderedContent]);

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
      h1: createHeadingComponent("h2", 1, headingIds),
      h2: createHeadingComponent("h3", 2, headingIds),
      h3: createHeadingComponent("h4", 3, headingIds),
      h4: createHeadingComponent("h5", 4, headingIds),
      h5: createHeadingComponent("h6", 5, headingIds),
      h6: createHeadingComponent("h6", 6, headingIds),
      // A module-level component must survive preview focus changes during a pointer click.
      li: MarkdownListItem,
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
      nextComponents.img = ({ alt, node, src, ...props }) => {
        void node;
        if (typeof src === "string" && src.startsWith(`${uploadScheme}://`)) {
          return (
            <span className="markdown-image-pending">
              Image awaiting file: {alt?.trim() || "Untitled image"}
            </span>
          );
        }
        // Markdown images may be local, remote, or unsaved blob URLs with unknown dimensions.
        // eslint-disable-next-line @next/next/no-img-element
        return <img {...props} src={src} alt={alt ?? ""} loading="lazy" />;
      };
    }
    return nextComponents;
  }, [
    onCreateFromWikilink,
    onNavigateWikilink,
    headingIds,
    targetsByKey,
    uploadScheme,
    wikilinksByOffset,
  ]);

  const useGfm = remarkFeatures.includes("gfm");
  const useMath = remarkFeatures.includes("math");
  const urlTransform = useMemo<UrlTransform>(() => {
    if (uploadScheme === undefined) return wikilinkUrlTransform;
    const placeholderPrefix = `${uploadScheme}://`;
    return (value, key, node) => {
      if (key === "src" && value.startsWith(placeholderPrefix)) return value;
      return wikilinkUrlTransform(value, key, node);
    };
  }, [uploadScheme]);

  if (!content.trim()) return <p className="empty-copy">{emptyText}</p>;

  return (
    <div className="markdown-body">
      <TaskToggleContext.Provider value={onToggleTask}>
        <ReactMarkdown
          components={components}
          remarkPlugins={[
            ...(useGfm ? [remarkGfm] : []),
            ...(useMath ? [remarkMath] : []),
          ]}
          rehypePlugins={useMath ? [rehypeKatex] : []}
          urlTransform={urlTransform}
        >
          {preprocessedContent}
        </ReactMarkdown>
      </TaskToggleContext.Provider>
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
  /** @deprecated Controlled textareas are now updated through a native input event. */
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
    fetchTitlesRef.current = fetchTitles;
  }, [
    activeIndex,
    activeQuery,
    fetchTitles,
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
    setNativeTextareaValue(textarea, nextText);
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

export const ACCEPTED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
export const MARKDOWN_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

export interface StagedImage {
  token: string;
  file: File;
  previewUrl: string;
}

export function imageFileError(file: File): string | null {
  if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
    return `${file.name || "This file"} is not a PNG, JPEG, WebP, or GIF image.`;
  }
  if (file.size > MARKDOWN_IMAGE_MAX_BYTES) {
    return `${file.name || "This image"} is larger than 10 MB.`;
  }
  if (file.size === 0) return `${file.name || "This image"} is empty.`;
  return null;
}

export function stageImageFile(file: File, token = newImageToken()): StagedImage {
  return { token, file, previewUrl: URL.createObjectURL(file) };
}

export interface MarkdownEditorProps {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  uploadScheme?: string;
  /** @deprecated The editor no longer renders a preview. Retained for source compatibility. */
  imagePreviews?: ReadonlyMap<string, string>;
  onStageImage?: (image: StagedImage) => void;
  onImageError?: (message: string) => void;
  /** @deprecated The editor no longer renders a preview. Retained for source compatibility. */
  remarkFeatures?: readonly RemarkFeature[];
  fetchTitles?: FetchWikilinkTitles | null;
  fetchScope?: string | number;
  /** @deprecated The editor no longer renders a preview. Retained for source compatibility. */
  defaultWikilinkKind?: string;
  /** @deprecated The editor no longer renders a preview. Retained for source compatibility. */
  resolveWikilink?: (titleKey: string) => ResolvedWikilink | null;
  /** @deprecated The editor no longer renders a preview. Retained for source compatibility. */
  onNavigateWikilink?: (target: ResolvedWikilink, wikilink: Wikilink) => void;
  /** @deprecated The editor no longer renders a preview. Retained for source compatibility. */
  onCreateFromWikilink?: (wikilink: Wikilink) => void;
  toolbarExtras?: ReactNode;
  footerExtras?: ReactNode;
  hintText?: string;
  placeholder?: string;
  /** @deprecated The editor no longer renders a preview. Retained for source compatibility. */
  emptyPreviewText?: string;
  rows?: number;
  disabled?: boolean;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  /** @deprecated The editor no longer renders a preview. Retained for source compatibility. */
  headingIdPrefix?: string;
}

export function MarkdownEditor({
  label,
  name,
  value,
  onChange,
  uploadScheme,
  onStageImage,
  onImageError,
  fetchTitles,
  fetchScope,
  toolbarExtras,
  footerExtras,
  hintText = "Write Markdown with tables, task lists, links, images, and [[note links]].",
  placeholder = "Write Markdown…",
  rows = 20,
  disabled = false,
  textareaRef: suppliedTextareaRef,
}: MarkdownEditorProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const fallbackTextareaRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = suppliedTextareaRef ?? fallbackTextareaRef;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const autocomplete = useWikilinkAutocomplete(textareaRef, fetchTitles, { fetchScope });
  const closeAutocomplete = autocomplete.close;
  const canStageImages = uploadScheme !== undefined && onStageImage !== undefined;

  useEffect(() => {
    if (disabled) closeAutocomplete();
  }, [closeAutocomplete, disabled]);

  function commit(edit: TextEditResult | null) {
    const textarea = textareaRef.current;
    if (textarea === null || edit === null || disabled) return;
    setNativeTextareaValue(textarea, edit.text);
    focusTextarea(textarea, edit.selectionStart, edit.selectionEnd);
  }

  function stageFiles(files: readonly File[], pasted: boolean) {
    const textarea = textareaRef.current;
    if (textarea === null || !canStageImages || disabled) return;
    const accepted: Array<{ image: StagedImage; markdown: string }> = [];

    for (const file of files) {
      const error = imageFileError(file);
      if (error !== null) {
        onImageError?.(error);
        continue;
      }
      const image = stageImageFile(file);
      accepted.push({
        image,
        markdown: `![${imageAlt(file, pasted)}](${uploadScheme}://${image.token})`,
      });
      onStageImage(image);
    }
    if (accepted.length === 0) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const current = textarea.value;
    const before = current.slice(0, start);
    const after = current.slice(end);
    const leadingBreak = before && !before.endsWith("\n") ? "\n" : "";
    const trailingBreak = after && !after.startsWith("\n") ? "\n" : "";
    const insertion = accepted.map(({ markdown }) => markdown).join("\n\n");
    const nextText = `${before}${leadingBreak}${insertion}${trailingBreak}${after}`;
    const cursor = before.length + leadingBreak.length + insertion.length + trailingBreak.length;
    onImageError?.("");
    commit({ text: nextText, selectionStart: cursor, selectionEnd: cursor });
  }

  function chooseImages(event: ChangeEvent<HTMLInputElement>) {
    stageFiles(Array.from(event.target.files ?? []), false);
    event.target.value = "";
  }

  function paste(event: ClipboardEvent<HTMLTextAreaElement>) {
    if (disabled) return;
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    if (files.length > 0 && canStageImages) {
      event.preventDefault();
      stageFiles(files, true);
      return;
    }

    const textarea = textareaRef.current;
    if (textarea === null) return;
    const edit = linkFromPastedUrl(
      textarea.value,
      textarea.selectionStart,
      textarea.selectionEnd,
      event.clipboardData.getData("text/plain"),
    );
    if (edit === null) return;
    event.preventDefault();
    commit(edit);
  }

  function drop(event: DragEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.dataTransfer.files);
    if (files.length === 0 || !canStageImages || disabled) return;
    event.preventDefault();
    stageFiles(files, false);
  }

  function keyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (
      disabled ||
      event.defaultPrevented ||
      event.nativeEvent.isComposing ||
      event.keyCode === 229
    ) {
      return;
    }
    if (event.key === "Enter" && autocomplete.isOpen) return;
    const textarea = event.currentTarget;
    let edit: TextEditResult | null = null;
    if (event.key === "Enter" && !event.altKey && !event.ctrlKey && !event.metaKey) {
      edit = continueFenceOnEnter(
        textarea.value,
        textarea.selectionStart,
        textarea.selectionEnd,
      ) ?? continueListOnEnter(
        textarea.value,
        textarea.selectionStart,
        textarea.selectionEnd,
      );
    } else if (event.key === "Tab") {
      edit = event.shiftKey
        ? outdentListItem(textarea.value, textarea.selectionStart, textarea.selectionEnd)
        : indentListItem(textarea.value, textarea.selectionStart, textarea.selectionEnd);
    }
    if (edit === null) return;
    event.preventDefault();
    commit(edit);
  }

  function format(marker: InlineMarker) {
    const textarea = textareaRef.current;
    if (textarea === null) return;
    commit(wrapInlineSelection(
      textarea.value,
      textarea.selectionStart,
      textarea.selectionEnd,
      marker,
    ));
  }

  function toggleTasks() {
    const textarea = textareaRef.current;
    if (textarea === null) return;
    commit(toggleTaskListSelection(
      textarea.value,
      textarea.selectionStart,
      textarea.selectionEnd,
    ));
  }

  return (
    <section className="editor-field">
      <div className="field-heading">
        <div>
          <label htmlFor={id}>{label}</label>
          <p id={hintId}>{hintText}</p>
        </div>
        <div className="editor-tools">
          <div className="editor-format-tools" aria-label="Markdown formatting">
            <button type="button" disabled={disabled} aria-label="Bold" onClick={() => format("**")}>
              <strong>B</strong>
            </button>
            <button type="button" disabled={disabled} aria-label="Italic" onClick={() => format("*")}>
              <em>I</em>
            </button>
            <button type="button" disabled={disabled} aria-label="Inline code" onClick={() => format("`") }>
              <code>&lt;/&gt;</code>
            </button>
            <button type="button" disabled={disabled} aria-label="Task list" onClick={toggleTasks}>
              ☑
            </button>
          </div>
          {canStageImages ? (
            <>
              <input
                ref={fileInputRef}
                className="sr-only"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                tabIndex={-1}
                disabled={disabled}
                onChange={chooseImages}
              />
              <button
                type="button"
                disabled={disabled}
                onClick={() => fileInputRef.current?.click()}
              >
                Add image
              </button>
            </>
          ) : null}
          {toolbarExtras}
        </div>
      </div>
      <div className="editor-grid">
        <textarea
          ref={textareaRef}
          id={id}
          name={name}
          autoComplete="off"
          rows={rows}
          value={value}
          placeholder={placeholder}
          aria-describedby={hintId}
          spellCheck
          disabled={disabled}
          onPaste={paste}
          onDrop={drop}
          onDragOver={(event) => {
            if (canStageImages && !disabled && event.dataTransfer.types.includes("Files")) {
              event.preventDefault();
            }
          }}
          onKeyDown={keyDown}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      {footerExtras}
      {disabled ? null : <WikilinkAutocomplete autocomplete={autocomplete} />}
    </section>
  );
}

export interface OutlinePanelProps {
  content: string;
  mode: "edit" | "read";
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  headingIdPrefix?: string;
  className?: string;
  title?: string;
}

export function OutlinePanel({
  content,
  mode,
  textareaRef,
  headingIdPrefix = "",
  className,
  title = "Outline",
}: OutlinePanelProps) {
  const outline = useMemo(() => extractOutline(content), [content]);
  const slugs = useMemo(() => outlineSlugs(outline), [outline]);
  if (outline.length === 0) return null;

  function navigate(index: number) {
    const item = outline[index];
    if (item === undefined) return;
    if (mode === "edit") {
      const textarea = textareaRef?.current;
      if (textarea === undefined || textarea === null) return;
      textarea.focus();
      textarea.setSelectionRange(item.offset, item.offset);
      const view = textarea.ownerDocument.defaultView;
      const computedLineHeight = view === null
        ? Number.NaN
        : Number.parseFloat(view.getComputedStyle(textarea).lineHeight);
      const lineHeight = Number.isFinite(computedLineHeight) ? computedLineHeight : 24;
      textarea.scrollTo({
        top: Math.max(0, (item.line - 1) * lineHeight - textarea.clientHeight / 3),
      });
      return;
    }
    const ownerDocument = textareaRef?.current?.ownerDocument ??
      (typeof document === "undefined" ? null : document);
    ownerDocument
      ?.getElementById(`${headingIdPrefix}${slugs[index]}`)
      ?.scrollIntoView({ block: "start" });
  }

  return (
    <nav className={["outline-panel", className].filter(Boolean).join(" ")} aria-label={title}>
      <details open>
        <summary>{title}</summary>
        <ol>
          {outline.map((item, index) => (
            <li key={`${item.offset}:${item.level}`} className={`outline-level-${item.level}`}>
              <button type="button" onClick={() => navigate(index)}>
                {item.text || "Untitled heading"}
              </button>
            </li>
          ))}
        </ol>
      </details>
    </nav>
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

function createHeadingComponent(
  tag: "h2" | "h3" | "h4" | "h5" | "h6",
  sourceLevel: number,
  headingIds: ReadonlyMap<string, string>,
): NonNullable<Components["h1"]> {
  return function MarkdownHeading({ node, ...props }) {
    const line = node?.position?.start.line;
    const id = line === undefined ? undefined : headingIds.get(`${line}:${sourceLevel}`);
    return createElement(tag, { ...props, id });
  };
}

const MarkdownListItem: NonNullable<Components["li"]> = function MarkdownListItem({
  node,
  children,
  ...props
}) {
  const onToggleTask = useContext(TaskToggleContext);
  const sourceLine = node?.position?.start.line;
  const editable = sourceLine !== undefined && onToggleTask !== undefined;
  const nextChildren = editable
    ? enableTaskCheckboxes(children, sourceLine, onToggleTask)
    : children;
  return <li {...props}>{nextChildren}</li>;
};

function enableTaskCheckboxes(
  children: ReactNode,
  sourceLine: number,
  onToggleTask: (line: number) => void,
): ReactNode {
  return Children.map(children, (child) => {
    if (!isValidElement<TaskInputProps & { children?: ReactNode }>(child)) return child;
    if (child.type === "input" && child.props.type === "checkbox") {
      return cloneElement(child as ReactElement<TaskInputProps>, {
        disabled: false,
        readOnly: false,
        "data-source-line": sourceLine,
        onChange: () => onToggleTask(sourceLine),
      });
    }
    if (child.props.children === undefined) return child;
    return cloneElement(child, {
      children: enableTaskCheckboxes(child.props.children, sourceLine, onToggleTask),
    });
  });
}

function newImageToken(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function imageAlt(file: File, pasted: boolean): string {
  if (pasted) return "Pasted image";
  const name = file.name.trim() || "Image";
  return name.replace(/[\[\]]/gu, "");
}

function focusTextarea(
  textarea: HTMLTextAreaElement,
  selectionStart: number,
  selectionEnd: number,
): void {
  const focus = () => {
    textarea.focus();
    textarea.setSelectionRange(selectionStart, selectionEnd);
  };
  const view = textarea.ownerDocument.defaultView;
  if (view === null) focus();
  else view.requestAnimationFrame(focus);
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
  const current = textarea.value;
  if (current === value) return;
  let start = 0;
  while (start < current.length && start < value.length && current[start] === value[start]) {
    start += 1;
  }
  let currentEnd = current.length;
  let valueEnd = value.length;
  while (
    currentEnd > start &&
    valueEnd > start &&
    current[currentEnd - 1] === value[valueEnd - 1]
  ) {
    currentEnd -= 1;
    valueEnd -= 1;
  }

  textarea.focus();
  textarea.setSelectionRange(start, currentEnd);
  const replacement = value.slice(start, valueEnd);
  if (textarea.ownerDocument.execCommand("insertText", false, replacement)) return;

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
