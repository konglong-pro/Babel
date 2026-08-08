# __APP_NAME__

__APP_NAME__ is Babel's local, single-user language notebook. It organizes Markdown
notes in nested folders, supports tags and search, and stores managed note images
beside its SQLite database.

From the Babel root:

```powershell
npm.cmd run dev:__APP_ID__
npm.cmd run check -w @babel-apps/__APP_ID__
```

Open `http://127.0.0.1:__APP_PORT__`. Private data lives in
`data/__APP_ID__/sqlite.db` and `data/__APP_ID__/uploads/notes/` in the independent
private `data/` repository. The launcher supplies absolute
`__APP_ENV_PREFIX___DATABASE_PATH` and `__APP_ENV_PREFIX___UPLOAD_DIRECTORY` values.

Saved notes open in app-level page tabs. Multiple notes can remain mounted in
read or edit mode at once; selecting an already open note focuses its tab.
Unsaved drafts use temporary tabs until first save, and dirty tabs require an
explicit Save, Discard, or Cancel choice before closing.

The root layout owns a persistent workspace-process host. Notes remains mounted
while another registered library is active, and page tabs use soft Next routing.
When adding a future library, register its pathname, scope, and legacy page kind
in `src/lib/workspace-process.ts`, render its concrete workspace from
`src/components/workspace-process-host.tsx`, and give every page descriptor the
same scope. Page keys are application-global identities, so every library must
use distinct keys; prefer `scopedPageKey(scope, localKey)` from
`@babel-apps/platform/pages/core`. Internal library switches must never close
dirty pages; only explicit page close or leaving the application may ask to save
or discard. The active workspace history guard uses
`preserveOnHistoryNavigation: true`, so browser
Back/Forward also hides and restores processes without closing them.

Folders and subfolders can be reordered with their drag handle, or with
`Ctrl+Alt+ArrowUp`/`Ctrl+Alt+ArrowDown` while that handle is focused. Reordering
is deliberately sibling-only: it changes the zero-based `position` within one
parent and never changes hierarchy.
Use the existing **Move** action to change a folder's parent; moved and newly
created folders append to the destination level.

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

__APP_NAME__ follows Babel's Ready/Edit keyboard model. `Ctrl+F6` and
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
while __APP_NAME__ is stopped. Use the root `npm.cmd run data:backup` workflow for
normal backups; never commit notebook data to the public Babel repository.
