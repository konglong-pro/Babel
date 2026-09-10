import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

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

test("every registered app and the mirror template keep search in an isolated window", async () => {
  const registry = JSON.parse(
    await readFile(path.join(root, "babel.apps.json"), "utf8"),
  ) as RegistryDocument;
  const targets = [
    ...registry.apps.map((app) => ({ ...app, storageId: app.id })),
    {
      id: "mirror-app template",
      workspace: "templates/mirror-app",
      storageId: "__APP_ID__",
    },
  ];

  for (const target of targets) {
    const workspace = path.join(root, target.workspace);
    const [layout, header, sharedComponents, application] = await Promise.all([
      readFile(path.join(workspace, "src", "app", "layout.tsx"), "utf8"),
      readFile(path.join(workspace, "src", "components", "app-header.tsx"), "utf8"),
      readFile(path.join(workspace, "src", "components", "shared.tsx"), "utf8"),
      readSourceTree(path.join(workspace, "src")),
    ]);

    assert.match(
      layout,
      /@babel-apps\/platform\/search\.css/,
      `${target.id} must load the shared search feedback styles`,
    );
    assert.match(
      header,
      /@babel-apps\/platform\/search\/window/,
      `${target.id} must use the shared search-window seam`,
    );
    assert.ok(
      header.includes(`"babel:${target.storageId}:pages"`),
      `${target.id} must clear the page sessions cloned into the search window`,
    );
    assert.ok(
      header.includes(`"babel-${target.storageId}-search"`),
      `${target.id} must use an app-specific reusable search window`,
    );
    assert.match(
      header,
      /className="babel-search-window-error"[^>]*role="alert"/,
      `${target.id} must report a blocked popup without leaving the workspace`,
    );
    const submitStart = header.indexOf("function submitSearch");
    const submitEnd = header.indexOf("\n  return (", submitStart);
    assert.ok(
      submitStart >= 0 && submitEnd > submitStart,
      `${target.id} must keep an inspectable search submission adapter`,
    );
    const submitSearch = header.slice(submitStart, submitEnd);
    assert.doesNotMatch(
      submitSearch,
      /router\.push\(destination\)|location(?:\.href)?\s*=\s*destination/,
      `${target.id} search must not replace the active workspace`,
    );
    assert.match(
      sharedComponents,
      /data-search-field="tags"/,
      `${target.id} must retain a tag focus target even when its tag list is empty`,
    );

    for (const seam of [
      "appendSearchFocus",
      "searchFocusFromParams",
      "focusSearchMatch",
      "focusSourceLine",
    ]) {
      assert.ok(
        application.includes(seam),
        `${target.id} is missing the ${seam} result-location adapter`,
      );
    }
  }
});
