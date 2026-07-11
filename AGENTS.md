# Babel repository instructions

## Purpose and structure

Babel is a public npm-workspaces monorepo. Each notebook under `apps/` remains an
independent Module with its own domain behavior, routes, tests, and SQLite
schema. `packages/config/` supplies only the shared toolchain baseline. Do not
extract notebook repositories, Markdown renderers, or UI merely because their
names look similar; introduce a shared Seam only after two real Adapters exist.

`babel.apps.json` is the launcher and registration Interface. Keep its workspace,
port, health, identity, environment, and required-data declarations synchronized
with the application package. Run `npm.cmd run registry:check` after editing it.

## Commands

- Install: `npm.cmd install`
- Enable hooks: `npm.cmd run git:setup`
- Full gate: `npm.cmd run check`
- App gate: `npm.cmd run check -w @babel-apps/<id>`
- Data backup: stop all apps, then `npm.cmd run data:backup`
- Launcher verification: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\launcher\Babel.ps1 -Selection All -NoBrowser -VerifyAndExit`

## Public/private data discipline

- The outer Babel repository is public. It must never track `data/`, uploads,
  SQLite files, sidecars, exports containing notes, or secrets.
- `data/` is a physically nested but logically independent private Git
  repository. Run Git commands for it with `git -C data ...`.
- Never use `git clean -fdx` or equivalent destructive cleanup at the Babel root.
- Stop applications before database copy, restore, checkpoint, or migration.
- Do not bypass the public repository's pre-commit data guard.
- Vali's SQLite database is the sole source of truth. Markdown/JSON are lossless
  semantic exchange formats, not the live editing store.

## Working rules

- Make surgical changes and preserve each application's user-visible behavior.
- Do not add dependencies without approval.
- Treat schema migrations, data deletion, and import/restore as high-risk work.
- Prefer executable checks. Report changed files, checks run, checks not run,
  and remaining risks; never claim an unexecuted check passed.
