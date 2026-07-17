# Vali

Vali is Babel's local, single-user notebook. Its Notes unit organizes Markdown
documents in nested folders, while Reflection stores one Markdown document per
calendar day. Search, wikilinks, backlinks, outlines, and managed images work
across both units.

From the Babel root:

```powershell
npm.cmd run dev:vali
npm.cmd run check -w @babel-apps/vali
```

Open `http://127.0.0.1:3002`. Private data lives in
`data/vali/sqlite.db` and `data/vali/uploads/notes/` in the independent
private `data/` repository. The launcher supplies absolute
`VALI_DATABASE_PATH` and `VALI_UPLOAD_DIRECTORY` values.

The editor uses the full writing area for GitHub Flavored Markdown. In both Notes
and Reflection, **Read** sits above the content-index heading and opens a separate
reader window for saved content or the current unsaved draft and staged images. Notes also
provides bottom-left English **Markdown Guide** and **Typst Reference** panels
across the two navigation columns. PNG, JPEG,
WebP, and GIF images up to 10 MB can be selected or pasted; images are committed
to storage only when the document is saved. Notes can also import a strict UTF-8
`.md` file and match its safe relative image references by filename. Reflection
does not expose Markdown-file import.

Notes and Reflection share the same save limits: Markdown is capped at 10 MiB,
one save can add at most 50 images, Markdown plus referenced new images is capped
at 100 MiB, and multipart requests are capped at 160 MiB on the wire. Image and
database mutations are serialized. Startup recovery restores quarantined files
that are still owned by either unit and deletes only generated, unowned files.

To verify the app without opening the formal notebook database, point the build
at temporary paths before running the workspace gate:

```powershell
$env:VALI_DATABASE_PATH = Join-Path $env:TEMP "vali-check.sqlite.db"
$env:VALI_UPLOAD_DIRECTORY = Join-Path $env:TEMP "vali-check-uploads"
npm.cmd run check -w @babel-apps/vali
```

Run schema generation or migration only for an explicit database task and only
while Vali is stopped. Use the root `npm.cmd run data:backup` workflow for
normal backups; never commit notebook data to the public Babel repository.
