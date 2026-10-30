# Bio instructions

Bio is the biology notebook Module. Preserve its folder, note, search,
Markdown, and managed-image behavior. Its private data is rooted at
`data/bio/` from the Babel root and configured with
`BIO_DATABASE_PATH` and `BIO_UPLOAD_DIRECTORY`.

Keep database logical image paths stable when changing the physical upload
Adapter. Run `npm.cmd run check -w @babel-apps/bio` for a full gate. Apply
schema migrations only with an explicit data task and while the app is stopped.

The root `AGENTS.md` owns shared commands and public/private data discipline.
