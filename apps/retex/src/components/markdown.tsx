"use client";

import { useDeferredValue, useId } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";

const MARKDOWN_COMPONENTS: Components = {
  h1: "h2",
  h2: "h3",
  h3: "h4",
  h4: "h5",
  h5: "h6",
};

interface MarkdownRendererProps {
  content: string;
  emptyText?: string;
}

export function MarkdownRenderer({
  content,
  emptyText = "No content yet.",
}: MarkdownRendererProps) {
  if (!content.trim()) return <p className="empty-copy">{emptyText}</p>;

  return (
    <div className="markdown-body">
      <ReactMarkdown
        components={MARKDOWN_COMPONENTS}
        remarkPlugins={[remarkMath]}
        rehypePlugins={[rehypeKatex]}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

interface MarkdownEditorProps {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  hint?: string;
}

export function MarkdownEditor({
  label,
  name,
  value,
  onChange,
  rows = 18,
  placeholder = "Use Markdown to capture your understanding…",
  hint = "Use $…$ for inline math and $$…$$ for display math.",
}: MarkdownEditorProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const deferredValue = useDeferredValue(value);

  return (
    <section className="editor-field">
      <div className="field-heading">
        <div>
          <label htmlFor={id}>{label}</label>
          <p id={hintId}>{hint}</p>
        </div>
        <span className="live-badge">Live Preview</span>
      </div>
      <div className="editor-grid">
        <textarea
          id={id}
          name={name}
          autoComplete="off"
          rows={rows}
          value={value}
          placeholder={placeholder}
          aria-describedby={hintId}
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
        />
        <div className="preview-pane" aria-label={`${label} preview`}>
          <MarkdownRenderer content={deferredValue} emptyText="Your preview will appear here." />
        </div>
      </div>
    </section>
  );
}
