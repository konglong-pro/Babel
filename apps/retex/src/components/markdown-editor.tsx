"use client";

import {
  MarkdownEditor as SharedMarkdownEditor,
  type MarkdownEditorProps as SharedMarkdownEditorProps,
} from "@babel-apps/markdown/react";

import { listNoteTitles } from "@/lib/api-client";

export type { StagedImage } from "@babel-apps/markdown/react";

const REMARK_FEATURES = ["gfm", "math"] as const;

type MarkdownEditorProps = Omit<
  SharedMarkdownEditorProps,
  | "defaultWikilinkKind"
  | "emptyPreviewText"
  | "fetchScope"
  | "fetchTitles"
  | "hintText"
  | "remarkFeatures"
  | "uploadScheme"
> & {
  enableWikilinkAutocomplete?: boolean;
  hint?: string;
};

export function MarkdownEditor({
  enableWikilinkAutocomplete = false,
  hint = "Use $…$ for inline math and $$…$$ for display math.",
  placeholder = "Use Markdown to capture your understanding…",
  rows = 18,
  ...props
}: MarkdownEditorProps) {
  return (
    <SharedMarkdownEditor
      {...props}
      defaultWikilinkKind="knowledge"
      emptyPreviewText="Your preview will appear here."
      fetchScope="retex:notes"
      fetchTitles={enableWikilinkAutocomplete ? listNoteTitles : null}
      hintText={hint}
      placeholder={placeholder}
      remarkFeatures={REMARK_FEATURES}
      rows={rows}
      uploadScheme="retex-upload"
    />
  );
}
