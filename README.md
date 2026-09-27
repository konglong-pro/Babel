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

Use Node.js 24.0 or newer, but lower than Node.js 25.
On Windows, install PowerShell 7 and ensure `pwsh.exe` is on PATH.

```powershell
npm.cmd install
npm.cmd run git:setup
npm.cmd run check
```

The full check validates the registry, tests the root scripts, then runs every
workspace's declared check.

`npm.cmd run benchmark:search:smoke` checks every application's and the template's
search results, including dense ASCII and CJK short queries. It also guards the
8 KiB occurrence-counting/highlighting case against quadratic regressions.
`npm.cmd run benchmark:search:all` uses 10,000 records per application. The timing
limits are generous CI regression guards, not interactive latency targets.

For development, run one application at a time:

```powershell
npm.cmd run dev -w @babel-apps/<id>
```

Existing applications also expose root shortcuts such as
`npm.cmd run dev:retex`.

## Open pages

Folder fields support searching by name or full path and browsing an expandable
tree. Children appear directly below their parent, in the same sibling order as
the sidebar. Use the arrow keys to navigate/expand, Enter to select, and Escape
to close. Search results show parent paths to distinguish same-name folders.

Drag a saved note from the content list onto a sidebar folder to move it. The
destination highlights while dragging; dropping between sibling notes reorders
them. A move follows each notebook's existing subtree rules, appends to the
destination, and preserves content and images. Save or close dirty pages and
child drafts before moving their subtree. Editors with Folder fields also
support location changes using the keyboard.

Each notebook keeps document pages in an app-level tab strip. Opening another
note, entry, exercise, reflection, or canvas preserves the mounted read/edit
state of the pages already open in that workspace. Selecting the same saved
document focuses its existing tab; new unsaved drafts receive temporary,
non-restorable identities until their first save.

Tabs can be reordered by dragging. Closing a dirty or saving page offers Save,
Discard, and Cancel, and clean saved tabs are restored for the browser session.
The page-session substrate lives in `packages/platform/`; each application owns
its document loading, editor state, save behavior, routes, and conflict rules.

Canvases autosave after a 500 ms editing pause. Discard cancels unsent saves and
waits for an already-running save before closing; closing never submits another
copy of the discarded edit. It does not undo earlier completed autosaves.
Embedded canvases share refresh requests, and inactive pages stop refreshing
unless their content remains visible in a detached reader.

In a **Read** window, click a Markdown image (or focus it and press Enter/Space)
to open the image viewer. Use the zoom buttons or mouse wheel, drag to pan,
choose **100%** for original size or **Fit** to fit the window, and press Escape
to close. Zoom affects only the reading view, including live draft images; it
does not change the note or attachment. All apps and the scaffold inherit this
behavior from the shared reader.

## Canvas controls

All notebook canvases and the application scaffold use the same tools. In the
active canvas, `Ctrl+Shift+1` through `Ctrl+Shift+8` select **Select**, **Hand**,
**Pen**, **Eraser**, **Text**, **Rectangle**, **Ellipse**, and **Arrow**, in that
order. The toolbar and the `Ctrl+K` command palette show the canvas shortcuts.
`Ctrl+Z` undoes an edit; `Ctrl+Y` redoes it. Inputs keep their normal text-editing
shortcuts, including `Ctrl+X` to cut.

Drag empty space with Select to box-select, and hold Shift to add or remove
objects from the selection. Selected objects can move or resize together. Hold
Space to pan temporarily without changing tools; **Fit all** and **Fit selection**
bring content back into view. View changes do not occupy undo history, and each
drawing, move, resize, erasing gesture, or text-editing session is one undo step.

Text has no card background: click to start typing and double-click existing text
to edit it. Tool properties remember color, stroke width, fill, and text settings
as appropriate. Eraser cuts freehand strokes locally and removes other touched
objects. Arrow endpoints attach to objects and follow them when they move or
resize.

