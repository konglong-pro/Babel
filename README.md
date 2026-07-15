# Babel

Babel is a local-first monorepo for independently registered notebook
applications. The application code is intended for a public GitHub repository.
User data lives in the nested, independent, private `data/` Git repository and
is never tracked by the public repository.

## Layout

```text
apps/             registered application workspaces
packages/config/  shared TypeScript and ESLint baselines
packages/platform/ shared HTTP and SQLite infrastructure for mirror apps
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
worker, the launcher waits for both its health endpoint and registered page
identity, then opens the `identityPath` in the system default browser. A healthy
notebook that is already running opens immediately; an unrelated or unhealthy
listener on the registered port is never opened or stopped.

`START ALL`, per-notebook and all-worker stop controls, `VERIFY ALL`, shortcut
settings, and the complete session log remain in the command-panel interface.
`MINIMIZE TO TRAY` hides the launcher without stopping its workers. The tray
menu lists every notebook; choosing one follows the same start, identity-check,
and open flow. Tray `Exit` gracefully stops all workers owned by that launcher.

`Babel.exe` is a small Windows-native wrapper around `Babel.Gui.ps1`; it does not
duplicate launcher behavior. Rebuild it with the Windows .NET Framework compiler
already included with Windows:

```powershell
npm.cmd run launcher:build
```

`SHORTCUTS` opens the global shortcut editor. Babel stores the user override in
`%LOCALAPPDATA%\Babel\shortcuts.json`, outside both the public repository and the
private notebook-data repository. The defaults are `Ctrl+S` (save),
`Ctrl+Alt+N` (new), `Ctrl+Alt+E` (edit), `Ctrl+Enter` (confirm), `Escape`
(cancel), `Ctrl+F` (search), `Ctrl+Delete` (delete), and `Ctrl+K` (command
palette). Reload an open notebook page after saving changes in the launcher.

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
