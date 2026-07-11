# Esperanto instructions

Esperanto is the English notebook Module. Preserve its folder, note, search,
Markdown, and managed-image behavior. Its private data is rooted at
`data/esperanto/` from the Babel root and configured with
`ESPERANTO_DATABASE_PATH` and `ESPERANTO_UPLOAD_DIRECTORY`.

Keep database logical image paths stable when changing the physical upload
Adapter. Run `npm.cmd run check -w @babel-apps/esperanto` for a full gate. Apply
schema migrations only with an explicit data task and while the app is stopped.

The root `AGENTS.md` owns shared commands and public/private data discipline.
