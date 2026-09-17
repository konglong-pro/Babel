# Herodotus instructions

Herodotus is a local, single-user notebook Module for long-form history and
literature notes. Preserve its folder, note, search, Markdown import, and
managed-image behavior. Its private data is rooted at `data/herodotus/` from
the Babel root and configured with `HERODOTUS_DATABASE_PATH` and
`HERODOTUS_UPLOAD_DIRECTORY`.

SQLite is the sole editing source of truth. Imported Markdown and local images
become managed note content only when the draft is saved. The initial migration
seeds editable `History` and `Literature` root folders.

Keep database logical image paths stable when changing the physical upload
Adapter. Run `npm.cmd run check -w @babel-apps/herodotus` for a full gate. Apply
schema migrations only with an explicit data task and while the app is stopped.

The root `AGENTS.md` owns shared commands and public/private data discipline.
