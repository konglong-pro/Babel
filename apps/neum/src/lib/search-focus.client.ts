"use client";

import { focusSearchMatch } from "@babel-apps/platform/search/focus-client";

import type { EntrySearchFocus } from "@/lib/search-focus";

const FIELD_SELECTORS: Record<EntrySearchFocus["field"], string> = {
  title: ".document-header h1",
  tags: '[data-search-field="tags"]',
  notesMd: ".document-content .markdown-body",
  code: ".snippet-view .code-block",
  filename: ".snippet-view .code-meta span",
  language: ".snippet-view .code-meta strong",
};

export function focusEntrySearchMatch(
  root: HTMLElement,
  focus: EntrySearchFocus,
): () => void {
  return focusSearchMatch(root, focus, FIELD_SELECTORS);
}
