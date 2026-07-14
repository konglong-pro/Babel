"use client";

import {
  MarkdownEditor as SharedMarkdownEditor,
  type MarkdownEditorProps as SharedMarkdownEditorProps,
} from "@babel-apps/markdown/react";

import { listNoteTitles } from "@/lib/api-client";

export type { StagedImage } from "@babel-apps/markdown/react";

const REMARK_FEATURES = ["gfm"] as const;

type MarkdownEditorProps = Omit<
  SharedMarkdownEditorProps,
  | "emptyPreviewText"
  | "fetchScope"
  | "fetchTitles"
  | "hintText"
  | "placeholder"
  | "remarkFeatures"
  | "uploadScheme"
>;

export function MarkdownEditor(props: MarkdownEditorProps) {
  return (
    <SharedMarkdownEditor
      {...props}
      emptyPreviewText="Your preview will appear here."
      fetchScope="__APP_ID__:notes"
      fetchTitles={listNoteTitles}
      hintText="Write Markdown with GFM tables, task lists, links, images, and [[note links]]."
      placeholder="Write a definition, example, observation, or question…"
      remarkFeatures={REMARK_FEATURES}
      uploadScheme="__APP_ID__-upload"
    />
  );
}
