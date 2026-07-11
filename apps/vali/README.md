# Vali

Vali is Babel's structured local vault for categories, entries, aliases,
reflections, and deleted-entry snapshots. SQLite is the sole source of truth.

From the Babel root:

```powershell
npm.cmd run dev:vali
npm.cmd run check -w @babel-apps/vali
```

Open `http://127.0.0.1:3002`. Private data lives in `data/vali/sqlite.db` in the
independent private `data/` repository. The launcher supplies an absolute
`VALI_DATABASE_PATH`.

## Markdown and JSON exchange

Vali can import and export its legacy Markdown/JSON vault format. This is a
canonical semantic round trip: content and domain metadata are preserved while
line endings and JSON formatting may be normalized. Exported files are exchange
artifacts, not the live editing store.

Run the scripts from the Vali workspace through the root installation. Import
targets must contain no vault data, and export destinations must be new or empty.
Keep an external backup and run a dry-run before importing.

## Database maintenance

Run schema migration only for an explicit database task and only while Vali is
stopped. Use the root `npm.cmd run data:backup` workflow for routine backups.
During recovery, move the current database and every sidecar aside together,
copy a verified checkpoint to `sqlite.db`, and never overwrite a live database.
