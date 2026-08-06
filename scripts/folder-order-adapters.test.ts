import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

interface RegistryDocument {
  apps: Array<{ id: string; workspace: string }>;
}

interface Journal {
  entries: Array<{ idx: number; tag: string }>;
}

const root = path.resolve(import.meta.dirname, "..");
const registry = JSON.parse(
  await readFile(path.join(root, "babel.apps.json"), "utf8"),
) as RegistryDocument;

const targets = [
  ...registry.apps.map(({ id, workspace }) => ({ id, workspace })),
  { id: "mirror-app template", workspace: "templates/mirror-app" },
];

function workspaceComponent(id: string): string {
  if (id === "neum") return "entries-workspace.tsx";
  if (id === "retex" || id === "matter") return "archive-workspace.tsx";
  return "notes-workspace.tsx";
}

test("every folder adapter persists and renders sibling order", async (t) => {
  for (const target of targets) {
    await t.test(target.id, async () => {
      const targetRoot = path.join(root, target.workspace);
      const [
        schema,
        types,
        repository,
        apiClient,
        folderPanel,
        workspace,
        readiness,
        css,
      ] = await Promise.all([
        readFile(path.join(targetRoot, "src/lib/db/schema.ts"), "utf8"),
        readFile(path.join(targetRoot, "src/lib/types.ts"), "utf8"),
        readFile(path.join(targetRoot, "src/lib/repositories/folders.ts"), "utf8"),
        readFile(path.join(targetRoot, "src/lib/api-client.ts"), "utf8"),
        readFile(path.join(targetRoot, "src/components/folder-panel.tsx"), "utf8"),
        readFile(
          path.join(targetRoot, "src/components", workspaceComponent(target.id)),
          "utf8",
        ),
        readFile(path.join(targetRoot, "src/lib/db/readiness.ts"), "utf8"),
        readFile(path.join(targetRoot, "src/app/globals.css"), "utf8"),
      ]);

      assert.match(
        schema,
        /position:\s*integer\("position"\)\.notNull\(\)\.default\(0\)/,
        `${target.id} must add an additive folder position column`,
      );
      assert.match(schema, /folder_[a-z_]*position_idx/);
      assert.match(types, /interface FolderDto[\s\S]*?position:\s*number/);
      assert.match(repository, /position\?:\s*number/);
      assert.match(repository, /\.transaction\s*\(/);
      assert.match(repository, /folders\.position/);
      assert.match(apiClient, /position\?:\s*number/);

      assert.match(folderPanel, /@babel-apps\/platform\/folders\/react/);
      assert.match(folderPanel, /useFolderReorder/);
      assert.match(folderPanel, /\.selectionProps\(/);
      assert.match(folderPanel, /\.rowProps\(/);
      assert.doesNotMatch(folderPanel, /folder-reorder-handle|\.handleProps\(/);
      assert.match(folderPanel, /onReorder/);
      assert.match(workspace, /handleReorderFolder/);
      assert.match(workspace, /onReorder=\{handleReorderFolder\}/);
      assert.match(readiness, /requiredColumns:[\s\S]*?folder:[\s\S]*?position/);
      assert.match(css, /data-babel-folder-drag-source/);
      assert.match(css, /\.folder-node-row\.folder-drop-before/);
      assert.match(css, /\.folder-node-row\.folder-drop-after/);

      const drizzleRoot = path.join(targetRoot, "drizzle");
      const journal = JSON.parse(
        await readFile(path.join(drizzleRoot, "meta/_journal.json"), "utf8"),
      ) as Journal;
      const migrations = await Promise.all(journal.entries.map(async (entry) => ({
        entry,
        source: await readFile(path.join(drizzleRoot, `${entry.tag}.sql`), "utf8"),
      })));
      const matchingMigrations = migrations.filter(({ source }) =>
        /ALTER TABLE [`"]?folder[`"]? ADD [`"]?position[`"]?/i.test(source)
      );
      assert.equal(
        matchingMigrations.length,
        1,
        `${target.id} must have exactly one additive folder position migration`,
      );
      const migration = matchingMigrations[0]!.source;
      assert.match(migration, /ALTER TABLE [`"]?folder[`"]? ADD [`"]?position[`"]?/i);
      assert.match(migration, /row_number\(\)\s+OVER/i);
      assert.match(migration, /PARTITION BY/i);
      assert.match(migration, /position_idx/i);
      assert.doesNotMatch(migration, /DROP TABLE [`"]?folder/i);

      if (target.id === "retex" || target.id === "matter") {
        const itemRoute = await readFile(
          path.join(targetRoot, "src/app/api/folders/[id]/route.ts"),
          "utf8",
        );
        assert.match(itemRoute, /position/);
      }
    });
  }
});

test("Neum keeps both persistent library processes in sync after folder changes", async () => {
  const workspace = await readFile(
    path.join(root, "apps/neum/src/components/entries-workspace.tsx"),
    "utf8",
  );
  assert.match(workspace, /FOLDERS_CHANGED_EVENT/);
  assert.match(workspace, /refreshHiddenWorkspace/);
  assert.match(workspace, /notifyFoldersChanged\(\)/);
});
