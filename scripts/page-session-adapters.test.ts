import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const HARD_RELOAD_NAVIGATION = /(?:window\.)?location(?:\.(?:assign|replace|reload)\s*\(|(?:\.href)?\s*=)/;
const INTERNAL_ANCHOR_NAVIGATION = /<a\b[^>]*\bhref\s*=\s*(?:["']\/|\{\s*["'`]\/)/;

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
  readonly hasProcessHost: boolean;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function discoverPageAdapterTarget(
  id: string,
  workspace: string,
  storageId: string,
): Promise<PageAdapterTarget> {
  const workspaceRoot = path.join(root, workspace);
  const componentsRoot = path.join(workspaceRoot, "src", "components");
  const componentNames = (await readdir(componentsRoot))
    .filter((name) => name.endsWith(".tsx"));
  const componentSources = new Map<string, string>();
  for (const name of componentNames) {
    componentSources.set(
      name,
      await readFile(path.join(componentsRoot, name), "utf8"),
    );
  }
  const adapters = [...componentSources]
    .filter(([, source]) =>
      source.includes("PageDeckPage") &&
      source.includes("usePageSessionLifecycle") &&
      source.includes("setPageStatus")
    )
    .map(([name]) => `src/components/${name}`)
    .sort();
  const hostPath = path.join(componentsRoot, "workspace-process-host.tsx");
  const hasProcessHost = await exists(hostPath);
  const workspaces = hasProcessHost
    ? [...(await readFile(hostPath, "utf8")).matchAll(
        /from\s+["']@\/components\/([^"']*workspace)["']/g,
      )]
        .map((match) => `src/components/${match[1]}.tsx`)
        .filter((value, index, values) => values.indexOf(value) === index)
        .sort()
    : ["src/components/notes-workspace.tsx"];
  assert.ok(adapters.length > 0, `${id} must expose at least one page adapter`);
  assert.ok(workspaces.length > 0, `${id} must expose at least one workspace`);
  return {
    id,
    workspace,
    storageId,
    adapters,
    workspaces,
    hasProcessHost,
  };
}

async function pageAdapterTargets(): Promise<readonly PageAdapterTarget[]> {
  const registry = JSON.parse(
    await readFile(path.join(root, "babel.apps.json"), "utf8"),
  ) as RegistryDocument;
  return Promise.all([
    ...registry.apps.map((app) => discoverPageAdapterTarget(
      app.id,
      app.workspace,
      app.id,
    )),
    discoverPageAdapterTarget(
      "mirror-app template",
      "templates/mirror-app",
      "__APP_ID__",
    ),
  ]);
}

function propertyName(property: ts.ObjectLiteralElementLike): string | null {
  if (ts.isSpreadAssignment(property) || property.name === undefined) return null;
  return ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
    ? property.name.text
    : null;
}

function assertPageDescriptorsAreScoped(
  source: string,
  label: string,
): void {
  const sourceFile = ts.createSourceFile(
    label,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      const names = new Set(node.properties.map(propertyName).filter(
        (name): name is string => name !== null,
      ));
      if (["key", "kind", "title", "href"].every((name) => names.has(name))) {
        assert.ok(names.has("scope"), `${label} has an unscoped page descriptor`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

test("every registered app and the mirror template mount the shared page-session base", async () => {
  const targets = await pageAdapterTargets();

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
    assert.match(
      layout,
      /<[A-Za-z]*PageTabs\s*\/>/,
      `${target.id} must render shared page tabs or its Next navigation adapter`,
    );

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
      if (target.hasProcessHost) {
        assertPageDescriptorsAreScoped(
          source,
          `${target.id} adapter ${relativePath}`,
        );
      }
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

test("multi-workspace apps and the mirror template keep processes mounted across routes", async () => {
  const targets = (await pageAdapterTargets()).filter(
    (target) => target.hasProcessHost,
  );

  for (const target of targets) {
    const workspace = path.join(root, target.workspace);
    const layout = await readFile(
      path.join(workspace, "src", "app", "layout.tsx"),
      "utf8",
    );
    const host = await readFile(
      path.join(workspace, "src", "components", "workspace-process-host.tsx"),
      "utf8",
    );
    const registry = await readFile(
      path.join(workspace, "src", "lib", "workspace-process.ts"),
      "utf8",
    );

    assert.match(
      layout,
      /<[A-Za-z]*WorkspaceProcessHost>\{children\}<\/[A-Za-z]*WorkspaceProcessHost>/,
      `${target.id} must mount route children through a persistent process host`,
    );
    assert.match(
      host,
      /@babel-apps\/platform\/pages\/next/,
      `${target.id} must adapt PageTabs to the Next router`,
    );
    assert.match(
      host,
      /WorkspaceProcessHost/,
      `${target.id} must use the shared mounted-process seam`,
    );
    assert.doesNotMatch(
      host,
      HARD_RELOAD_NAVIGATION,
      `${target.id} process navigation must not reload the page`,
    );
    assert.match(registry, /scope:/, `${target.id} must register page scopes`);
    await readFile(path.join(workspace, "tests", "workspace-process.test.ts"), "utf8");

    for (const relativePath of target.adapters) {
      const source = await readFile(path.join(workspace, relativePath), "utf8");
      assert.match(
        source,
        /scope:/,
        `${target.id} adapter ${relativePath} must scope every new page process`,
      );
      assertPageDescriptorsAreScoped(
        source,
        `${target.id} adapter ${relativePath}`,
      );
    }

    for (const relativePath of target.workspaces) {
      const source = await readFile(path.join(workspace, relativePath), "utf8");
      assert.match(
        source,
        /useWorkspaceProcessActive/,
        `${target.id} workspace ${relativePath} must gate navigation guards to the active process`,
      );
      assert.match(
        source,
        /preserveOnHistoryNavigation:\s*true/,
        `${target.id} workspace ${relativePath} must preserve its process on browser history navigation`,
      );
      assert.match(
        source,
        /processActive\s*\?\s*\(?\s*<Active[A-Za-z]*HistoryGuard/,
        `${target.id} workspace ${relativePath} must mount its history guard only while its process is active`,
      );
      if (source.includes("routeTargetKey")) {
        assert.match(
          source,
          /workspaceProcessRouteTargetShouldApply\s*\(/,
          `${target.id} workspace ${relativePath} must preserve bare route targets when its process is reactivated`,
        );
      }
      assertPageDescriptorsAreScoped(
        source,
        `${target.id} workspace ${relativePath}`,
      );
      assert.doesNotMatch(
        source,
        HARD_RELOAD_NAVIGATION,
        `${target.id} workspace ${relativePath} must use soft internal routing`,
      );
      assert.doesNotMatch(
        source,
        INTERNAL_ANCHOR_NAVIGATION,
        `${target.id} workspace ${relativePath} must not use native anchors for internal routing`,
      );
    }
  }
});
