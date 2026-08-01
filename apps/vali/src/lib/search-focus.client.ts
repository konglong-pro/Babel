"use client";

import { focusSearchMatch } from "@babel-apps/platform/search/focus-client";

import type { ValiSearchFocus } from "@/lib/search-focus";

const FIELD_SELECTORS: Record<ValiSearchFocus["field"], string> = {
  title: ".document-header h1",
  content: ".document-content .markdown-body",
  tags: '[data-search-field="tags"]',
};

export function focusValiSearchMatch(
  root: HTMLElement,
  focus: ValiSearchFocus,
): () => void {
  return focusSearchMatch(root, focus, FIELD_SELECTORS);
}
