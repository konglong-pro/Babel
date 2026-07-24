"use client";

import {
  MarkdownEditor as SharedMarkdownEditor,
  type MarkdownEditorProps as SharedMarkdownEditorProps,
} from "@babel-apps/markdown/react";

import { listEntryTitles } from "@/lib/api-client";

export {
  ACCEPTED_IMAGE_TYPES,
  imageFileError,
  stageImageFile,
  type StagedImage,
} from "@babel-apps/markdown/react";

const REMARK_FEATURES = ["gfm", "formula-math"] as const;

type MarkdownEditorProps = Omit<
  SharedMarkdownEditorProps,
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
      fetchScope="neum:entries"
      fetchTitles={listEntryTitles}
      hintText="Write Markdown with GFM, [[entry links]], and Typst math: $x$ inline or $ x $ on its own line."
      placeholder="Write context, explanation, sources, or caveats…"
      remarkFeatures={REMARK_FEATURES}
      uploadScheme="neum-upload"
    />
  );
}
