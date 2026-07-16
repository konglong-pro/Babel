"use client";

import {
  MarkdownEditor as SharedMarkdownEditor,
  type MarkdownEditorProps as SharedMarkdownEditorProps,
} from "@babel-apps/markdown/react";

import { listNoteTitles } from "@/lib/api-client";

export type { StagedImage } from "@babel-apps/markdown/react";
export {
  ACCEPTED_IMAGE_TYPES,
  imageFileError,
  stageImageFile,
} from "@babel-apps/markdown/react";

type MarkdownEditorProps = Omit<
  SharedMarkdownEditorProps,
  | "fetchScope"
  | "fetchTitles"
  | "hintText"
  | "uploadScheme"
> & {
  enableWikilinkAutocomplete?: boolean;
  hint?: string;
};

export function MarkdownEditor({
  enableWikilinkAutocomplete = false,
  hint = "Use native Typst math inside $…$; add spaces just inside the delimiters for display math.",
  placeholder = "Use Markdown to capture your understanding…",
  rows = 18,
  ...props
}: MarkdownEditorProps) {
  return (
    <SharedMarkdownEditor
      {...props}
      fetchScope="retex:notes"
      fetchTitles={enableWikilinkAutocomplete ? listNoteTitles : null}
      hintText={hint}
      placeholder={placeholder}
      rows={rows}
      uploadScheme="retex-upload"
    />
  );
}
