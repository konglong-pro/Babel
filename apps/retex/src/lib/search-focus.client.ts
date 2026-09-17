"use client";

import { focusSearchMatch } from "@babel-apps/platform/search/focus-client";

import type { ArchiveSearchFocus } from "@/lib/search-focus";

const FIELD_SELECTORS: Record<ArchiveSearchFocus["field"], string> = {
  title: ".document-header h1",
  tags: '[data-search-field="tags"]',
  content: '[data-search-field="content"] .markdown-body',
  problem: '[data-search-field="problem"] .markdown-body',
  answer: '[data-search-field="answer"] .markdown-body',
  solution: '[data-search-field="solution"] .markdown-body',
};

export function focusArchiveSearchMatch(
  root: HTMLElement,
  focus: ArchiveSearchFocus,
): () => void {
  return focusSearchMatch(root, focus, FIELD_SELECTORS);
}
