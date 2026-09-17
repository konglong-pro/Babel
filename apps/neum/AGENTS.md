# Neum instructions

Neum is a local, single-user computer-science knowledge notebook. Preserve its
folder tree, `knowledge`/`snippet` entry model, relational tags, literal search,
permanent entry deletion, Markdown notes, and managed-image ownership behavior.
SQLite is the live source of truth; snapshot bundles are lossless exchange
artifacts only. Existing `trash_entry` rows are compatibility-only private data:
do not expose Trash UI/runtime APIs, migrate the schema, or delete those rows as
part of ordinary feature work.

Private data is rooted at `data/neum/` from the Babel root and configured with
`NEUM_DATABASE_PATH` and `NEUM_UPLOAD_DIRECTORY`. Keep logical image paths stable
when changing physical storage. Snapshot import/export and schema migration
require Neum to be stopped; import applies only to a pristine target after a
successful dry-run.

Run `npm.cmd run check -w @babel-apps/neum` for the full App gate. The root
`AGENTS.md` owns shared commands and public/private data discipline.
