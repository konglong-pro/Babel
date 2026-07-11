# ReTex instructions

ReTex is the mathematics notebook Module. Preserve its knowledge, exercise,
scratch-work, search, KaTeX, Markdown, and managed-image behavior. Its private
data is rooted at `data/retex/` from the Babel root and configured with
`RETEX_DATABASE_PATH` and `RETEX_UPLOAD_DIRECTORY`.

Keep database logical image paths stable when changing the physical upload
Adapter. Run `npm.cmd run check -w @babel-apps/retex` for a full gate. Apply
schema migrations only with an explicit data task and while the app is stopped.

The root `AGENTS.md` owns shared commands and public/private data discipline.