Paste a PNG, JPEG, or WebP image with `Ctrl+V` while the canvas is active. Large
clipboard images are scaled down before insertion. Images are stored inline in
the scene, up to 2 MiB per image. The complete saved scene
remains limited to 5 MiB and 2,000 elements.

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

Double-click `launcher\Babel.exe` to open Babel's independent desktop window.
The existing `Babel.vbs` and `Babel.lnk` entries remain available as fallbacks.
The `APPS` home reads `babel.apps.json` and lists each notebook as `Stopped`,
`Starting`, `Ready`, `Unhealthy`, or `External`. Choose `OPEN`: a stopped notebook
gets its own worker, then Babel waits for its health endpoint to report the
registered app identity before opening `identityPath` in an embedded WebView2
view. A healthy notebook that is already running opens immediately; an unrelated
or unhealthy listener on the registered port is never opened or stopped.

Each open app has a tab in the desktop shell. Switching app tabs or returning to
`APPS` preserves the views and their in-memory state. Reader and search popups
open as separate WebView2 windows owned by Babel, preserving their source view.
Closing an app tab checks for unsaved changes and closes its related popups; it
does not stop that app's worker. External web links open in the system browser.

On a new checkout, prepare the desktop components once:

```powershell
npm.cmd run launcher:setup
```

Setup downloads the pinned Microsoft.Web.WebView2 SDK `1.0.3537.50` from NuGet,
verifies its hashes, and installs it under the ignored `launcher/.webview2/`
directory. Microsoft Edge WebView2 Evergreen Runtime must already be installed
on Windows; setup does not install or change that system runtime. No .NET SDK is
required. WebView2 profiles are stored in
`%LOCALAPPDATA%\Babel\Desktop\WebView2`, outside the public repository and private
`data/` repository. Notebook data continues to use its registered database paths.

`START ALL` uses one aggregate CLI worker for every notebook that still needs to
start and is available after independent workers are stopped; that aggregate
session is stopped only by `STOP ALL`. `STOP SELECTED`
applies only to an independent worker created by `OPEN`. `VERIFY ALL`, shortcut
settings, and the bounded session log remain in the command-panel interface.
The native launcher starts PowerShell 7 with console creation disabled, while notebook
processes use detached Windows process creation, so hidden console-host processes
do not remain resident.
`MINIMIZE TO TRAY` hides the launcher without stopping its workers. The tray
menu lists every notebook; choosing one follows the same start, identity-check,
and open flow. Tray `Exit` checks open views for unsaved edits, then gracefully
stops all workers owned by that launcher.
While the launcher process is running, the global `Ctrl+Alt+B` hotkey toggles
the window: it restores and focuses the notebook table when hidden or behind
another app, and returns the launcher to the tray when it is already in front.
After restoring, use `1`-`9` or `0` (the tenth row) to select a notebook,
Up/Down to move, Enter to `OPEN`, Delete to stop the selected independent
worker, and Escape to return to the tray. A keyboard `OPEN` activates the app's
desktop view after its health identity passes. Errors keep the window visible.
These home navigation keys apply only on `APPS`; inside a notebook, Escape and
other keys remain available to that app.
The `OPEN`, `STOP SELECTED`, and `MINIMIZE TO TRAY` buttons remain clickable,
but they no longer expose O/T/M access keys; their only window-level keyboard
commands are Enter, Delete, and Escape respectively.

Closing the desktop window with its X checks every open view for unsaved or
pending edits before stopping its managed workers and exiting. Exit also
unregisters the global hotkey. Use Escape on `APPS` or `MINIMIZE TO TRAY` when
you want to leave the views, workers, and hotkey available.

`Babel.exe` is a small Windows-native wrapper around `Babel.Gui.ps1`; it does not
duplicate launcher behavior. It runs PowerShell 7 in a hidden STA process. Rebuild it with the Windows .NET Framework compiler
already included with Windows:

