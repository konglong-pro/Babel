"use client";

import {
  MarkdownEditor as SharedMarkdownEditor,
  type MarkdownEditorProps as SharedMarkdownEditorProps,
} from "@babel-apps/markdown/react";

const REMARK_FEATURES = ["gfm", "formula-math"] as const;

import { listNoteTitles } from "@/lib/api-client";

export {
  ACCEPTED_IMAGE_TYPES,
  imageFileError,
  stageImageFile,
  type StagedImage,
} from "@babel-apps/markdown/react";

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
      fetchScope="__APP_ID__:notes"
      fetchTitles={listNoteTitles}
      hintText="Write Markdown with GFM, [[note links]], and Typst math: $x$ inline or $ x $ on its own line."
      placeholder="Write a definition, example, observation, or question…"
      remarkFeatures={REMARK_FEATURES}
      uploadScheme="__APP_ID__-upload"
    />
  );
}
