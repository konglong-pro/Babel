"use client";

import {
  type ChangeEvent,
  type ClipboardEvent,
  useDeferredValue,
  useId,
  useMemo,
  useRef,
} from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const MARKDOWN_COMPONENTS: Components = {
  h1: "h2",
  h2: "h3",
  h3: "h4",
  h4: "h5",
  h5: "h6",
  img: ({ alt, ...props }) => {
    // Markdown may contain local, external, or unsaved blob URLs with unknown dimensions.
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...props} alt={alt ?? ""} loading="lazy" />;
  },
};

const REMARK_PLUGINS = [remarkGfm];
const ACCEPTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const PENDING_IMAGE_PATTERN = /esperanto-upload:\/\/([A-Za-z0-9._-]+)/g;

export interface StagedImage {
  token: string;
  file: File;
  previewUrl: string;
}

function previewUrlTransform(value: string): string {
  return value.startsWith("blob:") ? value : defaultUrlTransform(value);
}

function withImagePreviews(content: string, previews?: ReadonlyMap<string, string>): string {
  if (!previews?.size) return content;
  return content.replace(PENDING_IMAGE_PATTERN, (placeholder, token: string) => {
    return previews.get(token) ?? placeholder;
  });
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

interface MarkdownRendererProps {
  content: string;
  emptyText?: string;
  imagePreviews?: ReadonlyMap<string, string>;
}

export function MarkdownRenderer({
  content,
  emptyText = "No content yet.",
  imagePreviews,
}: MarkdownRendererProps) {
  const renderedContent = useMemo(
    () => withImagePreviews(content, imagePreviews),
    [content, imagePreviews],
  );

  if (!content.trim()) return <p className="empty-copy">{emptyText}</p>;

  return (
    <div className="markdown-body">
      <ReactMarkdown
        components={MARKDOWN_COMPONENTS}
        remarkPlugins={REMARK_PLUGINS}
        urlTransform={previewUrlTransform}
      >
        {renderedContent}
      </ReactMarkdown>
    </div>
  );
}

interface MarkdownEditorProps {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  onStageImage: (image: StagedImage) => void;
  onImageError: (message: string) => void;
  imagePreviews: ReadonlyMap<string, string>;
  rows?: number;
}

export function MarkdownEditor({
  label,
  name,
  value,
  onChange,
  onStageImage,
  onImageError,
  imagePreviews,
  rows = 20,
}: MarkdownEditorProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const deferredValue = useDeferredValue(value);

  function stageFiles(files: readonly File[], pasted: boolean) {
    const accepted: Array<{ image: StagedImage; markdown: string }> = [];

    for (const file of files) {
      if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
        onImageError(`${file.name || "This file"} is not a PNG, JPEG, WebP, or GIF image.`);
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        onImageError(`${file.name || "This image"} is larger than 10 MB.`);
        continue;
      }

      const token = newImageToken();
      const image = { token, file, previewUrl: URL.createObjectURL(file) };
      accepted.push({
        image,
        markdown: `![${imageAlt(file, pasted)}](esperanto-upload://${token})`,
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
    stageFiles(Array.from(event.target.files ?? []), false);
    event.target.value = "";
  }

  function pasteImages(event: ClipboardEvent<HTMLTextAreaElement>) {
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
          <p id={hintId}>Write Markdown with GFM tables, task lists, links, and images.</p>
        </div>
        <div className="editor-tools">
          <input
            ref={fileInputRef}
            className="sr-only"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            tabIndex={-1}
            onChange={chooseImages}
          />
          <button type="button" onClick={() => fileInputRef.current?.click()}>
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
          value={value}
          placeholder="Write a definition, example, observation, or question…"
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
          />
        </div>
      </div>
    </section>
  );
}
