# KLsche

KLsche is Babel's local, single-user language notebook. It organizes Markdown
notes in nested folders, supports tags and search, and stores managed note images
beside its SQLite database.

From the Babel root:

```powershell
npm.cmd run dev:klsche
npm.cmd run check -w @babel-apps/klsche
```

Open `http://127.0.0.1:3006`. Private data lives in
`data/klsche/sqlite.db` and `data/klsche/uploads/notes/` in the independent
private `data/` repository. The launcher supplies absolute
`KLSCHE_DATABASE_PATH` and `KLSCHE_UPLOAD_DIRECTORY` values.

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

The **Import** menu can open one UTF-8 `.md` file as a draft or recursively
review a Markdown folder before importing it. Folder import maps subdirectories
without creating the selected root container and lets every file change its
Title, Folder, Parent page, and Tags. App-wide titles are NFC-normalized,
whitespace-normalized, and case-insensitive; conflicts must be resolved
manually. Source files are never renamed or changed.
Only referenced local images inside the selected root are staged. Link targets
follow reviewed titles, and the server revalidates and commits the full batch as
one operation. Batches allow 1,000 Markdown files, 250 MiB of Markdown, and
1 GiB of images while preserving the per-note limits above.

## Keyboard navigation

KLsche follows Babel's Ready/Edit keyboard model. `Ctrl+F6` and
`Ctrl+Shift+F6` cycle the visible folder tree, note tree, tab strip, and detail
pane, skipping absent panes and remembering each pane's last focus. Hierarchical
folders and notes expose `tree`/`treeitem`; flat search results expose `listbox`.
Up/Down moves, Left/Right collapses or expands, Home/End/PageUp/PageDown moves
through supported lists, and typed letters jump by title. `Enter` selects a
folder or opens a note tab; `F2` renames a focused folder or opens a focused note
directly in edit mode. The `tablist` uses Left/Right to move and Enter to
activate.

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
while KLsche is stopped. Use the root `npm.cmd run data:backup` workflow for
normal backups; never commit notebook data to the public Babel repository.
