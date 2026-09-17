"use client";

import {
  default as React,
  type CSSProperties,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  buildPickerFolderTree,
  pickerAncestorIds,
  type PickerFolder,
  visiblePickerFolders,
} from "./picker-core";

export type { PickerFolder } from "./picker-core";

export interface FolderPickerProps {
  folders: readonly PickerFolder[];
  value: number | null;
  onChange: (id: number | null) => void;
  name?: string;
  label?: string;
  disabled?: boolean;
  required?: boolean;
  allowRoot?: boolean;
  rootLabel?: string;
  excludedIds?: ReadonlySet<number>;
}

const ROOT_KEY = "root";
type RowKey = number | typeof ROOT_KEY;

export function FolderPicker({
  folders,
  value,
  onChange,
  name,
  label = "Folder",
  disabled = false,
  required = false,
  allowRoot = false,
  rootLabel = "Root",
  excludedIds,
}: FolderPickerProps) {
  const id = useId();
  const treeId = `${id}-tree`;
  const tree = useMemo(() => buildPickerFolderTree(folders), [folders]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [activeKey, setActiveKey] = useState<RowKey | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef(new Map<RowKey, HTMLDivElement>());
  const searching = query.trim().length > 0;
  const visibleNodes = useMemo(
    () => visiblePickerFolders(tree, expandedIds, query),
    [tree, expandedIds, query],
  );
  const rootVisible = allowRoot && (!searching || query.trim().toLocaleLowerCase()
    .split(/\s+/u).every((token) => rootLabel.toLocaleLowerCase().includes(token)));
  const rowKeys: RowKey[] = [
    ...(rootVisible ? [ROOT_KEY] as const : []),
    ...visibleNodes.map((node) => node.folder.id),
  ];
  const highlightedKey = activeKey !== null && rowKeys.includes(activeKey)
    ? activeKey
    : rowKeys[0] ?? null;
  const selectedLabel = value === null
    ? allowRoot ? rootLabel : "Select folder"
    : tree.byId.get(value)?.path ?? "Select folder";

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    popupRef.current?.hidePopover?.();
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  function show() {
    if (disabled) return;
    setQuery("");
    setExpandedIds(pickerAncestorIds(tree, value));
    setActiveKey(value ?? (allowRoot ? ROOT_KEY : null));
    setOpen(true);
  }

  useEffect(() => {
    if (!open || disabled) return;
    const popup = popupRef.current;
    const trigger = triggerRef.current;
    if (!popup || !trigger) return;
    popup.showPopover?.();
    const position = () => {
      const bounds = trigger.getBoundingClientRect();
      const availableBelow = window.innerHeight - bounds.bottom - 12;
      const above = availableBelow < 220 && bounds.top > availableBelow;
      const available = above ? bounds.top - 12 : availableBelow;
      const width = Math.min(Math.max(bounds.width, 280), window.innerWidth - 16);
      popup.style.width = `${width}px`;
      popup.style.left = `${Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8))}px`;
      popup.style.maxHeight = `${Math.max(120, Math.min(420, available))}px`;
      popup.style.top = above ? "auto" : `${bounds.bottom + 6}px`;
      popup.style.bottom = above ? `${window.innerHeight - bounds.top + 6}px` : "auto";
    };
    position();
    searchRef.current?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !hostRef.current?.contains(event.target)) close();
    };
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    document.addEventListener("pointerdown", outside, true);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      document.removeEventListener("pointerdown", outside, true);
      if (popup.isConnected) popup.hidePopover?.();
    };
  }, [close, disabled, open]);

  useEffect(() => {
    if (open && highlightedKey !== null) {
      rowRefs.current.get(highlightedKey)?.scrollIntoView({ block: "nearest" });
    }
  }, [highlightedKey, open]);

  function select(key: RowKey) {
    if (disabled || (key !== ROOT_KEY && excludedIds?.has(key))) return;
    onChange(key === ROOT_KEY ? null : key);
    close(true);
  }

  function toggleExpanded(folderId: number) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || event.key === "Process") return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      if (highlightedKey !== null) select(highlightedKey);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      const index = highlightedKey === null ? -1 : rowKeys.indexOf(highlightedKey);
      const next = Math.max(0, Math.min(rowKeys.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
      setActiveKey(rowKeys[next] ?? null);
      return;
    }
    if (searching || highlightedKey === null || highlightedKey === ROOT_KEY) return;
    const node = tree.byId.get(highlightedKey);
    if (!node) return;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      event.stopPropagation();
      if (!node.children.length) return;
      if (!expandedIds.has(node.folder.id)) toggleExpanded(node.folder.id);
      else setActiveKey(node.children[0].folder.id);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      event.stopPropagation();
      if (expandedIds.has(node.folder.id)) toggleExpanded(node.folder.id);
      else if (node.parentId !== null) setActiveKey(node.parentId);
    }
  }

  return (
    <div
      className="babel-folder-picker"
      ref={hostRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) close();
      }}
    >
      <button
        ref={triggerRef}
        className="babel-folder-picker__trigger"
        type="button"
        aria-label={`${label}: ${selectedLabel}`}
        aria-haspopup="dialog"
        aria-expanded={open && !disabled}
        aria-controls={open && !disabled ? `${id}-popup` : undefined}
        disabled={disabled}
        title={selectedLabel}
        onClick={() => open ? close(true) : show()}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            event.stopPropagation();
            show();
          }
        }}
      >
        <span>{selectedLabel}</span>
        <svg aria-hidden="true" viewBox="0 0 16 16"><path d="m4 6 4 4 4-4" /></svg>
      </button>
      {(name || required) && (
        <select
          className="babel-folder-picker__form-value"
          name={name}
          aria-hidden="true"
          tabIndex={-1}
          value={value ?? ""}
          required={required && !allowRoot}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}
          onInvalid={(event) => {
            event.preventDefault();
            show();
          }}
        >
          <option value="" disabled={!allowRoot}>{allowRoot ? rootLabel : "Select folder"}</option>
          {tree.nodes.map((node) => (
            <option key={node.folder.id} value={node.folder.id} disabled={excludedIds?.has(node.folder.id)}>
              {node.path}
            </option>
          ))}
        </select>
      )}
      {open && !disabled && (
        <div
          ref={popupRef}
          id={`${id}-popup`}
          className="babel-folder-picker__popup"
          popover="manual"
          role="dialog"
          aria-label={`Choose ${label.toLocaleLowerCase()}`}
        >
          <input
            ref={searchRef}
            className="babel-folder-picker__search"
            type="text"
            role="combobox"
            aria-label={`Search ${label.toLocaleLowerCase()}`}
            aria-autocomplete="list"
            aria-haspopup="tree"
            aria-expanded="true"
            aria-controls={treeId}
            aria-activedescendant={highlightedKey === null ? undefined : `${id}-row-${highlightedKey}`}
            autoComplete="off"
            placeholder="Search folder name or path…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveKey(null);
            }}
            onKeyDown={onSearchKeyDown}
          />
          <div id={treeId} role="tree" aria-label={label} className="babel-folder-picker__tree">
            {rootVisible && (
              <div
                id={`${id}-row-${ROOT_KEY}`}
                ref={(element) => { if (element) rowRefs.current.set(ROOT_KEY, element); else rowRefs.current.delete(ROOT_KEY); }}
                role="treeitem"
                aria-level={1}
                aria-selected={value === null}
                className="babel-folder-picker__row"
                data-active={highlightedKey === ROOT_KEY || undefined}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => select(ROOT_KEY)}
              >
                <span className="babel-folder-picker__disclosure-spacer" />
                <span className="babel-folder-picker__name">{rootLabel}</span>
                {value === null && <span aria-hidden="true">✓</span>}
              </div>
            )}
            {visibleNodes.map((node, index) => {
              const folderId = node.folder.id;
              const unavailable = excludedIds?.has(folderId) ?? false;
              const hasChildren = node.children.length > 0;
              return (
                <div
                  key={folderId}
                  ref={(element) => { if (element) rowRefs.current.set(folderId, element); else rowRefs.current.delete(folderId); }}
                  id={`${id}-row-${folderId}`}
                  className="babel-folder-picker__row"
                  role="treeitem"
                  aria-level={searching ? 1 : node.depth + 1}
                  aria-posinset={searching ? index + 1 : node.siblingIndex + 1}
                  aria-setsize={searching ? visibleNodes.length : node.siblingCount}
                  aria-selected={value === folderId}
                  aria-expanded={!searching && hasChildren ? expandedIds.has(folderId) : undefined}
                  aria-disabled={unavailable || undefined}
                  data-active={highlightedKey === folderId || undefined}
                  style={{ "--folder-picker-depth": searching ? 0 : node.depth } as CSSProperties}
                  title={node.path}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => select(folderId)}
                >
                  {!searching && hasChildren ? (
                    <button
                      type="button"
                      tabIndex={-1}
                      className="babel-folder-picker__disclosure"
                      aria-label={`${expandedIds.has(folderId) ? "Collapse" : "Expand"} ${node.folder.name}`}
                      aria-expanded={expandedIds.has(folderId)}
                      onClick={(event) => {
                        event.stopPropagation();
                        setActiveKey(folderId);
                        toggleExpanded(folderId);
                      }}
                    >
                      <svg aria-hidden="true" viewBox="0 0 16 16"><path d="m6 4 4 4-4 4" /></svg>
                    </button>
                  ) : <span className="babel-folder-picker__disclosure-spacer" />}
                  <span className="babel-folder-picker__name">
                    <span>{node.folder.name}</span>
                    {searching && node.parentPath && <small>{node.parentPath}</small>}
                  </span>
                  {value === folderId && <span aria-hidden="true">✓</span>}
                </div>
              );
            })}
            {rowKeys.length === 0 && (
              <p className="babel-folder-picker__empty" role="status">
                {searching ? "No matching folders" : "No folders available"}
              </p>
            )}
          </div>
          <p className="babel-folder-picker__hint">↑↓ Navigate · ←→ Expand · Enter Select</p>
        </div>
      )}
    </div>
  );
}
