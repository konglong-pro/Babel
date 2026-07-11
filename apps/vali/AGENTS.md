# Vali instructions

Vali is the structured vault Module. SQLite at `data/vali/sqlite.db` is its sole
source of truth and is configured with `VALI_DATABASE_PATH`. Markdown and JSON
are canonical semantic import/export formats; do not implement direct editing
of exported files as live state.

Preserve categories, entries, aliases, reflections, trash metadata, search
ranking, and exchange round trips. Run `npm.cmd run check -w @babel-apps/vali`
for a full gate. Apply schema migrations only with an explicit data task and
while the app is stopped.

The root `AGENTS.md` owns shared commands and public/private data discipline.
