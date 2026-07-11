"use client";

/* eslint-disable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */

import { useEffect, useMemo, useState } from "react";

import { api } from "../lib/http/client";
import { renderMarkdown } from "../lib/markdown";
import type { Category, Entry, ImportResult, SearchResult } from "../lib/vali/types";
import { ReflectView } from "./reflect-view";

type Mode = "preview" | "edit";
type Section = "vault" | "reflect";
type DragItem = { type: "category" | "entry"; id: string } | null;

function splitAliases(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatDate(value: string): string {
  return value.slice(0, 10);
}

function moveItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  const nextItems = [...items];
  const [movedItem] = nextItems.splice(fromIndex, 1);
  nextItems.splice(toIndex, 0, movedItem);
  return nextItems;
}

export default function ValiApp() {
  const [activeSection, setActiveSection] = useState<Section>("vault");
  const [hasOpenedReflect, setHasOpenedReflect] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<Entry | null>(null);
  const [mode, setMode] = useState<Mode>("preview");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftAliases, setDraftAliases] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [categoryNameDraft, setCategoryNameDraft] = useState("");
  const [draftCategoryContent, setDraftCategoryContent] = useState("");
  const [newEntryTitle, setNewEntryTitle] = useState("");
  const [newEntryAliases, setNewEntryAliases] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [message, setMessage] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [dragItem, setDragItem] = useState<DragItem>(null);

  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt)),
    [categories]
  );
  const selectedCategory = sortedCategories.find((category) => category.id === selectedCategoryId);
  const selectedEntryAliasText = selectedEntry?.aliases.join(" / ") || "No aliases";
  const activeNoteTitle = selectedEntry?.title ?? selectedCategory?.name ?? "Note";
  const activeNoteDescription = selectedEntry
    ? selectedEntryAliasText
    : selectedCategory
      ? "Category note"
      : "Select a category or entry";
  const activePreviewContent = selectedEntry?.content ?? selectedCategory?.content ?? "";
  const hasActiveNote = Boolean(selectedEntry || selectedCategory);

  useEffect(() => {
    void loadCategories();
  }, []);

  useEffect(() => {
    if (!selectedCategoryId) {
      setEntries([]);
      return;
    }
    void loadEntries(selectedCategoryId);
  }, [selectedCategoryId]);

  useEffect(() => {
    setCategoryNameDraft(selectedCategory?.name ?? "");
  }, [selectedCategory?.name]);

  useEffect(() => {
    if (!selectedEntry) {
      setDraftCategoryContent(selectedCategory?.content ?? "");
    }
  }, [selectedCategory?.content, selectedCategory?.id, selectedEntry]);

  useEffect(() => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      setSearchResults([]);
      return;
    }
    let isCancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const results = await api.search(trimmedQuery);
        if (!isCancelled) {
          setSearchResults(results);
        }
      } catch (error) {
        if (!isCancelled) {
          setMessage(error instanceof Error ? error.message : "Search failed");
        }
      }
    }, 160);
    return () => {
      isCancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  async function loadCategories(preferredId?: string) {
    const loaded = await api.listCategories();
    setCategories(loaded);
    const nextId = preferredId || selectedCategoryId || loaded[0]?.id || "";
    setSelectedCategoryId(loaded.some((category) => category.id === nextId) ? nextId : loaded[0]?.id || "");
  }

  async function loadEntries(categoryId: string) {
    const loaded = await api.listEntries(categoryId);
    setEntries(loaded.map((entry, index) => ({ ...entry, order: entry.order ?? index + 1 })));
  }

  async function runAction(action: () => Promise<void>) {
    setIsBusy(true);
    setMessage("");
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Action failed");
    } finally {
      setIsBusy(false);
    }
  }

  async function openEntry(entryId: string, categoryId?: string) {
    await runAction(async () => {
      if (categoryId && categoryId !== selectedCategoryId) {
        setSelectedCategoryId(categoryId);
      }
      const entry = await api.getEntry(entryId);
      setSelectedEntry(entry);
      setDraftTitle(entry.title);
      setDraftAliases(entry.aliases.join("\n"));
      setDraftContent(entry.content);
      setMode("preview");
      setQuery("");
      setSearchResults([]);
    });
  }

  function openCategory(categoryId: string) {
    const category = categories.find((item) => item.id === categoryId);
    setSelectedCategoryId(categoryId);
    setSelectedEntry(null);
    setDraftTitle("");
    setDraftAliases("");
    setDraftContent("");
    setDraftCategoryContent(category?.content ?? "");
    setMode("preview");
    setQuery("");
    setSearchResults([]);
  }

  async function addCategory() {
    await runAction(async () => {
      const category = await api.createCategory(newCategoryName);
      setNewCategoryName("");
      setSelectedEntry(null);
      setDraftCategoryContent(category.content);
      setMode("preview");
      await loadCategories(category.id);
    });
  }

  async function renameCategory() {
    if (!selectedCategory) {
      return;
    }
    await runAction(async () => {
      const updated = await api.patchCategory(selectedCategory.id, { name: categoryNameDraft });
      await loadCategories(updated.id);
    });
  }

  async function deleteCategory() {
    if (!selectedCategory || !window.confirm(`Delete category "${selectedCategory.name}"?`)) {
      return;
    }
    await runAction(async () => {
      await api.deleteCategory(selectedCategory.id);
      setSelectedEntry(null);
      setMode("preview");
      await loadCategories();
    });
  }

  async function reorderCategory(targetId: string) {
    if (dragItem?.type !== "category" || dragItem.id === targetId) {
      return;
    }
    const sourceId = dragItem.id;
    const fromIndex = sortedCategories.findIndex((category) => category.id === sourceId);
    const toIndex = sortedCategories.findIndex((category) => category.id === targetId);
    if (fromIndex < 0 || toIndex < 0) {
      return;
    }
    const reordered = moveItem(sortedCategories, fromIndex, toIndex).map((category, index) => ({
      ...category,
      order: index + 1
    }));
    setCategories(reordered);
    await runAction(async () => {
      await Promise.all(reordered.map((category) => api.patchCategory(category.id, { order: category.order })));
      await loadCategories(sourceId);
    });
  }

  async function reorderEntry(targetId: string) {
    if (dragItem?.type !== "entry" || dragItem.id === targetId) {
      return;
    }
    const sourceId = dragItem.id;
    const fromIndex = entries.findIndex((entry) => entry.id === sourceId);
    const toIndex = entries.findIndex((entry) => entry.id === targetId);
    if (fromIndex < 0 || toIndex < 0) {
      return;
    }
    const reordered = moveItem(entries, fromIndex, toIndex).map((entry, index) => ({
      ...entry,
      order: index + 1
    }));
    setEntries(reordered);
    await runAction(async () => {
      await Promise.all(reordered.map((entry) => api.patchEntry(entry.id, { order: entry.order })));
    });
  }

  async function addEntry() {
    if (!selectedCategoryId) {
      return;
    }
    await runAction(async () => {
      const entry = await api.createEntry({
        title: newEntryTitle,
        aliases: splitAliases(newEntryAliases),
        categoryId: selectedCategoryId
      });
      setNewEntryTitle("");
      setNewEntryAliases("");
      await loadEntries(selectedCategoryId);
      await openEntry(entry.id, entry.categoryId);
    });
  }

  async function importEntries() {
    if (!selectedCategoryId) {
      return;
    }
    await runAction(async () => {
      const items = importText
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean);
      const result = await api.importEntries(selectedCategoryId, items);
      setImportResult(result);
      setImportText("");
      await loadEntries(selectedCategoryId);
    });
  }

  async function saveEntry() {
    if (!selectedEntry) {
      return;
    }
    await runAction(async () => {
      const updated = await api.patchEntry(selectedEntry.id, {
        title: draftTitle,
        aliases: splitAliases(draftAliases),
        categoryId: selectedEntry.categoryId,
        content: draftContent
      });
      setSelectedEntry(updated);
      setDraftTitle(updated.title);
      setDraftAliases(updated.aliases.join("\n"));
      setDraftContent(updated.content);
      await loadEntries(updated.categoryId);
      setMode("preview");
      setMessage("Saved");
    });
  }

  async function saveCategoryNote() {
    if (!selectedCategory) {
      return;
    }
    await runAction(async () => {
      const updated = await api.patchCategory(selectedCategory.id, {
        content: draftCategoryContent
      });
      setCategories((items) => items.map((category) => (category.id === updated.id ? updated : category)));
      setDraftCategoryContent(updated.content);
      setMode("preview");
      setMessage("Saved");
    });
  }

  async function saveNote() {
    if (selectedEntry) {
      await saveEntry();
      return;
    }
    await saveCategoryNote();
  }

  async function deleteEntry() {
    if (!selectedEntry || !window.confirm(`Delete entry "${selectedEntry.title}"?`)) {
      return;
    }
    await runAction(async () => {
      const categoryId = selectedEntry.categoryId;
      await api.deleteEntry(selectedEntry.id);
      setSelectedEntry(null);
      setDraftTitle("");
      setDraftAliases("");
      setDraftContent("");
      setMode("preview");
      await loadEntries(categoryId);
    });
  }

  function openSection(section: Section) {
    if (section === "reflect") {
      setHasOpenedReflect(true);
    }
    setActiveSection(section);
    setMessage("");
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-name">Vali</div>
        </div>
        <nav className="topbar-nav" aria-label="Primary navigation">
          <button
            type="button"
            className={activeSection === "vault" ? "active" : ""}
            aria-current={activeSection === "vault" ? "page" : undefined}
            onClick={() => openSection("vault")}
          >
            Vault
          </button>
          <button
            type="button"
            className={activeSection === "reflect" ? "active" : ""}
            aria-current={activeSection === "reflect" ? "page" : undefined}
            onClick={() => openSection("reflect")}
          >
            Reflect
          </button>
        </nav>
        <div
          className={activeSection === "vault" ? "topbar-tools" : "topbar-tools is-placeholder"}
          aria-hidden={activeSection === "reflect" ? "true" : undefined}
        >
          <div className="topbar-meta" aria-label="Vault overview">
          <span>{sortedCategories.length} categories</span>
          <span>{entries.length} entries</span>
          </div>
          <div className="search">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search stocks, aliases, or notes..."
            aria-label="Search stock entries"
          />
          {searchResults.length > 0 && (
            <div className="search-results">
              {searchResults.map((result) => (
                <button
                  key={result.id}
                  className="search-result"
                  type="button"
                  onClick={() => void openEntry(result.id, result.categoryId)}
                >
                  <span>{result.title}</span>
                  <small>
                    Category: {result.categoryName || result.categoryId} · Updated: {formatDate(result.updatedAt)}
                  </small>
                </button>
              ))}
            </div>
          )}
          </div>
        </div>
      </header>

      {activeSection === "vault" && (
        <main className="workspace">
        <section className="pane category-pane" aria-label="Categories">
          <div className="pane-head">
            <div className="pane-title">
              <h2>Categories</h2>
              <span>{sortedCategories.length} groups</span>
            </div>
          </div>
          <div className="category-list">
            {sortedCategories.map((category) => (
              <button
                key={category.id}
                type="button"
                className={[
                  category.id === selectedCategoryId ? "row active" : "row",
                  dragItem?.type === "category" && dragItem.id === category.id ? "dragging" : ""
                ]
                  .filter(Boolean)
                  .join(" ")}
                draggable={!isBusy}
                onClick={() => openCategory(category.id)}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", category.id);
                  setDragItem({ type: "category", id: category.id });
                }}
                onDragOver={(event) => {
                  if (dragItem?.type === "category" && dragItem.id !== category.id) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  void reorderCategory(category.id);
                }}
                onDragEnd={() => setDragItem(null)}
              >
                <span>{category.name}</span>
              </button>
            ))}
          </div>
          <div className="pane-tools">
            <input
              value={categoryNameDraft}
              onChange={(event) => setCategoryNameDraft(event.target.value)}
              placeholder="Category name"
            />
            <div className="split-actions">
              <button type="button" onClick={() => void renameCategory()} disabled={!selectedCategory || isBusy}>
                Rename
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => void deleteCategory()}
                disabled={!selectedCategory || isBusy}
              >
                Delete
              </button>
            </div>
            <div className="add-line">
              <input
                value={newCategoryName}
                onChange={(event) => setNewCategoryName(event.target.value)}
                placeholder="New category"
              />
              <button type="button" onClick={() => void addCategory()} disabled={!newCategoryName.trim() || isBusy}>
                +
              </button>
            </div>
          </div>
        </section>

        <section className="pane entry-pane" aria-label="Entry list">
          <div className="pane-head">
            <div className="pane-title">
              <h2>Entries</h2>
              <span>{selectedCategory?.name ?? "No category selected"}</span>
            </div>
            <span className="count-pill">{entries.length}</span>
          </div>
          <div className="entry-list">
            {entries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={[
                  entry.id === selectedEntry?.id ? "entry-row active" : "entry-row",
                  dragItem?.type === "entry" && dragItem.id === entry.id ? "dragging" : ""
                ]
                  .filter(Boolean)
                  .join(" ")}
                draggable={!isBusy}
                onClick={() => void openEntry(entry.id)}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", entry.id);
                  setDragItem({ type: "entry", id: entry.id });
                }}
                onDragOver={(event) => {
                  if (dragItem?.type === "entry" && dragItem.id !== entry.id) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  void reorderEntry(entry.id);
                }}
                onDragEnd={() => setDragItem(null)}
              >
                <span className="entry-row-top">
                  <span>{entry.title}</span>
                  <time>{formatDate(entry.updatedAt)}</time>
                </span>
                {entry.aliases.length > 0 && <small>{entry.aliases.join(" / ")}</small>}
              </button>
            ))}
          </div>
          <div className="pane-tools">
            <input
              value={newEntryTitle}
              onChange={(event) => setNewEntryTitle(event.target.value)}
              placeholder="Stock name"
            />
            <input
              value={newEntryAliases}
              onChange={(event) => setNewEntryAliases(event.target.value)}
              placeholder="Aliases, comma separated"
            />
            <button
              type="button"
              className="primary"
              onClick={() => void addEntry()}
              disabled={!newEntryTitle.trim() || !selectedCategoryId || isBusy}
            >
              New entry
            </button>
            <button type="button" onClick={() => setImportOpen((value) => !value)}>
              Import
            </button>
            {importOpen && (
              <div className="import-box">
                <textarea
                  value={importText}
                  onChange={(event) => setImportText(event.target.value)}
                  placeholder={"Apple\nMicrosoft\nNvidia"}
                />
                <button type="button" onClick={() => void importEntries()} disabled={!importText.trim() || isBusy}>
                  Batch import
                </button>
                {importResult && (
                  <div className="result-text">
                    created: {importResult.created.length} · skipped: {importResult.skipped.length}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        <section className="pane note-pane" aria-label="Note content">
          <div className="pane-head">
            <div className="pane-title">
              <h2>{activeNoteTitle}</h2>
              <span>{activeNoteDescription}</span>
            </div>
            {hasActiveNote && (
              <div className="mode-tabs">
                <button type="button" className={mode === "preview" ? "active" : ""} onClick={() => setMode("preview")}>
                  Preview
                </button>
                <button type="button" className={mode === "edit" ? "active" : ""} onClick={() => setMode("edit")}>
                  Edit
                </button>
              </div>
            )}
          </div>

          {!hasActiveNote && <div className="empty-state">Select or create a category</div>}

          {hasActiveNote && mode === "preview" && (
            <article
              className="markdown-body"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(activePreviewContent) }}
            />
          )}

          {selectedEntry && mode === "edit" && (
            <div className="editor">
              <input
                value={draftTitle}
                onChange={(event) => setDraftTitle(event.target.value)}
                placeholder="Title"
              />
              <textarea
                className="aliases-input"
                value={draftAliases}
                onChange={(event) => setDraftAliases(event.target.value)}
                placeholder="Aliases, one per line or comma separated"
              />
              <textarea
                className="content-input"
                value={draftContent}
                onChange={(event) => setDraftContent(event.target.value)}
                placeholder="Markdown note"
              />
            </div>
          )}

          {!selectedEntry && selectedCategory && mode === "edit" && (
            <div className="editor category-editor">
              <textarea
                className="content-input"
                value={draftCategoryContent}
                onChange={(event) => setDraftCategoryContent(event.target.value)}
                placeholder="Markdown note"
              />
            </div>
          )}

          {hasActiveNote && (
            <div className="note-actions">
              <button type="button" onClick={() => void saveNote()} disabled={isBusy}>
                Save
              </button>
              {selectedEntry && (
                <button type="button" className="danger" onClick={() => void deleteEntry()} disabled={isBusy}>
                  Delete entry
                </button>
              )}
            </div>
          )}
        </section>
        </main>
      )}

      {hasOpenedReflect && <ReflectView active={activeSection === "reflect"} onMessage={setMessage} />}

      {message && <div className="status-line">{message}</div>}
    </div>
  );
}
