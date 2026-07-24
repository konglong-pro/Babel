import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const requiredAdapterCommands = [
  "save",
  "new",
  "edit",
  "confirm",
  "cancel",
  "search",
  "delete",
] as const;

interface RegistryDocument {
  readonly apps: ReadonlyArray<{
    readonly id: string;
    readonly workspace: string;
  }>;
}

async function readSourceTree(directory: string): Promise<string> {
  const entries = await readdir(directory, { withFileTypes: true });
  const sources = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return readSourceTree(entryPath);
      if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) return "";
      return readFile(entryPath, "utf8");
    }),
  );
  return sources.join("\n");
}

test("every registered app and the mirror template expose the global shortcut seam", async () => {
  const [registrySource, sharedReaderSource] = await Promise.all([
    readFile(path.join(root, "babel.apps.json"), "utf8"),
    readFile(path.join(root, "packages", "markdown", "src", "react.tsx"), "utf8"),
  ]);
  const registry = JSON.parse(registrySource) as RegistryDocument;
  assert.ok(
    sharedReaderSource.includes('data-babel-command="read"'),
    "the shared detached reader button must expose the read shortcut adapter",
  );
  const targets = [
    ...registry.apps,
    { id: "mirror-app template", workspace: "templates/mirror-app" },
  ];

  for (const target of targets) {
    const workspace = path.join(root, target.workspace);
    const [layoutSource, routeSource, applicationSource] = await Promise.all([
      readFile(path.join(workspace, "src", "app", "layout.tsx"), "utf8"),
      readFile(path.join(workspace, "src", "app", "api", "shortcuts", "route.ts"), "utf8"),
      readSourceTree(path.join(workspace, "src")),
    ]);

    assert.match(
      layoutSource,
      /@babel-apps\/platform\/shortcuts\.css/,
      `${target.id} must load the shared shortcut styles`,
    );
    assert.match(
      layoutSource,
      /<ShortcutProvider>/,
      `${target.id} must mount ShortcutProvider`,
    );
    assert.match(
      routeSource,
      /export const dynamic = ["']force-dynamic["']/,
      `${target.id} shortcut settings must be read at request time`,
    );
    assert.match(
      routeSource,
      /shortcutSettingsResponse\(\)/,
      `${target.id} must serve the shared shortcut settings contract`,
    );

    for (const command of requiredAdapterCommands) {
      assert.ok(
        applicationSource.includes(`data-babel-command="${command}"`),
        `${target.id} is missing the ${command} shortcut adapter`,
      );
    }
    assert.ok(
      applicationSource.includes("<DetachedReaderWindow"),
      `${target.id} is missing the shared read shortcut adapter`,
    );

    assert.doesNotMatch(
      applicationSource,
      /function\s+saveShortcut\b|addEventListener\(["']keydown["'],\s*saveShortcut\)/,
      `${target.id} must not retain the legacy fixed save shortcut listener`,
    );
  }
});

test("every reader control is portaled above its content heading", async () => {
  const readerTargets = [
    ["ReTex Knowledge", "apps/retex/src/components/knowledge-detail.tsx", 2],
    ["ReTex Exercise", "apps/retex/src/components/exercise-detail.tsx", 2],
    ["ReTex Scratch", "apps/retex/src/components/scratch-workspace.tsx", 1],
    ["Vali Notes", "apps/vali/src/components/note-detail.tsx", 2],
    ["Vali Reflection", "apps/vali/src/components/reflection-page-session.tsx", 2],
    ["Herodotus", "apps/herodotus/src/components/note-detail.tsx", 2],
    ["Leviathan", "apps/leviathan/src/components/note-detail.tsx", 2],
    ["Esperanto", "apps/esperanto/src/components/note-detail.tsx", 2],
    ["Neum", "apps/neum/src/components/entry-detail.tsx", 2],
    ["mirror-app template", "templates/mirror-app/src/components/note-detail.tsx", 2],
  ] as const;
  const portalReaderPattern =
    /<DetachedReaderWindow[\s\S]*?buttonPortalTargetId="babel-detached-reader-trigger-target"[\s\S]*?<\/DetachedReaderWindow>/g;

  for (const [label, relativePath, expectedCount] of readerTargets) {
    const source = await readFile(path.join(root, relativePath), "utf8");
    assert.equal(
      (source.match(portalReaderPattern) ?? []).length,
      expectedCount,
      `${label} must portal every Read button to its content heading`,
    );
    assert.doesNotMatch(
      source,
      /babel-reader-title-button/,
      `${label} must not retain the old detail-title button placement`,
    );
  }

  const contentHeadingTargets = [
    ["ReTex", "apps/retex/src/components/item-list.tsx"],
    ["Vali Notes", "apps/vali/src/components/note-list.tsx"],
    ["Vali Reflection", "apps/vali/src/components/reflection-workspace.tsx"],
    ["Herodotus", "apps/herodotus/src/components/note-list.tsx"],
    ["Leviathan", "apps/leviathan/src/components/note-list.tsx"],
    ["Esperanto", "apps/esperanto/src/components/note-list.tsx"],
    ["Neum", "apps/neum/src/components/entry-list.tsx"],
    ["mirror-app template", "templates/mirror-app/src/components/note-list.tsx"],
  ] as const;
  const contentHeadingPattern =
    /<div id="babel-detached-reader-trigger-target" className="reader-trigger-slot"\s*\/>\s*<span className="eyebrow"/;

  for (const [label, relativePath] of contentHeadingTargets) {
    const source = await readFile(path.join(root, relativePath), "utf8");
    assert.match(
      source,
      contentHeadingPattern,
      `${label} must place the Read target directly above its content eyebrow`,
    );
  }

  const scratchSource = await readFile(
    path.join(root, "apps/retex/src/components/scratch-workspace.tsx"),
    "utf8",
  );
  assert.match(
    scratchSource,
    /<section className="scratch-editor"[\s\S]*?<div id="babel-detached-reader-trigger-target" className="reader-trigger-slot"\s*\/>\s*<div className="editor-outline-layout">/,
    "ReTex Scratch must place the Read target above its editor content",
  );
});
