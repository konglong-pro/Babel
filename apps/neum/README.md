# Neum

Neum is Babel's local, single-user computer-science notebook. It stores Markdown
knowledge entries and exact code/configuration snippets in nested folders, with
relational tags, literal search, recoverable trash, and managed images.

From the Babel root:

```powershell
npm.cmd run dev:neum
npm.cmd run check -w @babel-apps/neum
```

Open `http://127.0.0.1:3003/entries`. Private data lives in
`data/neum/sqlite.db` and `data/neum/uploads/entries/` inside the independent
private `data/` repository. The launcher supplies absolute `NEUM_DATABASE_PATH`
and `NEUM_UPLOAD_DIRECTORY` values.

The editor preserves incomplete JSON, YAML, and other snippets exactly as typed.
PNG, JPEG, WebP, and GIF images up to 10 MB can be embedded in an entry's Markdown
notes and are committed only when the entry save succeeds.

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
