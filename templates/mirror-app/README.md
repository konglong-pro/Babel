# __APP_NAME__

__APP_NAME__ is Babel's local, single-user language notebook. It organizes Markdown
notes in nested folders, supports tags and search, and stores managed note images
beside its SQLite database.

From the Babel root:

```powershell
npm.cmd run dev:__APP_ID__
npm.cmd run check -w @babel-apps/__APP_ID__
```

Open `http://127.0.0.1:__APP_PORT__`. Private data lives in
`data/__APP_ID__/sqlite.db` and `data/__APP_ID__/uploads/notes/` in the independent
private `data/` repository. The launcher supplies absolute
`__APP_ENV_PREFIX___DATABASE_PATH` and `__APP_ENV_PREFIX___UPLOAD_DIRECTORY` values.

The editor previews GitHub Flavored Markdown. PNG, JPEG, WebP, and GIF images up
to 10 MB can be selected or pasted; images are committed to storage only when
the note is saved.

Run schema generation or migration only for an explicit database task and only
while __APP_NAME__ is stopped. Use the root `npm.cmd run data:backup` workflow for
normal backups; never commit notebook data to the public Babel repository.
