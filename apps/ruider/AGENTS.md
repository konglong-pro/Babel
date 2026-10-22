# Ruider instructions

Ruider is a visual brainstorming and language notebook Module. Preserve its
named-canvas, editable scene, folder, note, search, Markdown, and managed-image behavior. Its private data is rooted at
`data/ruider/` from the Babel root and configured with
`RUIDER_DATABASE_PATH` and `RUIDER_UPLOAD_DIRECTORY`.

Keep database logical image paths stable when changing the physical upload
Adapter. Run `npm.cmd run check -w @babel-apps/ruider` for a full gate. Apply
schema migrations only with an explicit data task and while the app is stopped.

The root `AGENTS.md` owns shared commands and public/private data discipline.
