import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

interface RegistryDocument {
  readonly apps: ReadonlyArray<{
    readonly id: string;
    readonly workspace: string;
  }>;
}

interface PageAdapterTarget {
  readonly id: string;
  readonly workspace: string;
  readonly storageId: string;
  readonly adapters: readonly string[];
  readonly workspaces: readonly string[];
}

const specializedAdapters: Readonly<
  Record<string, Pick<PageAdapterTarget, "adapters" | "workspaces">>
> = {
  neum: {
    adapters: ["src/components/entry-page-session.tsx"],
    workspaces: ["src/components/entries-workspace.tsx"],
  },
  retex: {
    adapters: [
      "src/components/archive-page-session.tsx",
      "src/components/scratch-workspace.tsx",
    ],
    workspaces: [
      "src/components/archive-workspace.tsx",
      "src/components/scratch-workspace.tsx",
    ],
  },
  matter: {
    adapters: [
      "src/components/archive-page-session.tsx",
      "src/components/scratch-workspace.tsx",
    ],
    workspaces: [
      "src/components/archive-workspace.tsx",
      "src/components/scratch-workspace.tsx",
    ],
  },
  ruider: {
    adapters: [
      "src/components/note-page-session.tsx",
      "src/components/canvas-page-session.tsx",
    ],
    workspaces: [
      "src/components/notes-workspace.tsx",
      "src/components/canvas-workspace.tsx",
    ],
  },
  vali: {
    adapters: [
      "src/components/note-page-session.tsx",
      "src/components/reflection-page-session.tsx",
    ],
    workspaces: [
      "src/components/notes-workspace.tsx",
      "src/components/reflection-workspace.tsx",
    ],
  },
};

test("every registered app and the mirror template mount the shared page-session base", async () => {
  const registry = JSON.parse(
    await readFile(path.join(root, "babel.apps.json"), "utf8"),
  ) as RegistryDocument;
  const targets: PageAdapterTarget[] = [
    ...registry.apps.map((app) => ({
      ...app,
      storageId: app.id,
      adapters: specializedAdapters[app.id]?.adapters ??
        ["src/components/note-page-session.tsx"],
      workspaces: specializedAdapters[app.id]?.workspaces ??
        ["src/components/notes-workspace.tsx"],
    })),
    {
      id: "mirror-app template",
      workspace: "templates/mirror-app",
      storageId: "__APP_ID__",
      adapters: ["src/components/note-page-session.tsx"],
      workspaces: ["src/components/notes-workspace.tsx"],
    },
  ];

  for (const target of targets) {
    const workspace = path.join(root, target.workspace);
    const layout = await readFile(
      path.join(workspace, "src", "app", "layout.tsx"),
      "utf8",
    );
    assert.match(
      layout,
      /@babel-apps\/platform\/pages\.css/,
      `${target.id} must load the shared page styles`,
    );
    assert.ok(
      layout.includes(
        `<PageSessionProvider storageKey="babel:${target.storageId}:pages">`,
      ),
      `${target.id} must mount an isolated persistent page provider`,
    );
    assert.match(layout, /<PageTabs\s*\/>/, `${target.id} must render the shared page tabs`);

    for (const relativePath of target.adapters) {
      const source = await readFile(path.join(workspace, relativePath), "utf8");
      assert.ok(
        source.includes("PageDeckPage"),
        `${target.id} adapter ${relativePath} must retain inactive page state`,
      );
      assert.ok(
        source.includes("usePageSessionLifecycle"),
        `${target.id} adapter ${relativePath} must expose save/discard lifecycle`,
      );
      assert.ok(
        source.includes("setPageStatus"),
        `${target.id} adapter ${relativePath} must publish dirty and pending state`,
      );
    }

    for (const relativePath of target.workspaces) {
      const source = await readFile(path.join(workspace, relativePath), "utf8");
      assert.ok(
        source.includes("usePageSessionHistoryGuard"),
        `${target.id} workspace ${relativePath} must protect unsaved pages on browser Back`,
      );
    }
  }
});
