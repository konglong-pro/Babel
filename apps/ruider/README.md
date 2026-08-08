# Ruider

Ruider is Babel's local, single-user space for drafts and visual brainstorming.
Its primary `/canvases` workspace manages named infinite canvases with editable
cards, freehand paths, shapes, and arrows. Canvas scenes auto-save as structured
JSON in SQLite. The scaffold's Markdown notes, folders, tags, search, and managed
note images remain available under `/notes`.

From the Babel root:

```powershell
npm.cmd run dev:ruider
npm.cmd run check -w @babel-apps/ruider
```

Open `http://127.0.0.1:3007`. Private data lives in
`data/ruider/sqlite.db` and `data/ruider/uploads/notes/` in the independent
private `data/` repository. The launcher supplies absolute
`RUIDER_DATABASE_PATH` and `RUIDER_UPLOAD_DIRECTORY` values.

Canvas changes are debounced and saved automatically. Scene JSON is limited to
5 MiB and 2,000 elements so malformed or unexpectedly large writes are rejected.

Editing an existing note opens a focused **Content + Outline** window aligned
to the note-detail column. The main edit page continues to manage the title,
folder, parent page, tags, Save, and Cancel; new-note drafts remain inline.
Rendered GitHub Flavored Markdown remains available in reading mode. **Read** sits above the note-list heading in the
middle column and opens a separate reader window for either saved content or
the current live title, tags, Markdown, outline, and staged images.
Bottom-left English **Markdown Guide** and **Formula Reference** panels span the
folder and note columns.
The middle-column **Edit Templates** control manages notebook-local static
Markdown templates that can be copied into a new note.
PNG, JPEG, WebP, and GIF images up to 10 MiB can be
selected or pasted and are committed only when the note is saved. A save accepts
up to 10 MiB of Markdown, 50 new images, and 100 MiB in total; multipart transport
is limited to 160 MiB. Image mutations are serialized, and interrupted
transactions are reconciled during health checks and before later writes.

Select a concrete folder to import a UTF-8 `.md` file as a new draft. Relative
GFM image references can be matched to local image files before saving; remote
HTTP(S) image links remain remote. Import never overwrites an existing note.

## Keyboard navigation

The Ready/Edit bindings apply to Ruider's `/notes` workspace and to the outer
canvas list, tabs, and document actions. Keyboard traversal and movement of
elements inside an open canvas remain outside this scope.
`Ctrl+F6` and `Ctrl+Shift+F6` cycle the visible folder tree, note tree, tab
strip, and detail pane, skipping absent panes and remembering each pane's last
focus. Hierarchical folders and notes expose `tree`/`treeitem`; flat search
results expose `listbox`. Up/Down moves, Left/Right collapses or expands,
Home/End/PageUp/PageDown moves through supported lists, and typed letters jump
by title. `Enter` selects a folder or opens a note tab; `F2` renames a focused
folder or opens a focused note directly in edit mode. The `tablist` uses
Left/Right to move and Enter to activate. In the outer canvas list, `Enter`
opens the focused canvas and `F2` opens its rename flow.

Reordering uses `Ctrl+Alt+ArrowUp` and `Ctrl+Alt+ArrowDown`. Escape gives the
topmost dialog or overlay priority, then leaves edit mode for the reader and the
reader for the note tree; dirty-edit confirmations still apply. `Ctrl+K`
searches commands, registered actions, and titles, while `Ctrl+Alt+P` searches
titles only. `Ctrl+Alt+H` opens keyboard help. Tab defaults are
`Ctrl+Alt+ArrowRight`, `Ctrl+Alt+ArrowLeft`, and `Ctrl+Alt+W` for next, previous,
and close. Schema v1/v2 bindings are preserved during migration; a conflicting
new command remains `Unbound`. See the
[root keyboard contract](../../README.md#launcher) for the complete schema-v3
command table.

Run schema generation or migration only for an explicit database task and only
while Ruider is stopped. Use the root `npm.cmd run data:backup` workflow for
normal backups; never commit notebook data to the public Babel repository.
