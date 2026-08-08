# Neum

Neum is Babel's local, single-user computer-science notebook. It stores Markdown
knowledge entries and exact code/configuration snippets in nested folders, with
relational tags, literal search, permanent deletion, and managed images.

From the Babel root:

```powershell
npm.cmd run dev:neum
npm.cmd run check -w @babel-apps/neum
```

Open `http://127.0.0.1:3003/knowledge` for notes or `/code` for snippets.
Legacy `/entries` URLs redirect to the matching unit. Private data lives in
`data/neum/sqlite.db` and `data/neum/uploads/entries/` inside the independent
private `data/` repository. The launcher supplies absolute `NEUM_DATABASE_PATH`
and `NEUM_UPLOAD_DIRECTORY` values.

The editor preserves incomplete JSON, YAML, and other snippets exactly as typed.
**Read** sits above the entry-list heading in the middle column and opens a
separate reader window for saved or live content; knowledge entries show Markdown and snippets show both
their notes and exact code. Bottom-left English **Markdown Guide** and **Typst
Reference** panels span the folder and entry columns.
Deleting an entry is permanent and cannot be undone.
Knowledge folders can import UTF-8 `.md` files and match referenced local images
by filename; the Code unit intentionally has no Markdown-file import action.
Markdown notes and code are each limited to 10 MiB. A save may add at most 50
PNG, JPEG, WebP, or GIF images (10 MiB each), with a 100 MiB logical-save limit
and a 160 MiB multipart wire limit. Images are committed only when the entry
save succeeds.

Existing databases and older snapshot bundles may contain historical
`trash_entry` records. Neum preserves those private records for storage and
snapshot compatibility, but no longer exposes Trash UI or runtime API routes.

## Keyboard navigation

Neum follows Babel's Ready/Edit keyboard model. `Ctrl+F6` and
`Ctrl+Shift+F6` cycle the visible folder tree, entry tree, tab strip, and detail
pane, skipping absent panes and remembering each pane's last focus. Hierarchical
folders and entries expose `tree`/`treeitem`; flat search results expose
`listbox`. Up/Down moves, Left/Right collapses or expands,
Home/End/PageUp/PageDown moves through supported lists, and typed letters jump
by title. `Enter` selects a folder or opens an entry tab; `F2` renames a focused
folder or opens a focused entry directly in edit mode. The `tablist` uses
Left/Right to move and Enter to activate.

Reordering uses `Ctrl+Alt+ArrowUp` and `Ctrl+Alt+ArrowDown`. Escape gives the
topmost dialog or overlay priority, then leaves edit mode for the reader and the
reader for the entry tree; dirty-edit confirmations still apply. `Ctrl+K`
searches commands, registered actions, and titles, while `Ctrl+Alt+P` searches
titles only. `Ctrl+Alt+H` opens keyboard help. Tab defaults are
`Ctrl+Alt+ArrowRight`, `Ctrl+Alt+ArrowLeft`, and `Ctrl+Alt+W` for next, previous,
and close. Schema v1/v2 bindings are preserved during migration; a conflicting
new command remains `Unbound`. See the
[root keyboard contract](../../README.md#launcher) for the complete schema-v3
command table.

The App build runs against temporary database and upload paths, so `npm.cmd run
build -w @babel-apps/neum` does not open or modify the configured notebook data.

With Neum stopped, create a lossless snapshot bundle or validate/restore one:

```powershell
npm.cmd run snapshot:export -w @babel-apps/neum -- <output-directory>
npm.cmd run snapshot:import -w @babel-apps/neum -- <bundle-directory>
npm.cmd run snapshot:import -w @babel-apps/neum -- <bundle-directory> --apply
```

Import without `--apply` is a dry-run. Applying an import is allowed only when the
target contains no user data and only the untouched `Inbox` seed. Migrate or
restore only for an explicit data task while Neum is stopped. Use the root
`npm.cmd run data:backup` workflow for normal backups, and never commit notebook
data to the public repository.
