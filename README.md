# Babel

Babel is a local-first monorepo for independently registered notebook
applications. The application code is intended for a public GitHub repository.
User data lives in the nested, independent, private `data/` Git repository and
is never tracked by the public repository.

## Layout

```text
apps/             registered application workspaces
packages/config/  shared TypeScript and ESLint baselines
packages/platform/ shared page-session, shortcut, HTTP, and SQLite infrastructure
templates/        source templates for new application workspaces
launcher/         registry-driven Windows launcher
scripts/          scaffolding, registry validation, and private-data backup
babel.apps.json   launcher and app-registration source of truth
data/             private nested repository (not part of public Babel Git)
```

Ports are assigned in `babel.apps.json`. New applications take the smallest free
port in the registry's 3000-3999 range.

## Install and verify

Use Node.js 22.13 or newer, but lower than Node.js 23.

```powershell
npm.cmd install
npm.cmd run git:setup
npm.cmd run check
```

The full check validates the registry, tests the root scripts, then runs every
workspace's declared check.

For development, run one application at a time:

```powershell
npm.cmd run dev -w @babel-apps/<id>
```

Existing applications also expose root shortcuts such as
`npm.cmd run dev:retex`.

## Open pages

Each notebook keeps document pages in an app-level tab strip. Opening another
note, entry, exercise, reflection, or canvas preserves the mounted read/edit
state of the pages already open in that workspace. Selecting the same saved
document focuses its existing tab; new unsaved drafts receive temporary,
non-restorable identities until their first save.

Tabs can be reordered by dragging. Closing a dirty or saving page offers Save,
Discard, and Cancel, and clean saved tabs are restored for the browser session.
The page-session substrate lives in `packages/platform/`; each application owns
its document loading, editor state, save behavior, routes, and conflict rules.

## Import Markdown folders

The **Import** menu keeps the single-file draft flow and adds **Import Markdown
folder**. Folder import recursively discovers strict UTF-8 `.md` files, then
opens a metadata-only review window before anything is written. The selected
root directory is not created in the notebook; its subdirectories map to nested
destination folders. Each row can change its Title, Folder, Parent page, and
Tags. Source files are never renamed or modified.

Titles must be unique across the application's complete document namespace
after NFC normalization, whitespace trimming/collapsing, and case folding. A
conflicting title must be changed in the review window; Babel does not silently append a suffix. Existing sibling
folders are reused only when the match is unambiguous. Parent pages may target
an existing document or another reviewed document in the same destination
folder, and cyclic parent relationships are rejected.

Only referenced local PNG, JPEG, WebP, and GIF files inside the selected root
are imported. Remote images remain remote. Relative Markdown document links and
unambiguous wikilinks are rewritten to reviewed final titles; ambiguous
wikilinks can be assigned explicitly or preserved unchanged. The client
preflights the whole batch, uploads files sequentially to a temporary session,
and the server revalidates and commits the database and managed images as one
operation. Cancelled, failed, and expired sessions are cleaned up.

A folder batch accepts at most 1,000 Markdown files, 250 MiB of Markdown, and
1 GiB of referenced images. Each document keeps the normal 10 MiB Markdown,
50-image, 10 MiB-per-image, and 100 MiB document-plus-images limits. The six
mirror Notes workspaces and Vali Notes import notes; Neum imports Knowledge
entries only; ReTex and Matter import Knowledge items only. On success the
workspace refreshes, reports a summary, and opens the first imported document.

## Add a mirror application

From the Babel root, pass a safe ASCII display name:

```powershell
npm.cmd run new-app -- "My Notes"
```

The command copies `templates/mirror-app`, renders its app tokens, assigns the
smallest free registered port, adds `dev:<id>`, updates `babel.apps.json` and the
npm lockfile, then validates the registry. It does not create private data or run
schema migrations. Provision the registered database and upload paths explicitly
before launching or backing up the new application.

## Launcher

