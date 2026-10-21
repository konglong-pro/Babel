"use client";

import React, { type ReactNode, type Ref, useEffect, useId, useImperativeHandle, useRef } from "react";

import { useWorkspaceProcessActive } from "../pages/react";
import { listMenuPosition } from "../navigation/menu-position";

export interface ImportMenuProps {
  ref?: Ref<HTMLDetailsElement>;
  disabled?: boolean;
  describedBy?: string;
  unavailableTitle?: string;
  children?: ReactNode;
}

export function ImportMenu({ ref, disabled = false, describedBy, unavailableTitle, children }: ImportMenuProps) {
  const active = useWorkspaceProcessActive();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const popupId = useId();
  useImperativeHandle(ref, () => detailsRef.current!, []);

  useEffect(() => {
    const details = detailsRef.current;
    const summary = summaryRef.current;
    const popup = popupRef.current;
    const document = details?.ownerDocument;
    const view = document?.defaultView;
    if (!details || !summary || !popup || !document || !view) return;
    let focusAfterOpen: "first" | "last" | null = null;

    function close(restoreFocus = false) {
      details!.open = false;
      popup!.removeAttribute("data-open");
      if (typeof popup!.hidePopover === "function" && popup!.matches(":popover-open")) popup!.hidePopover();
      if (restoreFocus) summary!.focus();
    }

    const buttons = () => Array.from(popup.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
    function position() {
      if (!details!.open) return;
      const bounds = summary!.getBoundingClientRect();
      if (!summary!.getClientRects().length || bounds.bottom < 0 || bounds.top > view!.innerHeight ||
        bounds.right < 0 || bounds.left > view!.innerWidth) {
        close();
        return;
      }
      const placement = listMenuPosition(bounds, {
        width: popup!.getBoundingClientRect().width,
        height: popup!.scrollHeight + popup!.offsetHeight - popup!.clientHeight,
      }, { width: view!.innerWidth, height: view!.innerHeight });
      popup!.style.left = `${placement.left}px`;
      popup!.style.top = `${placement.top}px`;
      popup!.style.maxHeight = `${placement.maxHeight}px`;
    }

    function sync() {
      if (!details!.open || disabled || !active) {
        close();
        return;
      }
      // A native popover escapes the scroll/overflow clipping of list panes.
      // Keep a fixed-position fallback for engines without the popover API.
      if (typeof popup!.showPopover === "function") popup!.showPopover();
      else popup!.setAttribute("data-open", "true");
      position();
      if (focusAfterOpen !== null) {
        const options = buttons();
        (focusAfterOpen === "first" ? options[0] : options.at(-1))?.focus();
        focusAfterOpen = null;
      }
    }

    function keydown(event: KeyboardEvent) {
      if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing || event.key === "Process") return;
      if (!details!.open) {
        if (disabled || !active || !["ArrowDown", "ArrowUp"].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        focusAfterOpen = event.key === "ArrowDown" ? "first" : "last";
        details!.open = true;
        return;
      }
      // Preserve native Tab traversal while keeping list/pane navigation local.
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        close(true);
      } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const options = buttons();
        const index = options.indexOf(document!.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
          : event.key === "ArrowDown" ? (index + 1) % options.length
          : (index < 0 ? options.length - 1 : index - 1 + options.length) % options.length;
        options[next]?.focus();
      }
    }

    const outside = (event: PointerEvent) => {
      if (!details.contains(event.target as Node)) close();
    };
    const focusout = (event: FocusEvent) => {
      if (event.relatedTarget !== null && !details.contains(event.relatedTarget as Node)) close();
    };
    const popoverToggle = () => {
      if (typeof popup.showPopover === "function" && !popup.matches(":popover-open")) details.open = false;
    };
    details.addEventListener("toggle", sync);
    details.addEventListener("keydown", keydown);
    details.addEventListener("focusout", focusout);
    popup.addEventListener("toggle", popoverToggle);
    document.addEventListener("pointerdown", outside, true);
    view.addEventListener("resize", position);
    view.addEventListener("scroll", position, true);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(position);
    observer?.observe(summary);
    observer?.observe(popup);
    sync();
    return () => {
      details.removeEventListener("toggle", sync);
      details.removeEventListener("keydown", keydown);
      details.removeEventListener("focusout", focusout);
      popup.removeEventListener("toggle", popoverToggle);
      document.removeEventListener("pointerdown", outside, true);
      view.removeEventListener("resize", position);
      view.removeEventListener("scroll", position, true);
      observer?.disconnect();
      close();
    };
  }, [active, disabled]);

  return <details ref={detailsRef} className="babel-import-menu">
    <summary ref={summaryRef} aria-disabled={disabled || !active} aria-describedby={describedBy}
      aria-controls={popupId} title={disabled ? unavailableTitle : undefined}
      onClick={event => { if (disabled || !active) event.preventDefault(); }}>Import</summary>
    <div ref={popupRef} id={popupId} className="babel-import-menu__options babel-list-menu-options" popover="manual" aria-label="Import options">
      {children}
    </div>
  </details>;
}
