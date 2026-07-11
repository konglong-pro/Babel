import { useEffect, useMemo, useState } from "react";

import { api } from "../lib/http/client";
import { renderMarkdown } from "../lib/markdown";

type Mode = "preview" | "edit";

type ReflectViewProps = {
  active: boolean;
  onMessage: (message: string) => void;
};

function getLocalDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatWeekday(value: string): string {
  return new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(new Date(`${value}T00:00:00`));
}

export function ReflectView({ active, onMessage }: ReflectViewProps) {
  const today = getLocalDate();
  const [dates, setDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState(today);
  const [savedContent, setSavedContent] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [mode, setMode] = useState<Mode>("edit");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const visibleDates = useMemo(() => {
    const values = new Set(dates);
    values.add(today);
    return [...values].sort((a, b) => b.localeCompare(a));
  }, [dates, today]);
  const isDirty = draftContent !== savedContent;

  useEffect(() => {
    let isCancelled = false;

    async function loadInitialReflection() {
      setIsLoading(true);
      try {
        const loadedDates = await api.listReflections();
        const reflection = loadedDates.includes(today) ? await api.getReflection(today) : null;
        if (isCancelled) {
          return;
        }
        const content = reflection?.content ?? "";
        setDates(loadedDates);
        setSelectedDate(today);
        setSavedContent(content);
        setDraftContent(content);
        setMode(content ? "preview" : "edit");
      } catch (error) {
        if (!isCancelled) {
          onMessage(error instanceof Error ? error.message : "Could not load reflections");
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadInitialReflection();
    return () => {
      isCancelled = true;
    };
  }, [onMessage, today]);

  async function openReflection(date: string) {
    if (date === selectedDate || isLoading || isSaving) {
      return;
    }
    if (isDirty && !window.confirm("Discard your unsaved reflection changes?")) {
      return;
    }

    onMessage("");
    if (!dates.includes(date)) {
      setSelectedDate(date);
      setSavedContent("");
      setDraftContent("");
      setMode("edit");
      return;
    }

    setIsLoading(true);
    try {
      const reflection = await api.getReflection(date);
      setSelectedDate(reflection.date);
      setSavedContent(reflection.content);
      setDraftContent(reflection.content);
      setMode("preview");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Could not load reflection");
    } finally {
      setIsLoading(false);
    }
  }

  async function saveReflection() {
    setIsSaving(true);
    onMessage("");
    try {
      const reflection = await api.saveReflection(selectedDate, draftContent);
      setSavedContent(reflection.content);
      setDraftContent(reflection.content);
      setDates((items) => (items.includes(reflection.date) ? items : [...items, reflection.date].sort().reverse()));
      setMode("preview");
      onMessage("Reflection saved");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Could not save reflection");
    } finally {
      setIsSaving(false);
    }
  }

  if (!active) {
    return null;
  }

  return (
    <main className="reflect-workspace">
      <section className="pane reflect-date-pane" aria-label="Reflection dates">
        <div className="pane-head">
          <div className="pane-title">
            <h2>Daily reflections</h2>
            <span>Markdown by date</span>
          </div>
          <span className="count-pill">{visibleDates.length}</span>
        </div>
        <div className="reflection-date-list">
          {visibleDates.map((date) => (
            <button
              key={date}
              type="button"
              className={date === selectedDate ? "reflection-date-row active" : "reflection-date-row"}
              aria-current={date === selectedDate ? "date" : undefined}
              disabled={isLoading || isSaving}
              onClick={() => void openReflection(date)}
            >
              <span>{date}</span>
              <small>{date === today ? "Today" : formatWeekday(date)}</small>
            </button>
          ))}
        </div>
        <div className="pane-tools reflect-date-help">One Markdown file per day.</div>
      </section>

      <section className="pane note-pane reflect-note-pane" aria-label="Daily reflection">
        <div className="pane-head">
          <div className="pane-title">
            <h2>{selectedDate}</h2>
            <span>{isDirty ? "Unsaved changes" : selectedDate === today ? "Today" : formatWeekday(selectedDate)}</span>
          </div>
          <div className="mode-tabs">
            <button
              type="button"
              className={mode === "preview" ? "active" : ""}
              disabled={isLoading}
              onClick={() => setMode("preview")}
            >
              Preview
            </button>
            <button
              type="button"
              className={mode === "edit" ? "active" : ""}
              disabled={isLoading}
              onClick={() => setMode("edit")}
            >
              Edit
            </button>
          </div>
        </div>

        {isLoading && <div className="empty-state">Loading reflection...</div>}

        {!isLoading && mode === "preview" && savedContent && (
          <article
            className="markdown-body"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(savedContent) }}
          />
        )}

        {!isLoading && mode === "preview" && !savedContent && (
          <div className="empty-state">No reflection yet. Choose Edit to start writing.</div>
        )}

        {!isLoading && mode === "edit" && (
          <div className="editor reflection-editor">
            <textarea
              className="content-input"
              value={draftContent}
              onChange={(event) => setDraftContent(event.target.value)}
              placeholder="Write today's reflection in Markdown..."
              aria-label={`Reflection for ${selectedDate}`}
            />
          </div>
        )}

        <div className="note-actions">
          <button type="button" onClick={() => void saveReflection()} disabled={isLoading || isSaving}>
            {isSaving ? "Saving..." : "Save"}
          </button>
        </div>
      </section>
    </main>
  );
}
