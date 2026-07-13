"use client";

import type { Wikilink } from "@babel-apps/markdown/core";
import {
  MarkdownRenderer,
  type ResolvedWikilink,
  useWikilinkAutocomplete,
  WikilinkAutocomplete,
} from "@babel-apps/markdown/react";
import {
  type ChangeEvent,
  type ClipboardEvent,
  useDeferredValue,
  useId,
  useRef,
} from "react";

import { listNoteTitles } from "@/lib/api-client";
import { NOTE_IMAGE_MAX_BYTES } from "@/lib/note-limits";

export const ACCEPTED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export interface StagedImage {
  token: string;
  file: File;
  previewUrl: string;
}

export function imageFileError(file: File): string | null {
  if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
    return `${file.name || "This file"} is not a PNG, JPEG, WebP, or GIF image.`;
  }
  if (file.size > NOTE_IMAGE_MAX_BYTES) {
    return `${file.name || "This image"} is larger than 10 MB.`;
  }
  if (file.size === 0) return `${file.name || "This image"} is empty.`;
  return null;
}

export function stageImageFile(file: File, token = newImageToken()): StagedImage {
  return { token, file, previewUrl: URL.createObjectURL(file) };
}

interface MarkdownEditorProps {
  label: string;
  name: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onStageImage: (image: StagedImage) => void;
  onImageError: (message: string) => void;
  imagePreviews: ReadonlyMap<string, string>;
  resolveWikilink?: (titleKey: string) => ResolvedWikilink | null;
  onNavigateWikilink?: (target: ResolvedWikilink, wikilink: Wikilink) => void;
  onCreateFromWikilink?: (wikilink: Wikilink) => void;
  rows?: number;
}

export function MarkdownEditor({
  label,
  name,
  value,
  disabled = false,
  onChange,
  onStageImage,
  onImageError,
  imagePreviews,
  resolveWikilink,
  onNavigateWikilink,
  onCreateFromWikilink,
  rows = 20,
}: MarkdownEditorProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const deferredValue = useDeferredValue(value);
  const autocomplete = useWikilinkAutocomplete(textareaRef, listNoteTitles, {
    fetchScope: "herodotus:notes",
    onTextChange: onChange,
  });

  function stageFiles(files: readonly File[], pasted: boolean) {
    if (disabled) return;
    const accepted: Array<{ image: StagedImage; markdown: string }> = [];

    for (const file of files) {
      const validationError = imageFileError(file);
      if (validationError !== null) {
        onImageError(validationError);
        continue;
      }

      const image = stageImageFile(file);
      accepted.push({
        image,
        markdown: `![${imageAlt(file, pasted)}](herodotus-upload://${image.token})`,
      });
      onStageImage(image);
    }

    if (accepted.length === 0) return;

    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? value.length;
    const end = textarea?.selectionEnd ?? start;
    const before = value.slice(0, start);
    const after = value.slice(end);
    const leadingBreak = before && !before.endsWith("\n") ? "\n" : "";
    const trailingBreak = after && !after.startsWith("\n") ? "\n" : "";
    const insertion = accepted.map((entry) => entry.markdown).join("\n\n");
    const next = `${before}${leadingBreak}${insertion}${trailingBreak}${after}`;
    const cursor = before.length + leadingBreak.length + insertion.length + trailingBreak.length;

    onImageError("");
    onChange(next);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(cursor, cursor);
    });
  }

  function chooseImages(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    stageFiles(files, false);
  }

  function pasteImages(event: ClipboardEvent<HTMLTextAreaElement>) {
    if (disabled) return;
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);

    if (files.length === 0) return;
    event.preventDefault();
    stageFiles(files, true);
  }

  return (
    <section className="editor-field">
      <div className="field-heading">
        <div>
          <label htmlFor={id}>{label}</label>
          <p id={hintId}>
            Write Markdown with GFM tables, task lists, links, images, and [[note links]].
          </p>
        </div>
        <div className="editor-tools">
          <input
            ref={fileInputRef}
            className="sr-only"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            disabled={disabled}
            tabIndex={-1}
            onChange={chooseImages}
          />
          <button
            type="button"
            disabled={disabled}
            onClick={() => fileInputRef.current?.click()}
          >
            Add image
          </button>
          <span className="live-badge">Live preview</span>
        </div>
      </div>
      <div className="editor-grid">
        <textarea
          ref={textareaRef}
          id={id}
          name={name}
          autoComplete="off"
          rows={rows}
          disabled={disabled}
          value={value}
          placeholder="Write a historical or literary note, quotation, interpretation, or question…"
          aria-describedby={hintId}
          spellCheck
          onPaste={pasteImages}
          onChange={(event) => onChange(event.target.value)}
        />
        <div className="preview-pane" aria-label={`${label} preview`}>
          <MarkdownRenderer
            content={deferredValue}
            emptyText="Your preview will appear here."
            imagePreviews={imagePreviews}
            uploadScheme="herodotus-upload"
            resolveWikilink={resolveWikilink}
            onNavigateWikilink={onNavigateWikilink}
            onCreateFromWikilink={onCreateFromWikilink}
          />
        </div>
      </div>
      <WikilinkAutocomplete autocomplete={autocomplete} />
    </section>
  );
}

function newImageToken(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function imageAlt(file: File, pasted: boolean): string {
  if (pasted) return "Pasted image";
  const name = file.name.trim() || "Image";
  return name.replace(/[\[\]]/g, "");
}
