# __APP_NAME__ instructions

__APP_NAME__ is a language notebook Module. Preserve its folder, note, search,
Markdown, and managed-image behavior. Its private data is rooted at
`data/__APP_ID__/` from the Babel root and configured with
`__APP_ENV_PREFIX___DATABASE_PATH` and `__APP_ENV_PREFIX___UPLOAD_DIRECTORY`.

Keep database logical image paths stable when changing the physical upload
Adapter. Run `npm.cmd run check -w @babel-apps/__APP_ID__` for a full gate. Apply
schema migrations only with an explicit data task and while the app is stopped.

Keep stateful library workspaces under the root `WorkspaceProcessHost`. When a
new library is added, register its pathname and page scope, render its concrete
workspace from the host, gate navigation/history listeners with
`useWorkspaceProcessActive`, and use Next soft routing. Internal library switches
must hide, never unmount or discard, inactive workspaces. Persistent workspaces
must pass `preserveOnHistoryNavigation: true` to the shared history guard so
Back/Forward navigation cannot close another library's dirty pages. Page keys
must be globally unique across scopes; prefer `scopedPageKey(scope, localKey)`
from `@babel-apps/platform/pages/core` for new libraries.

The root `AGENTS.md` owns shared commands and public/private data discipline.
