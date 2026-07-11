# __APP_NAME__ instructions

__APP_NAME__ is a language notebook Module. Preserve its folder, note, search,
Markdown, and managed-image behavior. Its private data is rooted at
`data/__APP_ID__/` from the Babel root and configured with
`__APP_ENV_PREFIX___DATABASE_PATH` and `__APP_ENV_PREFIX___UPLOAD_DIRECTORY`.

Keep database logical image paths stable when changing the physical upload
Adapter. Run `npm.cmd run check -w @babel-apps/__APP_ID__` for a full gate. Apply
schema migrations only with an explicit data task and while the app is stopped.

The root `AGENTS.md` owns shared commands and public/private data discipline.