Double-click `launcher\Babel.exe` to open the WPF application launcher. The
existing `Babel.vbs` and `Babel.lnk` entries remain available as fallbacks. The
launcher reads `babel.apps.json` dynamically and presents the notebooks in the
original table-and-command-panel layout with a `Stopped`, `Starting`, `Ready`,
`Unhealthy`, or `External` state. Choose `OPEN`: a stopped notebook gets its own
worker, the launcher waits for its health endpoint to report the registered app
identity, then opens the `identityPath` in the system default browser. A healthy
notebook that is already running opens immediately; an unrelated or unhealthy
listener on the registered port is never opened or stopped.

`START ALL` uses one aggregate CLI worker for every notebook that still needs to
start and is available after independent workers are stopped; that aggregate
session is stopped only by `STOP ALL`. `STOP SELECTED`
applies only to an independent worker created by `OPEN`. `VERIFY ALL`, shortcut
settings, and the bounded session log remain in the command-panel interface.
The native launcher hosts Windows PowerShell runspaces directly, while notebook
processes use detached Windows process creation, so hidden console-host processes
do not remain resident.
`MINIMIZE TO TRAY` hides the launcher without stopping its workers. The tray
menu lists every notebook; choosing one follows the same start, identity-check,
and open flow. Tray `Exit` gracefully stops all workers owned by that launcher.
While the launcher process is running, the global `Ctrl+Alt+B` hotkey toggles
the window: it restores and focuses the notebook table when hidden or behind
another app, and returns the launcher to the tray when it is already in front.
After restoring, use `1`-`9` or `0` (the tenth row) to select a notebook,
Up/Down to move, Enter to `OPEN`, Delete to stop the selected independent
worker, and Escape to return to the tray. A keyboard `OPEN` returns to the tray
only after the registered health identity passes and the browser opens; errors
keep or restore the launcher so they remain visible.
The `OPEN`, `STOP SELECTED`, and `MINIMIZE TO TRAY` buttons remain clickable,
but they no longer expose O/T/M access keys; their only window-level keyboard
commands are Enter, Delete, and Escape respectively.

Closing the launcher with its X still stops its managed workers and exits, which
also unregisters the global hotkey. Use Escape or `MINIMIZE TO TRAY` when you
want to leave the hotkey available.

`Babel.exe` is a small Windows-native wrapper around `Babel.Gui.ps1`; it does not
duplicate launcher behavior. Rebuild it with the Windows .NET Framework compiler
already included with Windows:

```powershell
npm.cmd run launcher:build
```

`SHORTCUTS` configures both the launcher toggle and web application commands.
The launcher binding is stored independently in
`%LOCALAPPDATA%\Babel\launcher.json`; the 16 schema-v3 web command overrides
remain in `%LOCALAPPDATA%\Babel\shortcuts.json`. Both files are outside the
public repository and the private notebook-data repository. A changed launcher
binding is registered immediately; if Windows reports that the combination is
already in use, Babel keeps the previous binding and settings. Reload an open notebook
page after saving web-command changes in the launcher.

The schema-v3 web defaults are:

| Command | Default binding | Purpose |
| --- | --- | --- |
| `save` | `Ctrl+S` | Save the active editor |
| `new` | `Ctrl+Alt+N` | Create a document |
| `edit` | `Ctrl+Alt+E` | Enter edit mode |
| `read` | `Ctrl+R` | Return to read mode |
| `confirm` | `Ctrl+Enter` | Confirm the active edit or dialog |
| `cancel` | `Escape` | Coordinate the progressive Escape chain |
| `search` | `Ctrl+F` | Search the current notebook |
| `delete` | `Ctrl+Delete` | Request deletion through the existing confirmation flow |
| `commandPalette` | `Ctrl+K` | Search commands, actions, and document titles |
| `focusNextPane` | `Ctrl+F6` | Focus the next available pane |
| `focusPreviousPane` | `Ctrl+Shift+F6` | Focus the previous available pane |
| `nextTab` | `Ctrl+Alt+ArrowRight` | Activate the next tab cyclically |
| `previousTab` | `Ctrl+Alt+ArrowLeft` | Activate the previous tab cyclically |
| `closeTab` | `Ctrl+Alt+W` | Close the active tab through its dirty-state flow |
| `quickOpen` | `Ctrl+Alt+P` | Open the palette directly in title-only mode |
| `help` | `Ctrl+Alt+H` | Show the complete keyboard-help overlay |

