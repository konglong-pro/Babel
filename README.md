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

Double-click `launcher\Babel.vbs` or `launcher\Babel.lnk` to open the WPF control
panel. It reads `babel.apps.json` dynamically, shows each registered app and
port, and can start the selected app, start all apps, stop the session cleanly,
open the selected page, or run a readiness verification.

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
sends a stop signal to its managed CLI worker before the window exits.

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
