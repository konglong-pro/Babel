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
const requiredNavigationCommands = [
  "focusNextPane",
  "focusPreviousPane",
  "nextTab",
  "previousTab",
  "closeTab",
  "quickOpen",
  "help",
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
  const [
    registrySource,
    sharedReaderSource,
    defaultsSource,
    shortcutRuntimeSource,
    navigationSource,
    pagesSource,
  ] = await Promise.all([
    readFile(path.join(root, "babel.apps.json"), "utf8"),
    readFile(path.join(root, "packages", "markdown", "src", "react.tsx"), "utf8"),
    readFile(path.join(root, "packages", "platform", "shortcuts.defaults.json"), "utf8"),
    readFile(path.join(root, "packages", "platform", "src", "shortcuts", "react.tsx"), "utf8"),
    readFile(path.join(root, "packages", "platform", "src", "navigation", "react.tsx"), "utf8"),
    readFile(path.join(root, "packages", "platform", "src", "pages", "react.tsx"), "utf8"),
  ]);
  const registry = JSON.parse(registrySource) as RegistryDocument;
  const defaults = JSON.parse(defaultsSource) as {
    readonly schemaVersion: number;
    readonly commands: ReadonlyArray<{ readonly command: string }>;
  };
  assert.equal(defaults.schemaVersion, 3, "keyboard navigation commands require schema v3");
  const configuredCommands = new Set(defaults.commands.map(({ command }) => command));
  for (const command of requiredNavigationCommands) {
    assert.ok(
      configuredCommands.has(command),
      `shortcut defaults are missing the ${command} navigation command`,
    );
  }
  for (const command of ["quickOpen", "help"] as const) {
    assert.match(
      shortcutRuntimeSource,
      new RegExp(`command === ["']${command}["']`),
      `${command} must have an executable shortcut runtime branch`,
    );
  }
  for (const command of ["focusNextPane", "focusPreviousPane"] as const) {
    assert.match(
      navigationSource,
      new RegExp(`hidden[\\s\\S]*?data-babel-command-adapter=["']["'][\\s\\S]*?data-babel-command=["']${command}["']`),
      `${command} must expose a hidden pane-focus command adapter`,
    );
  }
  for (const command of ["nextTab", "previousTab", "closeTab"] as const) {
    assert.match(
      pagesSource,
      new RegExp(`hidden[\\s\\S]*?data-babel-command-adapter=["']["'][\\s\\S]*?data-babel-command=["']${command}["']`),
      `${command} must expose a hidden page-tab command adapter`,
    );
  }
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

test("every reader control is portaled to the right edge of its action row", async () => {
  const readerTargets = [
    ["ReTex Knowledge", "apps/retex/src/components/knowledge-detail.tsx", 2],
    ["ReTex Exercise", "apps/retex/src/components/exercise-detail.tsx", 2],
    ["ReTex Scratch", "apps/retex/src/components/scratch-workspace.tsx", 1],
    ["Matter Knowledge", "apps/matter/src/components/knowledge-detail.tsx", 2],
    ["Matter Exercise", "apps/matter/src/components/exercise-detail.tsx", 2],
    ["Matter Scratch", "apps/matter/src/components/scratch-workspace.tsx", 1],
    ["Bio", "apps/bio/src/components/note-detail.tsx", 2],
    ["Vali Notes", "apps/vali/src/components/note-detail.tsx", 2],
    ["Vali Reflection", "apps/vali/src/components/reflection-page-session.tsx", 2],
    ["Herodotus", "apps/herodotus/src/components/note-detail.tsx", 2],
    ["Leviathan", "apps/leviathan/src/components/note-detail.tsx", 2],
    ["Esperanto", "apps/esperanto/src/components/note-detail.tsx", 2],
    ["KLsche", "apps/klsche/src/components/note-detail.tsx", 2],
    ["Neum", "apps/neum/src/components/entry-detail.tsx", 2],
    ["Ruider", "apps/ruider/src/components/note-detail.tsx", 2],
    ["mirror-app template", "templates/mirror-app/src/components/note-detail.tsx", 2],
  ] as const;

  for (const [label, relativePath, expectedCount] of readerTargets) {
    const source = await readFile(path.join(root, relativePath), "utf8");
    assert.equal(
      (source.match(/buttonPortalTargetId=\{readerTriggerId\}/g) ?? []).length,
      expectedCount,
      `${label} must portal every Read button to its page-specific action target`,
    );
    assert.equal(
      (source.match(/<div id=\{readerTriggerId\} className="reader-trigger-slot"\s*\/>/g) ?? []).length,
      expectedCount,
      `${label} must place every Read target at the end of an action row`,
    );
    assert.doesNotMatch(
      source,
      /babel-detached-reader-trigger-target|babel-reader-title-button/,
      `${label} must not retain a shared or title-level Read target`,
    );
  }

  const hierarchicalDetails = [
    ["ReTex Knowledge", "apps/retex/src/components/knowledge-detail.tsx"],
    ["Matter Knowledge", "apps/matter/src/components/knowledge-detail.tsx"],
    ["Bio", "apps/bio/src/components/note-detail.tsx"],
    ["Vali Notes", "apps/vali/src/components/note-detail.tsx"],
    ["Herodotus", "apps/herodotus/src/components/note-detail.tsx"],
    ["Leviathan", "apps/leviathan/src/components/note-detail.tsx"],
    ["Esperanto", "apps/esperanto/src/components/note-detail.tsx"],
    ["KLsche", "apps/klsche/src/components/note-detail.tsx"],
    ["Neum", "apps/neum/src/components/entry-detail.tsx"],
    ["Ruider", "apps/ruider/src/components/note-detail.tsx"],
    ["mirror-app template", "templates/mirror-app/src/components/note-detail.tsx"],
  ] as const;
  const fourActionPattern =
    /<div className="document-actions">[\s\S]*?New subnote[\s\S]*?data-babel-command="edit"[\s\S]*?>\s*Edit\s*<\/button>[\s\S]*?<ConfirmButton[\s\S]*?>\s*Delete\s*<\/ConfirmButton>\s*<div id=\{readerTriggerId\} className="reader-trigger-slot"\s*\/>/;

  for (const [label, relativePath] of hierarchicalDetails) {
    const source = await readFile(path.join(root, relativePath), "utf8");
    assert.match(
      source,
      fourActionPattern,
      `${label} must order its detail actions as New subnote, Edit, Delete, Read`,
    );
  }

  const formerHeadingTargets = [
    ["ReTex", "apps/retex/src/components/item-list.tsx"],
    ["Matter", "apps/matter/src/components/item-list.tsx"],
    ["Bio", "apps/bio/src/components/note-list.tsx"],
    ["Vali Notes", "apps/vali/src/components/note-list.tsx"],
    ["Vali Reflection", "apps/vali/src/components/reflection-workspace.tsx"],
    ["Herodotus", "apps/herodotus/src/components/note-list.tsx"],
    ["Leviathan", "apps/leviathan/src/components/note-list.tsx"],
    ["Esperanto", "apps/esperanto/src/components/note-list.tsx"],
    ["KLsche", "apps/klsche/src/components/note-list.tsx"],
    ["Neum", "apps/neum/src/components/entry-list.tsx"],
    ["Ruider", "apps/ruider/src/components/note-list.tsx"],
    ["mirror-app template", "templates/mirror-app/src/components/note-list.tsx"],
  ] as const;

  for (const [label, relativePath] of formerHeadingTargets) {
    const source = await readFile(path.join(root, relativePath), "utf8");
    assert.doesNotMatch(
      source,
      /reader-trigger-slot|babel-detached-reader-trigger-target/,
      `${label} must not retain a Read target in its list heading`,
    );
  }

  for (const [label, relativePath] of [
    ["ReTex", "apps/retex/src/components/scratch-workspace.tsx"],
    ["Matter", "apps/matter/src/components/scratch-workspace.tsx"],
  ] as const) {
    const scratchSource = await readFile(path.join(root, relativePath), "utf8");
    assert.match(
      scratchSource,
      /<div className="scratch-actions">[\s\S]*?Save Scratch[\s\S]*?<div id=\{readerTriggerId\} className="reader-trigger-slot"\s*\/>/,
      `${label} Scratch must place the Read target after Save Scratch`,
    );
  }
});
