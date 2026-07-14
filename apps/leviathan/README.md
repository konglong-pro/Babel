# Leviathan

Leviathan is Babel's local, single-user notebook for reading and recording
politics and economics. It organizes long-form Markdown notes in nested folders,
supports tags and full-note search, and stores managed note images beside its
SQLite database.

From the Babel root:

```powershell
npm.cmd run dev:leviathan
npm.cmd run check -w @babel-apps/leviathan
```

Open `http://127.0.0.1:3005`. Private data lives in
`data/leviathan/sqlite.db` and `data/leviathan/uploads/notes/` in the independent
private `data/` repository. The launcher supplies absolute
`LEVIATHAN_DATABASE_PATH` and `LEVIATHAN_UPLOAD_DIRECTORY` values.

The three-column workspace keeps the folder tree, note list, and reader/editor
visible together. The editor previews GitHub Flavored Markdown. PNG, JPEG, WebP,
and GIF images up to 10 MB can be selected or pasted; images are committed to
storage only when the note is saved. A save accepts up to 10 MiB of Markdown,
50 new images, and 100 MiB of Markdown plus new images in total.

Select a concrete folder to import a UTF-8 `.md` file as a new draft. Relative
GFM image references can be matched to local image files before saving; remote
HTTP(S) image links remain remote. Import never overwrites an existing note.

Run schema generation or migration only for an explicit database task and only
while Leviathan is stopped. Use the root `npm.cmd run data:backup` workflow for
normal backups; never commit notebook data to the public Babel repository.
