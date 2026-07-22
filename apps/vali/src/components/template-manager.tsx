"use client";

import { OutlinePanel } from "@babel-apps/markdown/react";
import {
  type FormEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import { MarkdownEditor } from "@/components/markdown-editor";
import { ConfirmButton, formatDate } from "@/components/shared";
import {
  createNoteTemplate,
  deleteNoteTemplate,
  getErrorMessage,
  updateNoteTemplate,
} from "@/lib/api-client";
import { documentSaveLimitError } from "@/lib/note-limits";
import type { NoteTemplateDto } from "@/lib/types";

const TEMPLATE_HEADING_ID_PREFIX = "vali-template-heading-";

interface TemplateListProps {
  templates: NoteTemplateDto[];
  selectedId: number | null;
  creating: boolean;
  loading?: boolean;
  referencePanelOpen?: boolean;
  onSelect: (id: number) => void;
  onCreate: () => void;
  onExit: () => void;
  onBack: () => void;
}

export function TemplateList({
  templates,
  selectedId,
  creating,
  loading,
  referencePanelOpen = false,
  onSelect,
  onCreate,
  onExit,
  onBack,
}: TemplateListProps) {
  return (
    <aside
      className="workspace-panel note-panel template-list-panel"
      aria-label="Note templates"
      aria-hidden={referencePanelOpen}
      inert={referencePanelOpen}
    >
      <button className="mobile-back" type="button" onClick={onBack}>
        <span aria-hidden="true">←</span> Library
      </button>
      <div className="panel-heading template-list-heading">
        <div>
          <span className="eyebrow">Settings</span>
          <h2>Templates</h2>
          <p>{templates.length} {templates.length === 1 ? "template" : "templates"}</p>
        </div>
        <div className="content-list-actions template-list-actions">
          <button type="button" onClick={onExit}>Done</button>
          <button className="primary-button" type="button" onClick={onCreate}>
            New
          </button>
        </div>
      </div>

      {loading ? <p className="panel-status">Loading templates…</p> : null}
      {!loading && templates.length === 0 && !creating ? (
        <div className="empty-state compact-empty">
          <span aria-hidden="true">T</span>
          <h3>No templates yet</h3>
          <p>Create reusable Markdown for new notes.</p>
        </div>
      ) : null}

      <nav className="template-list" aria-label="Template list">
        {creating ? (
          <div className="template-card selected" aria-current="page">
            <strong>Untitled template</strong>
            <span>Not saved</span>
          </div>
        ) : null}
        {templates.map((template) => (
          <button
            key={template.id}
            type="button"
            className={selectedId === template.id && !creating
              ? "template-card selected"
              : "template-card"}
            aria-current={selectedId === template.id && !creating ? "page" : undefined}
            onClick={() => onSelect(template.id)}
          >
            <strong>{template.name}</strong>
            <span>Updated {formatDate(template.updatedAt)}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}

interface TemplateEditorProps {
  template: NoteTemplateDto | null;
  creating: boolean;
  onSaved: (template: NoteTemplateDto) => Promise<void> | void;
  onDeleted: (id: number) => Promise<void> | void;
  onCancel: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onPendingChange: (pending: boolean) => void;
  onRegisterSave: (action: (() => void) | null) => void;
  onBack: () => void;
}

export function TemplateEditor({
  template,
  creating,
  onSaved,
  onDeleted,
  onCancel,
  onDirtyChange,
  onPendingChange,
  onRegisterSave,
  onBack,
}: TemplateEditorProps) {
  if (!template && !creating) {
    return (
      <section className="detail-panel empty-state template-editor-empty" aria-label="Template editor">
        <button className="content-back" type="button" onClick={onBack}>
          <span aria-hidden="true">←</span> Templates
        </button>
        <span className="empty-monogram" aria-hidden="true">T</span>
        <h2>Build a starting point</h2>
        <p>Select a template, or create one for recurring note structures.</p>
      </section>
    );
  }

  return (
    <TemplateForm
      template={template}
      onSaved={onSaved}
      onDeleted={onDeleted}
      onCancel={onCancel}
      onDirtyChange={onDirtyChange}
      onPendingChange={onPendingChange}
      onRegisterSave={onRegisterSave}
      onBack={onBack}
    />
  );
}

type TemplateFormProps = Omit<TemplateEditorProps, "creating">;

function TemplateForm({
  template,
  onSaved,
  onDeleted,
  onCancel,
  onDirtyChange,
  onPendingChange,
  onRegisterSave,
  onBack,
}: TemplateFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mountedRef = useRef(false);
  const pendingRef = useRef(false);
  const initialName = template?.name ?? "";
  const initialContent = template?.contentMd ?? "";
  const [name, setName] = useState(initialName);
  const [contentMd, setContentMd] = useState(initialContent);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const dirty = name !== initialName || contentMd !== initialContent;
  const limitError = documentSaveLimitError(contentMd, []);

  useEffect(() => {
    mountedRef.current = true;
    onPendingChange(false);
    return () => {
      mountedRef.current = false;
      pendingRef.current = false;
      onPendingChange(false);
    };
  }, [onPendingChange]);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    const save = () => formRef.current?.requestSubmit();
    onRegisterSave(save);
    return () => onRegisterSave(null);
  }, [onRegisterSave]);

  useEffect(() => {
    return () => onDirtyChange(false);
  }, [onDirtyChange]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current || limitError) return;
    pendingRef.current = true;
    setPending(true);
    onPendingChange(true);
    setError("");
    try {
      const input = { name: name.trim(), contentMd };
      const saved = template
        ? await updateNoteTemplate(template.id, input)
        : await createNoteTemplate(input);
      if (!mountedRef.current) return;
      onDirtyChange(false);
      await onSaved(saved);
    } catch (caught) {
      if (mountedRef.current) setError(getErrorMessage(caught));
    } finally {
      pendingRef.current = false;
      onPendingChange(false);
      if (mountedRef.current) setPending(false);
    }
  }

  async function removeTemplate() {
    if (!template || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    onPendingChange(true);
    setError("");
    try {
      await deleteNoteTemplate(template.id);
      if (!mountedRef.current) return;
      onDirtyChange(false);
      await onDeleted(template.id);
    } catch (caught) {
      if (mountedRef.current) setError(getErrorMessage(caught));
    } finally {
      pendingRef.current = false;
      onPendingChange(false);
      if (mountedRef.current) setPending(false);
    }
  }

  return (
    <section className="detail-panel form-view template-editor-panel">
      <form ref={formRef} onSubmit={submit}>
        <button className="content-back" type="button" disabled={pending} onClick={onBack}>
          <span aria-hidden="true">←</span> Templates
        </button>
        <header className="document-header form-header">
          <div>
            <span className="eyebrow">{template ? "Edit template" : "New template"}</span>
            <h1>{name.trim() || "Untitled template"}</h1>
          </div>
          <div className="document-actions">
            {template ? (
              <ConfirmButton
                className="danger-ghost"
                title="Delete template"
                description={`Delete “${template.name}”? Existing notes will not be changed.`}
                confirmLabel="Delete template"
                disabled={pending}
                onConfirm={removeTemplate}
              >
                Delete
              </ConfirmButton>
            ) : null}
            <button data-babel-command="cancel" type="button" disabled={pending} onClick={onCancel}>
              Cancel
            </button>
            <button
              data-babel-command="save"
              className="primary-button"
              type="submit"
              disabled={pending || !name.trim() || Boolean(limitError) || (template !== null && !dirty)}
              title={limitError || "Save template"}
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </header>

        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {!error && limitError ? <p className="form-error" role="alert">{limitError}</p> : null}

        <label className="field template-name-field">
          <span>Template name</span>
          <input
            name="name"
            autoComplete="off"
            required
            maxLength={120}
            disabled={pending}
            value={name}
            placeholder="Weekly review"
            onChange={(event) => {
              if (!pending) setName(event.target.value);
            }}
          />
        </label>

        <div className="editor-outline-layout">
          <MarkdownEditor
            label="Template content"
            name="contentMd"
            value={contentMd}
            disabled={pending}
            onChange={setContentMd}
            textareaRef={textareaRef}
            headingIdPrefix={TEMPLATE_HEADING_ID_PREFIX}
          />
          <OutlinePanel
            content={contentMd}
            mode="edit"
            textareaRef={textareaRef}
            headingIdPrefix={TEMPLATE_HEADING_ID_PREFIX}
          />
        </div>
        <p className="editor-footnote">
          Templates copy static Markdown into new notes. Managed note images are not supported.
        </p>
      </form>
    </section>
  );
}
