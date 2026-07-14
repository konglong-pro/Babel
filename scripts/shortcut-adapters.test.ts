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
  const registry = JSON.parse(
    await readFile(path.join(root, "babel.apps.json"), "utf8"),
  ) as RegistryDocument;
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

    assert.doesNotMatch(
      applicationSource,
      /function\s+saveShortcut\b|addEventListener\(["']keydown["'],\s*saveShortcut\)/,
      `${target.id} must not retain the legacy fixed save shortcut listener`,
    );
  }
});
