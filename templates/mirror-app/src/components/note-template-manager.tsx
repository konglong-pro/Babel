"use client";

import {
  useListKeyboardNavigation,
  usePaneFocus,
} from "@babel-apps/platform/navigation/react";
import { useCommandPaletteActions } from "@babel-apps/platform/shortcuts/react";
import {
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { MarkdownEditor } from "@/components/markdown-editor";
import { ConfirmButton, formatDate } from "@/components/shared";
import { getErrorMessage } from "@/lib/api-client";
import {
  NOTE_CONTENT_MAX_BYTES,
  utf8ByteLength,
} from "@/lib/note-limits";
import type { NoteTemplateDto } from "@/lib/types";

interface NoteTemplateListProps {
  templates: readonly NoteTemplateDto[];
  selectedId: number | null;
  loading?: boolean;
  referencePanelOpen?: boolean;
  onSelect: (id: number) => void;
  onCreate: () => void;
  onClose: () => void;
  onBack: () => void;
}

export function NoteTemplateList({
  templates,
  selectedId,
  loading,
  referencePanelOpen = false,
  onSelect,
  onCreate,
  onClose,
  onBack,
}: NoteTemplateListProps) {
  const { focusPane } = usePaneFocus();
  const navigationItems = useMemo(
    () => templates.map((template) => ({ id: template.id, label: template.name })),
    [templates],
  );

  function activateTemplate(id: number) {
    if (id === selectedId) {
      focusPane("detail");
      return;
    }
    onSelect(id);
    window.requestAnimationFrame(() => focusPane("detail"));
  }

  function createTemplate() {
    onCreate();
    window.requestAnimationFrame(() => focusPane("detail"));
  }

  function finishTemplateEditing() {
    onClose();
    window.requestAnimationFrame(() => focusPane("items"));
  }

  const navigation = useListKeyboardNavigation<number>({
    items: navigationItems,
    selectedId,
    onActivate: activateTemplate,
    onEdit: activateTemplate,
    label: "Template list",
  });

  useCommandPaletteActions("templates", [
    {
      id: "template.new",
      label: "New template",
      keywords: ["create"],
      group: "Templates",
      run: createTemplate,
    },
    {
      id: "template.done",
      label: "Done editing templates",
      keywords: ["back", "notes"],
      group: "Templates",
      run: finishTemplateEditing,
    },
  ]);

  return (
    <aside
      className="workspace-panel note-panel template-list-panel"
      data-babel-pane="items"
      tabIndex={-1}
      aria-label="Note templates"
      aria-hidden={referencePanelOpen}
      inert={referencePanelOpen}
    >
      <button className="mobile-back" type="button" onClick={onBack}>
        <span aria-hidden="true">←</span> Library
      </button>
      <div className="panel-heading note-list-heading">
        <div>
          <span className="eyebrow">Settings</span>
          <h2>Templates</h2>
          <p>{templates.length} {templates.length === 1 ? "template" : "templates"}</p>
        </div>
        <button className="primary-button" type="button" onClick={createTemplate}>
          New
        </button>
      </div>

      {loading ? <p className="panel-status">Loading templates…</p> : null}
      {!loading && templates.length === 0 ? (
        <div className="empty-state compact-empty">
          <span aria-hidden="true">T</span>
          <h3>No templates yet</h3>
          <p>Create reusable Markdown for new notes.</p>
        </div>
      ) : null}

      <nav className="template-list" {...navigation.listboxProps}>
        <ul role="presentation">
          {templates.map((template) => (
            <li key={template.id} role="presentation">
              <button
                type="button"
                {...navigation.getOptionProps(template.id)}
                className={selectedId === template.id ? "template-card selected" : "template-card"}
                aria-current={selectedId === template.id ? "page" : undefined}
                onClick={() => onSelect(template.id)}
              >
                <strong>{template.name}</strong>
                <time dateTime={template.updatedAt}>
                  Updated {formatDate(template.updatedAt)}
                </time>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="note-panel-footer">
        <button type="button" onClick={finishTemplateEditing}>Back to Notes</button>
      </div>
    </aside>
  );
}

interface NoteTemplateEditorProps {
  template: NoteTemplateDto | null;
  creating: boolean;
  onCancel: () => void;
  onSaved: (template: NoteTemplateDto) => Promise<void> | void;
  onDelete: (id: number) => Promise<void> | void;
  onSave: (input: {
    id: number | null;
    name: string;
    contentMd: string;
  }) => Promise<NoteTemplateDto>;
  onDirtyChange: (dirty: boolean) => void;
  onPendingChange: (pending: boolean) => void;
  onRegisterSave: (action: (() => void) | null) => void;
  onBack: () => void;
}

export function NoteTemplateEditor({
  template,
  creating,
  onCancel,
  onSaved,
  onDelete,
  onSave,
  onDirtyChange,
  onPendingChange,
  onRegisterSave,
  onBack,
}: NoteTemplateEditorProps) {
  if (!template && !creating) {
    return (
      <section
        className="detail-panel empty-state"
        data-babel-pane="detail"
        tabIndex={-1}
        aria-label="Template editor"
      >
        <button className="content-back" type="button" onClick={onBack}>
          <span aria-hidden="true">←</span> Templates
        </button>
        <span className="empty-monogram" aria-hidden="true">T</span>
        <h2>Build a reusable starting point</h2>
        <p>Select a template, or create one for future notes.</p>
      </section>
    );
  }

  return (
    <NoteTemplateForm
      template={template}
      onCancel={onCancel}
      onSaved={onSaved}
      onDelete={onDelete}
      onSave={onSave}
      onDirtyChange={onDirtyChange}
      onPendingChange={onPendingChange}
      onRegisterSave={onRegisterSave}
      onBack={onBack}
    />
  );
}

type NoteTemplateFormProps = Omit<NoteTemplateEditorProps, "creating"> & {
  template: NoteTemplateDto | null;
};

function NoteTemplateForm({
  template,
  onCancel,
  onSaved,
  onDelete,
  onSave,
  onDirtyChange,
  onPendingChange,
  onRegisterSave,
  onBack,
}: NoteTemplateFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const pendingRef = useRef(false);
  const mountedRef = useRef(false);
  const initialName = template?.name ?? "";
  const initialContent = template?.contentMd ?? "";
  const [name, setName] = useState(initialName);
  const [content, setContent] = useState(initialContent);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const contentTooLarge = utf8ByteLength(content) > NOTE_CONTENT_MAX_BYTES;
  const containsManagedImages =
    /__APP_ID__-upload:\/\//iu.test(content) ||
    /(?:^|[\s('"<])(?:\.\.\/|\/)?api\/uploads\/notes\//imu.test(content);
  const dirty = name !== initialName || content !== initialContent;

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

  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current || contentTooLarge || containsManagedImages) return;
    pendingRef.current = true;
    setPending(true);
    onPendingChange(true);
    setError("");
    try {
      const saved = await onSave({
        id: template?.id ?? null,
        name: name.trim(),
        contentMd: content,
      });
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
      await onDelete(template.id);
    } catch (caught) {
      if (mountedRef.current) setError(getErrorMessage(caught));
    } finally {
      pendingRef.current = false;
      onPendingChange(false);
      if (mountedRef.current) setPending(false);
    }
  }

  const validationError = contentTooLarge
    ? "Template Markdown must not exceed 10 MB."
    : containsManagedImages
      ? "Templates cannot contain managed note images."
      : "";

  return (
    <section
      className="detail-panel form-view template-editor"
      data-babel-pane="detail"
      tabIndex={-1}
      aria-label="Template editor"
    >
      <button className="content-back" type="button" disabled={pending} onClick={onBack}>
        <span aria-hidden="true">←</span> Templates
      </button>
      <form ref={formRef} onSubmit={submit}>
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
                description={`Delete “${template.name}”? Existing notes created from it will not change.`}
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
              disabled={pending || !name.trim() || name.trim().length > 120 || Boolean(validationError)}
              title={validationError || "Save template"}
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </header>

        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {!error && validationError ? (
          <p className="form-error" role="alert">{validationError}</p>
        ) : null}

        <label className="field">
          <span>Template name</span>
          <input
            name="name"
            autoComplete="off"
            autoFocus
            required
            maxLength={120}
            disabled={pending}
            value={name}
            placeholder="Meeting notes"
            onChange={(event) => {
              if (!pendingRef.current) setName(event.target.value);
            }}
          />
        </label>

        <MarkdownEditor
          label="Template content"
          name="contentMd"
          value={content}
          disabled={pending}
          rows={26}
          onChange={(nextContent) => {
            if (!pendingRef.current) setContent(nextContent);
          }}
        />
        <p className="editor-footnote">
          Templates contain static Markdown only. Images cannot be attached to a template.
        </p>
      </form>
    </section>
  );
}
