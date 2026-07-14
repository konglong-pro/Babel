"use client";

import {
  MarkdownEditor as SharedMarkdownEditor,
  type MarkdownEditorProps as SharedMarkdownEditorProps,
} from "@babel-apps/markdown/react";

import { listNoteTitles } from "@/lib/api-client";

export {
  ACCEPTED_IMAGE_TYPES,
  imageFileError,
  stageImageFile,
  type StagedImage,
} from "@babel-apps/markdown/react";

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
      fetchScope="leviathan:notes"
      fetchTitles={listNoteTitles}
      hintText="Write Markdown with GFM tables, task lists, links, images, and [[note links]]."
      placeholder="Write a political or economic note, quotation, interpretation, or question…"
      remarkFeatures={REMARK_FEATURES}
      uploadScheme="leviathan-upload"
    />
  );
}
