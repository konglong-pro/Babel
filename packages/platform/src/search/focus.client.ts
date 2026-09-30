"use client";

import { literalIndexOf } from "./text";
import type { SearchFocus } from "./focus";

const SEARCH_FOCUS_DURATION_MS = 12_000;
const SEARCH_BLOCK_SELECTOR = "h1, h2, h3, h4, h5, h6, p, li, pre, blockquote, td, th";
const SOURCE_FOCUS_SELECTOR = '[data-search-source-focus="true"]';

export type SearchFocusSelectors<Field extends string> = Partial<Record<Field, string>>;

export function focusSearchMatch<Field extends string>(
  root: HTMLElement,
  focus: SearchFocus<Field>,
  selectors: SearchFocusSelectors<Field>,
): () => void {
  const selector = selectors[focus.field];
  if (selector === undefined) return () => undefined;
  const region = root.querySelector<HTMLElement>(selector);
  if (region === null) return () => undefined;

  const target = findFirstBlockMatch(region, focus.query) ?? region;
  revealSearchTarget(target);
  target.classList.add("babel-search-focus-target");
  target.setAttribute("data-babel-search-focus-target", "true");

  const view = root.ownerDocument.defaultView;
  const reducedMotion = view?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  target.scrollIntoView({
    block: "center",
    inline: "nearest",
    behavior: reducedMotion ? "auto" : "smooth",
  });

  const timer = view?.setTimeout(cleanup, SEARCH_FOCUS_DURATION_MS);
  let cleaned = false;

  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    if (timer !== undefined) view?.clearTimeout(timer);
    target.classList.remove("babel-search-focus-target");
    target.removeAttribute("data-babel-search-focus-target");
  }

  return cleanup;
}

export function revealSearchTarget(target: HTMLElement): void {
  let parent = target.parentElement;
  while (parent !== null) {
    if (parent.tagName === "DETAILS") (parent as HTMLDetailsElement).open = true;
    parent = parent.parentElement;
  }
}

function findFirstBlockMatch(region: HTMLElement, query: string): HTMLElement | null {
  const sourceTargets = [...region.querySelectorAll<HTMLElement>(SOURCE_FOCUS_SELECTOR)]
    .filter((candidate) => candidate.querySelector(SOURCE_FOCUS_SELECTOR) === null);
  if (sourceTargets.length > 0) {
    for (const target of sourceTargets) {
      if (literalIndexOf(target.textContent ?? "", query) >= 0) return target;
    }
    return sourceTargets[0]!;
  }

  const blocks = region.matches(SEARCH_BLOCK_SELECTOR)
    ? [region]
    : [...region.querySelectorAll<HTMLElement>(SEARCH_BLOCK_SELECTOR)];
  for (const block of blocks) {
    const nestedMatch = [...block.querySelectorAll<HTMLElement>(SEARCH_BLOCK_SELECTOR)]
      .some((nested) => literalIndexOf(nested.textContent ?? "", query) >= 0);
    if (nestedMatch) continue;
    if (literalIndexOf(block.textContent ?? "", query) >= 0) return block;
  }
  return literalIndexOf(region.textContent ?? "", query) >= 0 ? region : null;
}