```powershell
npm.cmd run launcher:build
```

`SHORTCUTS` configures both the launcher toggle and web application commands.
The launcher binding is stored independently in
`%LOCALAPPDATA%\Babel\launcher.json`; the 18 schema-v4 notebook command overrides
remain in `%LOCALAPPDATA%\Babel\shortcuts.json`. Both files are outside the
public repository and the private notebook-data repository. A changed launcher
binding is registered immediately; if Windows reports that the combination is
already in use, Babel keeps the previous binding and settings. Saving notebook
commands updates open desktop views immediately, including detached reader
underline shortcuts. Reload any notebook pages open separately in a browser.

The schema-v4 defaults remain:

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
| `underlineSelection` | `Ctrl+Shift+U` | Underline selected reader text in the last chosen color |
| `removeUnderline` | `Ctrl+Alt+U` | Remove the underline matching the selection, or the active line |
| `commandPalette` | `Ctrl+K` | Search commands, actions, and document titles |
| `focusNextPane` | `Ctrl+F6` | Focus the next available pane |
| `focusPreviousPane` | `Ctrl+Shift+F6` | Focus the previous available pane |
| `nextTab` | `Ctrl+Alt+ArrowRight` | Activate the next tab cyclically |
| `previousTab` | `Ctrl+Alt+ArrowLeft` | Activate the previous tab cyclically |
| `closeTab` | `Ctrl+Alt+W` | Close the active tab through its dirty-state flow |
| `quickOpen` | `Ctrl+Alt+P` | Open the palette directly in title-only mode |
| `help` | `Ctrl+Alt+H` | Show the complete keyboard-help overlay |

Each schema-v4 binding is either a shortcut string or `null`. Schema v1, v2, and v3
files remain readable. Migration preserves every existing user binding first,
then adds each new default only when that combination is free. A conflicting
new command becomes `null` rather than displacing the old binding; the launcher
displays it as `Unbound`, where it can be reassigned or left unbound. No existing
default or user assignment changes merely by opening the desktop shell.

The desktop shell disables WebView2's browser accelerator commands. Notebook
commands can additionally use `Ctrl+W`, `Ctrl+Shift+W`, `Ctrl+T`, `Ctrl+Shift+T`,
`Ctrl+L`, `Ctrl+N`, `Ctrl+Shift+N`, `Ctrl+Tab`, `Ctrl+Shift+Tab`, `F5`, `Ctrl+F5`,
`F6`, `F11`, and `F12`. These bindings are marked desktop-only in keyboard help;
ordinary browser pages load the same settings but do not execute those bindings.
They cannot be assigned to the global launcher hotkey. In the desktop shell, a
matching command also consumes its key when temporarily unavailable in the
current context. Text inputs keep clipboard, undo, text navigation, and IME behavior.

Other safe bare function keys remain accepted. The fixed `F2` key, Windows
combinations such as `Alt+Tab`, `Alt+F4`, and `Ctrl+Alt+Delete`, and structural
reordering keys `Ctrl+Alt+ArrowUp` and `Ctrl+Alt+ArrowDown` remain reserved.
Bare `Escape` belongs to Cancel and fixed navigation and cannot be assigned to
an unrelated command.

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
last focused control in each. Bare `F6` can be assigned inside the desktop shell;
ordinary browser pages leave it to the browser.
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
pwsh.exe -NoProfile -ExecutionPolicy Bypass -File .\launcher\Babel.ps1 -Selection All
```

For a non-interactive readiness and clean-shutdown check:

```powershell
pwsh.exe -NoProfile -ExecutionPolicy Bypass -File .\launcher\Babel.ps1 -Selection All -NoBrowser -VerifyAndExit
```

`npm.cmd run test:scripts` also includes an isolated test using actual WebView2
controls. That smoke test runs on Windows when the pinned SDK is installed;
otherwise it reports a skip. It uses fixture pages and a temporary profile.

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