Each schema-v3 binding is either a shortcut string or `null`. Schema v1 and v2
files remain readable. Migration preserves every existing user binding first,
then adds each new default only when that combination is free. A conflicting
new command becomes `null` rather than displacing the old binding; the launcher
displays it as `Unbound`, where it can be reassigned or left unbound. Safe bare
function keys are accepted, while the fixed `F2` key and browser or system keys
such as bare `F5`, `F6`, `F11`, and `F12` remain reserved. Bare `Escape` cannot
be assigned to an unrelated command. `Ctrl+Alt+ArrowUp` and
`Ctrl+Alt+ArrowDown` are likewise reserved for structural reordering.

Web notebooks use a Ready/Edit keyboard model. Focused folder and document
trees expose `tree`/`treeitem` semantics with a roving tab stop. Up/Down moves
through visible nodes, Left/Right collapses or expands, Enter selects or opens,
F2 renames a folder or opens a document directly in edit mode, and typed letters
jump by title. Document trees also support Home, End, PageUp, and PageDown.
Flat search and palette results use `listbox` semantics with Up/Down,
Home/End/PageUp/PageDown, Enter, and type-ahead. The tab strip exposes
`tablist`/`tab` semantics: Left/Right moves its roving focus and Enter activates
the focused tab.

`Ctrl+F6` and `Ctrl+Shift+F6` cycle the available folder tree, document tree,
tab strip, and detail pane, skipping hidden or absent panes and remembering the
last focused control in each. Bare `F6` remains available to the browser.
Keyboard reordering uses `Ctrl+Alt+ArrowUp` and `Ctrl+Alt+ArrowDown`, rather
than unmodified arrow keys; visible hints and `aria-keyshortcuts` expose the new
combination.

Escape unwinds one level at a time. The topmost dialog, command palette, or help
overlay gets first refusal; otherwise Escape leaves the editor for its read
view, then leaves the read view for the document tree. Existing dirty-edit and
discard confirmations still apply. `Ctrl+K` searches registered commands,
explicit semantic actions, and document or entry titles in one list, while
`Ctrl+Alt+P` restricts results to titles. Applications explicitly register
stable actions such as Import, Edit Templates, and New subnote. This semantic
coverage does not expose structural or transient controls such as disclosure
arrows, Back, Dismiss, or dialog Cancel, and dangerous actions continue through
their existing confirmation dialogs.

The command-line launcher remains available for scripts and recovery work:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\launcher\Babel.ps1 -Selection All
```

For a non-interactive readiness and clean-shutdown check:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\launcher\Babel.ps1 -Selection All -NoBrowser -VerifyAndExit
```

The launcher refuses to create or migrate missing user data. Every path in an
application's `requiredDataPaths` must already exist. Closing the WPF window
sends a stop signal to its managed CLI worker before the window exits. The
worker selects a Node.js runtime compatible with the root `engines.node` range
from PATH or fnm's default alias and reports the selected runtime in the log.

## Restore on a new machine

```powershell
git clone https://github.com/konglong-pro/babel.git E:\Babel
git clone https://github.com/konglong-pro/babel-data.git E:\Babel\data
Set-Location E:\Babel
npm.cmd install
npm.cmd run git:setup
npm.cmd run check
```

Do not initialize `data/` from fixtures when restoring an existing vault.

## Back up private data

Stop all Babel applications, then run:

```powershell
npm.cmd run data:backup
```

The command refuses to run while a registered port is listening. It checkpoints
and integrity-checks every SQLite database, commits changes in the private
`data/` repository, and pushes its configured `origin`.

Never restore a database while an application is running. Move the current
database and all `-wal`, `-shm`, and `-journal` sidecars aside together. Copy a
verified checkpoint to `sqlite.db`, run an integrity check, and only then start
the application. Avoid destructive `git clean -fdx` commands at the Babel root:
ignored `data/` is a real private repository, not disposable build output.

Vali treats SQLite as its sole source of truth. Its Markdown and JSON workflows
are canonical, semantic import/export formats; they are not files to edit in
place as the live store.
