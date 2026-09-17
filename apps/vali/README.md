# Vali

Vali is Babel's local, single-user notebook. Its Notes unit organizes Markdown
documents in nested folders, while Reflection stores one Markdown document per
calendar day. Search, wikilinks, backlinks, outlines, and managed images work
across both units.

From the Babel root:

```powershell
npm.cmd run dev:vali
npm.cmd run check -w @babel-apps/vali
```

Open `http://127.0.0.1:3002`. Private data lives in
`data/vali/sqlite.db` and `data/vali/uploads/notes/` in the independent
private `data/` repository. The launcher supplies absolute
`VALI_DATABASE_PATH` and `VALI_UPLOAD_DIRECTORY` values.

The editor uses the full writing area for GitHub Flavored Markdown. In both Notes
and Reflection, **Read** sits above the content-index heading and opens a separate
reader window for saved content or the current unsaved draft and staged images. Notes also
provides bottom-left English **Markdown Guide** and **Formula Reference** panels
across the two navigation columns. The middle-column **Edit Templates** control
manages Vali-local static Markdown templates that can be copied into a new
note. PNG, JPEG,
WebP, and GIF images up to 10 MB can be selected or pasted; images are committed
to storage only when the document is saved. Notes can open one strict UTF-8
`.md` file as a draft or recursively review a Markdown folder before importing
it; Reflection exposes neither import action. Folder import maps subdirectories
without creating the selected root container and lets every file change its
Title, Folder, Parent page, and Tags. Titles must be unique across Notes and
Reflection after NFC normalization, whitespace normalization, and case folding;
conflicts are fixed manually without renaming source files. Only referenced local images inside the selected root are
staged. Link targets follow reviewed titles, and the server revalidates and
commits the full batch as one operation. Batches allow 1,000 Markdown files,
250 MiB of Markdown, and 1 GiB of images while preserving the per-note limits.

Notes and Reflection share the same save limits: Markdown is capped at 10 MiB,
one save can add at most 50 images, Markdown plus referenced new images is capped
at 100 MiB, and multipart requests are capped at 160 MiB on the wire. Image and
database mutations are serialized. Startup recovery restores quarantined files
that are still owned by either unit and deletes only generated, unowned files.

## Keyboard navigation

Notes follows Babel's Ready/Edit keyboard model. `Ctrl+F6` and
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

To verify the app without opening the formal notebook database, point the build
at temporary paths before running the workspace gate:

```powershell
$env:VALI_DATABASE_PATH = Join-Path $env:TEMP "vali-check.sqlite.db"
$env:VALI_UPLOAD_DIRECTORY = Join-Path $env:TEMP "vali-check-uploads"
npm.cmd run check -w @babel-apps/vali
```

Run schema generation or migration only for an explicit database task and only
while Vali is stopped. Use the root `npm.cmd run data:backup` workflow for
normal backups; never commit notebook data to the public Babel repository.
