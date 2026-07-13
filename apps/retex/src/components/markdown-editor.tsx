"use client";

import type { Wikilink } from "@babel-apps/markdown/core";
import {
  MarkdownRenderer,
  type ResolvedWikilink,
  useWikilinkAutocomplete,
  WikilinkAutocomplete,
} from "@babel-apps/markdown/react";
import { useDeferredValue, useId, useRef } from "react";

import { listNoteTitles } from "@/lib/api-client";

interface MarkdownEditorProps {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  resolveWikilink?: (titleKey: string) => ResolvedWikilink | null;
  onNavigateWikilink?: (target: ResolvedWikilink, wikilink: Wikilink) => void;
  onCreateFromWikilink?: (wikilink: Wikilink) => void;
  enableWikilinkAutocomplete?: boolean;
  rows?: number;
  placeholder?: string;
  hint?: string;
}

export function MarkdownEditor({
  label,
  name,
  value,
  onChange,
  resolveWikilink,
  onNavigateWikilink,
  onCreateFromWikilink,
  enableWikilinkAutocomplete = false,
  rows = 18,
  placeholder = "Use Markdown to capture your understanding…",
  hint = "Use $…$ for inline math and $$…$$ for display math.",
}: MarkdownEditorProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const deferredValue = useDeferredValue(value);
  const autocomplete = useWikilinkAutocomplete(
    textareaRef,
    enableWikilinkAutocomplete ? listNoteTitles : null,
    {
      fetchScope: "retex:notes",
      onTextChange: onChange,
    },
  );

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
          ref={textareaRef}
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
          <MarkdownRenderer
            content={deferredValue}
            emptyText="Your preview will appear here."
            remarkFeatures={["math"]}
            defaultWikilinkKind="knowledge"
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
