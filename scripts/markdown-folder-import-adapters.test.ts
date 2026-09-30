import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

interface RegistryDocument {
  apps: Array<{ id: string; workspace: string }>;
}

const standardNoteApps = new Set([
  "bio",
  "esperanto",
  "herodotus",
  "klsche",
  "leviathan",
  "ruider",
  "vali",
]);

test("every app and the mirror scaffold expose atomic Markdown folder import", async () => {
  const registry = JSON.parse(
    await readFile(path.join(root, "babel.apps.json"), "utf8"),
  ) as RegistryDocument;
  const targets = [
    ...registry.apps,
    { id: "mirror-app", workspace: "templates/mirror-app" },
  ];

  for (const target of targets) {
    const workspace = path.join(root, target.workspace);
    const [layout, collectionRoute, sessionRoute, serverAdapter, repository] = await Promise.all([
      readFile(path.join(workspace, "src", "app", "layout.tsx"), "utf8"),
      readFile(path.join(
        workspace,
        "src",
        "app",
        "api",
        "imports",
        "markdown-folder",
        "sessions",
        "route.ts",
      ), "utf8"),
      readFile(path.join(
        workspace,
        "src",
        "app",
        "api",
        "imports",
        "markdown-folder",
        "sessions",
        "[sessionId]",
        "route.ts",
      ), "utf8"),
      readFile(path.join(workspace, "src", "lib", "markdown-folder-import.server.ts"), "utf8"),
      readFile(path.join(
        workspace,
        "src",
        "lib",
        "repositories",
        "markdown-folder-import.ts",
      ), "utf8"),
    ]);
    assert.match(layout, /@babel-apps\/platform\/imports\.css/u, `${target.id} must load import styles`);
    assert.match(collectionRoute, /createMarkdownFolderSession/u, `${target.id} must create staging sessions`);
    assert.match(sessionRoute, /export function PUT/u, `${target.id} must stage one file per request`);
    assert.match(sessionRoute, /commitMarkdownFolderSession/u, `${target.id} must expose atomic commit`);
    assert.match(sessionRoute, /export function DELETE/u, `${target.id} must clean cancelled sessions`);
    assert.match(serverAdapter, /prepareMarkdownFolderImport/u, `${target.id} must re-run server preflight`);
    assert.match(
      serverAdapter,
      /try\s*\{\s*const prepared\s*=\s*await prepareMarkdownFolderImport/u,
      `${target.id} must clean sessions when server preflight fails`,
    );
    assert.match(serverAdapter, /quarantineNoteImages/u, `${target.id} must roll back staged images`);
    assert.match(
      serverAdapter,
      /rethrowAfterMarkdownFolderImportCleanup/u,
      `${target.id} must run every rollback step`,
    );
    assert.match(repository, /importMarkdownFolderBatch/u, `${target.id} must persist one database batch`);
    assert.match(
      repository,
      /\b(?:db|sqlite)\.transaction\(/u,
      `${target.id} must commit the batch in one database transaction`,
    );
    assert.match(
      repository,
      /assertUnique(?:Import)?Titles/u,
      `${target.id} must revalidate title uniqueness`,
    );
  }
});

test("all import-capable lists expose both semantic actions and a directory picker", async () => {
  const registry = JSON.parse(
    await readFile(path.join(root, "babel.apps.json"), "utf8"),
  ) as RegistryDocument;
  for (const app of registry.apps) {
    const component = standardNoteApps.has(app.id)
      ? "note-list.tsx"
      : app.id === "neum"
        ? "entry-list.tsx"
        : "item-list.tsx";
    const source = await readFile(path.join(root, app.workspace, "src", "components", component), "utf8");
    assert.match(source, /Import Markdown file/u, `${app.id} must retain single-file import`);
    assert.match(source, /Import Markdown folder/u, `${app.id} must expose folder import`);
    assert.match(source, /webkitdirectory/u, `${app.id} must use a browser directory picker`);
    assert.match(source, /\.importFolder["']/u, `${app.id} must register a palette folder action`);
  }

  const scaffold = await readFile(
    path.join(root, "templates", "mirror-app", "src", "components", "note-list.tsx"),
    "utf8",
  );
  assert.match(scaffold, /Import Markdown folder/u);
  assert.match(scaffold, /webkitdirectory/u);
  assert.match(scaffold, /note\.importFolder/u);
});

test("specialized apps scope folder import to their Markdown knowledge type", async () => {
  const valiWorkspace = await readFile(
    path.join(root, "apps", "vali", "src", "components", "notes-workspace.tsx"),
    "utf8",
  );
  const valiRepository = await readFile(
    path.join(root, "apps", "vali", "src", "lib", "repositories", "markdown-folder-import.ts"),
    "utf8",
  );
  assert.match(valiWorkspace, /listReflections\(\)/u);
  assert.match(
    valiRepository,
    /reflections\.date/u,
    "Vali Reflection dates must participate in title conflicts",
  );

  const neum = await readFile(
    path.join(root, "apps", "neum", "src", "components", "entries-workspace.tsx"),
    "utf8",
  );
  assert.match(neum, /kind === "knowledge" && folderImportFiles/u);
  assert.match(neum, /openEntry\(first\.id, "knowledge"/u);
  const neumRepository = await readFile(
    path.join(root, "apps", "neum", "src", "lib", "repositories", "markdown-folder-import.ts"),
    "utf8",
  );
  assert.match(neumRepository, /'knowledge'/u);
  assert.match(neumRepository, /SELECT "title" FROM "entry"/u, "snippet titles must participate in conflicts");

  for (const app of ["retex", "matter"]) {
    const workspace = await readFile(
      path.join(root, "apps", app, "src", "components", "archive-workspace.tsx"),
      "utf8",
    );
    assert.match(workspace, /type === "knowledge" && folderImportFiles/u);
    assert.match(workspace, /type === "knowledge" \? listExercises\(\)/u);
    const repository = await readFile(
      path.join(root, "apps", app, "src", "lib", "repositories", "markdown-folder-import.ts"),
      "utf8",
    );
    assert.match(repository, /exercises\.title/u, `${app} exercise titles must participate in conflicts`);
    assert.match(repository, /type: "knowledge"/u, `${app} must create only knowledge folders`);
  }
});
