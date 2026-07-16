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

The editor uses the full writing area; rendered GitHub Flavored Markdown remains
available in reading mode. While editing, **Read** sits above the second-column
heading and opens a separate live reader window that follows the current draft
and staged images. Bottom-left English **Markdown Guide** and **Typst Reference**
panels span the folder and note columns. PNG, JPEG, WebP, and GIF images up to 10 MiB can be
selected or pasted and are committed only when the note is saved. A save accepts
up to 10 MiB of Markdown, 50 new images, and 100 MiB in total; multipart transport
is limited to 160 MiB. Image mutations are serialized, and interrupted
transactions are reconciled during health checks and before later writes.

Select a concrete folder to import a UTF-8 `.md` file as a new draft. Relative
GFM image references can be matched to local image files before saving; remote
HTTP(S) image links remain remote. Import never overwrites an existing note.

Run schema generation or migration only for an explicit database task and only
while Esperanto is stopped. Use the root `npm.cmd run data:backup` workflow for
normal backups; never commit notebook data to the public Babel repository.
