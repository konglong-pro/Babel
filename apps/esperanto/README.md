# Esperanto

Esperanto is Babel's local, single-user English notebook. It organizes Markdown
notes in nested folders, supports tags and search, and stores managed note images
beside its SQLite database.

From the Babel root:

```powershell
npm.cmd run dev:esperanto
npm.cmd run check -w @babel-apps/esperanto
```

Open `http://127.0.0.1:3001`. Private data lives in
`data/esperanto/sqlite.db` and `data/esperanto/uploads/notes/` in the independent
private `data/` repository. The launcher supplies absolute
`ESPERANTO_DATABASE_PATH` and `ESPERANTO_UPLOAD_DIRECTORY` values.

The editor previews GitHub Flavored Markdown. PNG, JPEG, WebP, and GIF images up
to 10 MB can be selected or pasted; images are committed to storage only when
the note is saved.

Run schema generation or migration only for an explicit database task and only
while Esperanto is stopped. Use the root `npm.cmd run data:backup` workflow for
normal backups; never commit notebook data to the public Babel repository.
