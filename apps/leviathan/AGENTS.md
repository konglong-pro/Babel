# Leviathan instructions

Leviathan is a local, single-user notebook Module for long-form political and
economic notes. Preserve its folder, note, search, Markdown import, and
managed-image behavior. Its private data is rooted at `data/leviathan/` from
the Babel root and configured with `LEVIATHAN_DATABASE_PATH` and
`LEVIATHAN_UPLOAD_DIRECTORY`.

SQLite is the sole editing source of truth. Imported Markdown and local images
become managed note content only when the draft is saved. The initial migration
seeds editable `Politics` and `Economics` root folders.

Keep database logical image paths stable when changing the physical upload
Adapter. Run `npm.cmd run check -w @babel-apps/leviathan` for a full gate. Apply
schema migrations only with an explicit data task and while the app is stopped.

The root `AGENTS.md` owns shared commands and public/private data discipline.
