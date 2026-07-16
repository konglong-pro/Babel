# ReTex

ReTex is Babel's local, single-user mathematics archive for knowledge, selected
exercises, archived solutions, and per-exercise scratch work. It uses Markdown,
native Typst mathematics, and a shared browser compiler on Next.js with SQLite
and Drizzle.

From the Babel root:

```powershell
npm.cmd run dev:retex
npm.cmd run check -w @babel-apps/retex
```

Open `http://127.0.0.1:3000`. Private data lives in `data/retex/sqlite.db` and
the `data/retex/uploads/notes/` directory in the independent private `data/`
repository. The launcher supplies absolute `RETEX_DATABASE_PATH` and
`RETEX_NOTE_UPLOAD_DIRECTORY` values.

Use native Typst syntax: `$f(x)=x^2$` for inline math and `$ f(x)=x^2 $` on its
own line for display math. LaTeX commands and `$$...$$` are not supported. Run
schema generation or migration only for an explicit database task and only
while ReTex is stopped. Use the root `npm.cmd run data:backup` workflow for
normal backups; never commit notebook data to the public Babel repository.

Knowledge can import UTF-8 `.md` files and match referenced local PNG, JPEG,
WebP, or GIF files before saving. Exercise problems, answers, and solutions use
the same Markdown editor and managed-image workflow. **Read** opens a separate
live reader window for Knowledge, whole Exercises, and Scratch work. The bottom-left Typst
reference opens across the two navigation columns without covering the writing
column. A Markdown save is limited to 10 MiB of content, 50 new images, 100 MiB
logically, and 160 MiB on the multipart wire. ReTex serializes managed-note
image mutations and reconciles interrupted image transactions during health
checks and before later writes.
