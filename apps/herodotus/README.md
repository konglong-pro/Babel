# Herodotus

Herodotus is Babel's local, single-user notebook for reading and recording
history and literature. It organizes long-form Markdown notes in nested folders,
supports tags and full-note search, and stores managed note images beside its
SQLite database.

From the Babel root:

```powershell
npm.cmd run dev:herodotus
npm.cmd run check -w @babel-apps/herodotus
```

Open `http://127.0.0.1:3004`. Private data lives in
`data/herodotus/sqlite.db` and `data/herodotus/uploads/notes/` in the independent
private `data/` repository. The launcher supplies absolute
`HERODOTUS_DATABASE_PATH` and `HERODOTUS_UPLOAD_DIRECTORY` values.

The three-column workspace keeps the folder tree, note list, and reader/editor
visible together. The editor uses its full content area for GitHub Flavored
Markdown, while saved notes render in the reader. PNG, JPEG, WebP, and GIF
images up to 10 MB can be selected or pasted; images are committed to storage
only when the note is saved. A save accepts up to 10 MiB of Markdown, 50 new
images, and 100 MiB of Markdown plus new images in total; multipart transport is
limited to 160 MiB. Image mutations are serialized, and interrupted transactions
are reconciled during health checks and before later writes.

Select a concrete folder to import a UTF-8 `.md` file as a new draft. Relative
GFM image references can be matched to local image files before saving; remote
HTTP(S) image links remain remote. Import never overwrites an existing note.

Run schema generation or migration only for an explicit database task and only
while Herodotus is stopped. Use the root `npm.cmd run data:backup` workflow for
normal backups; never commit notebook data to the public Babel repository.
