# ReTex

ReTex is Babel's local, single-user mathematics archive for knowledge, selected
exercises, archived solutions, and per-exercise scratch work. It uses Markdown,
LaTeX, and KaTeX on Next.js with SQLite and Drizzle.

From the Babel root:

```powershell
npm.cmd run dev:retex
npm.cmd run check -w @babel-apps/retex
```

Open `http://127.0.0.1:3000`. Private data lives in `data/retex/sqlite.db` and
`data/retex/uploads/exercises/` in the independent private `data/` repository.
The launcher supplies absolute `RETEX_DATABASE_PATH` and
`RETEX_UPLOAD_DIRECTORY` values.

Use `$f(x)=x^2$` for inline math and `$$...$$` for display math. Run schema
generation or migration only for an explicit database task and only while ReTex
is stopped. Use the root `npm.cmd run data:backup` workflow for normal backups;
never commit notebook data to the public Babel repository.
