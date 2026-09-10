# Vali instructions

Vali is a notebook Module. Preserve its folder, note, reflection, search,
Markdown, wikilink, and managed-image behavior. Its private data is rooted at
`data/vali/` from the Babel root and configured with
`VALI_DATABASE_PATH` and `VALI_UPLOAD_DIRECTORY`.

Keep database logical image paths stable when changing the physical upload
Adapter. Run `npm.cmd run check -w @babel-apps/vali` for a full gate. Apply
schema migrations only with an explicit data task and while the app is stopped.

The root `AGENTS.md` owns shared commands and public/private data discipline.
