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

interface NavigationTarget {
  readonly id: string;
  readonly workspace: string;
  readonly itemComponent: string;
  readonly workspaceComponent: string;
  readonly pageSessionComponent: string;
}

const registry = JSON.parse(
  await readFile(path.join(root, "babel.apps.json"), "utf8"),
) as RegistryDocument;

function navigationTarget(
  id: string,
  workspace: string,
): NavigationTarget {
  if (id === "neum") {
    return {
      id,
      workspace,
      itemComponent: "entry-list.tsx",
      workspaceComponent: "entries-workspace.tsx",
      pageSessionComponent: "entry-page-session.tsx",
    };
  }
  if (id === "retex" || id === "matter") {
    return {
      id,
      workspace,
      itemComponent: "item-list.tsx",
      workspaceComponent: "archive-workspace.tsx",
      pageSessionComponent: "archive-page-session.tsx",
    };
  }
  return {
    id,
    workspace,
    itemComponent: "note-list.tsx",
    workspaceComponent: "notes-workspace.tsx",
    pageSessionComponent: "note-page-session.tsx",
  };
}

assert.equal(registry.apps.length, 10, "the keyboard gate must cover ten apps");
const targets = [
  ...registry.apps.map(({ id, workspace }) => navigationTarget(id, workspace)),
  navigationTarget("mirror-app template", "templates/mirror-app"),
] as const;

function componentPath(
  target: NavigationTarget,
  name: string,
): string {
  return path.join(root, target.workspace, "src", "components", name);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("every app and the mirror template expose the Ready navigation seams", async (t) => {
  for (const target of targets) {
    await t.test(target.id, async () => {
      const [globals, folders, items, search, workspace] = await Promise.all([
        readFile(path.join(root, target.workspace, "src", "app", "globals.css"), "utf8"),
        readFile(componentPath(target, "folder-panel.tsx"), "utf8"),
        readFile(componentPath(target, target.itemComponent), "utf8"),
        readFile(componentPath(target, "search-results.tsx"), "utf8"),
        readFile(componentPath(target, target.workspaceComponent), "utf8"),
      ]);

      assert.match(
        globals,
        /@import\s+["']@babel-apps\/platform\/navigation\.css["'];/,
        `${target.id} must load the shared visible-focus styles`,
      );

      assert.match(folders, /useTreeKeyboardNavigation/);
      assert.match(folders, /\.treeProps/);
      assert.match(folders, /\.getTreeItemProps\(/);
      assert.match(folders, /role=["']presentation["']/);
      assert.doesNotMatch(
        folders,
        /<ul\s+role=["']group["']/,
        `${target.id} folder tree must use flat treeitems with explicit aria-level`,
      );
      assert.doesNotMatch(
        folders,
        /parentId:\s*parentId\s*\?\?\s*["']all["']/,
        `${target.id} must keep All and top-level folders as tree siblings`,
      );
      assert.match(folders, /data-babel-folder-disclosure=["']["']/);
      assert.match(folders, /className=["']folder-disclosure-spacer["']/);
      assert.match(folders, /data-babel-tree-inline-create=["']["']/);
      assert.doesNotMatch(
        folders,
        /<button(?:(?!>)[\s\S])*className=["']folder-disclosure["']/,
        `${target.id} disclosure hit targets must not become extra tree controls`,
      );
      assert.doesNotMatch(
        folders,
        /<button(?:(?!>)[\s\S])*className=["'](?:tree-create-action|tree-inline-create|folder-inline-create|inline-tree-create)["']/,
        `${target.id} inline folder creation must not become an owned tree control`,
      );
      const folderTree = folders.match(
        /<nav[^>]*\{\.\.\.navigation\.treeProps\}[\s\S]*?<\/nav>/,
      )?.[0];
      assert.ok(folderTree, `${target.id} must render the folder tree`);
      assert.doesNotMatch(
        folderTree,
        /panel-status|role=["']alert["']/,
        `${target.id} must render accessible loading and error status outside role=tree`,
      );
      assert.match(folders, /data-babel-pane=["']tree["']/);
      assert.match(folders, /useCommandPaletteActions/);
      for (const actionId of ["folder.new", "folder.rename", "folder.move", "folder.delete"]) {
        assert.ok(folders.includes(`id: "${actionId}"`), `${target.id} is missing ${actionId}`);
      }

      assert.match(items, /useTreeKeyboardNavigation/);
      assert.match(items, /\.treeProps/);
      assert.match(items, /\.getTreeItemProps\(/);
      assert.match(items, /role=["']presentation["']/);
      assert.doesNotMatch(
        items,
        /<ul\s+role=["']group["']/,
        `${target.id} content tree must use flat treeitems with explicit aria-level`,
      );
      assert.match(items, /data-babel-tree-disclosure=["']["']/);
      assert.match(items, /data-babel-tree-disclosure-spacer=["']["']/);
      assert.match(items, /data-babel-tree-inline-create=["']["']/);
      assert.match(items, /data-babel-child-create=["']["']/);
      assert.match(items, /expanded\s*&&\s*hasChildren/);
      assert.doesNotMatch(
        items,
        /<button(?:(?!>)[\s\S])*className=["'](?:note|entry|item)-disclosure["']/,
        `${target.id} content disclosure hit targets must not become extra tree controls`,
      );
      assert.doesNotMatch(
        items,
        /<button(?:(?!>)[\s\S])*className=["'](?:tree-inline-create|entry-inline-create|inline-tree-create|tree-create-action note-tree-create)["']/,
        `${target.id} inline child creation must not become an owned tree control`,
      );
      assert.match(items, /data-babel-pane=["']items["']/);
      assert.match(items, /useCommandPaletteActions/);
      const requiredItemActions = target.itemComponent === "note-list.tsx"
        ? ["note.new", "note.newSubnote", "note.import", "note.templates"]
        : target.itemComponent === "entry-list.tsx"
          ? ["entry.new", "entry.newSubnote", "entry.import", "entry.loadMore"]
          : ["item.new", "item.newSubnote", "item.import"];
      for (const actionId of requiredItemActions) {
        assert.ok(items.includes(`id: "${actionId}"`), `${target.id} is missing ${actionId}`);
      }

      assert.match(search, /useListKeyboardNavigation/);
      assert.match(search, /\.listboxProps/);
      assert.match(search, /\.getOptionProps\(/);
      assert.match(search, /role=["']presentation["']/);

      assert.match(workspace, /useCommandPaletteItemSource/);
      assert.match(workspace, /data-babel-pane=["']detail["']/);
    });
  }
});

test("every app and the mirror template keep a route-independent global title source", async (t) => {
  for (const target of targets) {
    await t.test(target.id, async () => {
      const [layout, source, workspace] = await Promise.all([
        readFile(path.join(root, target.workspace, "src", "app", "layout.tsx"), "utf8"),
        readFile(componentPath(target, "global-quick-open-source.tsx"), "utf8"),
        readFile(componentPath(target, target.workspaceComponent), "utf8"),
      ]);
      const appId = target.id === "mirror-app template" ? "__APP_ID__" : target.id;

      assert.match(layout, /<GlobalQuickOpenSource\s*\/>/);
      assert.match(source, /useCommandPaletteItemSource/);
      assert.match(source, /scope:\s*"global"/);
      assert.match(source, /items:\s*\[\]/);
      assert.match(source, /searchItems:\s*async\s*\(query, signal\)/);
      assert.match(source, /router\.push\(/);
      assert.ok(
        source.includes(`${appId}:`) || target.id === "mirror-app template",
        `${target.id} must namespace global title identities`,
      );
      assert.match(workspace, /dedupeKey:/);
    });
  }

  const [vali, ruider, neum, matter, retex] = await Promise.all([
    readFile(path.join(root, "apps/vali/src/components/global-quick-open-source.tsx"), "utf8"),
    readFile(path.join(root, "apps/ruider/src/components/global-quick-open-source.tsx"), "utf8"),
    readFile(path.join(root, "apps/neum/src/components/global-quick-open-source.tsx"), "utf8"),
    readFile(path.join(root, "apps/matter/src/components/global-quick-open-source.tsx"), "utf8"),
    readFile(path.join(root, "apps/retex/src/components/global-quick-open-source.tsx"), "utf8"),
  ]);
  assert.match(vali, /document\.kind === "note"/);
  assert.match(vali, /\/reflection\?date=/);
  assert.match(ruider, /Promise\.all\(\[/);
  assert.match(ruider, /listCanvases\(signal\)/);
  assert.match(neum, /entryWorkspaceHref\(entry\.kind/);
  for (const source of [matter, retex]) {
    assert.match(source, /`\/\$\{item\.kind\}\?item=\$\{item\.id\}`/);
  }
});

test("imported image pickers expose only the active page's semantic actions", async (t) => {
  for (const target of targets) {
    await t.test(target.id, async () => {
      const matcher = await readFile(
        componentPath(target, "imported-image-matcher.tsx"),
        "utf8",
      );
      assert.match(matcher, /usePageDeckPageContext/);
      assert.match(matcher, /useCommandPaletteActions/);
      assert.match(matcher, /page\.active && references\.length > 0 \? \[/);
      assert.match(matcher, /id: "imported-images\.select"/);
      assert.match(matcher, /id: `imported-image\.\$\{reference\.token\}`/);
      assert.match(matcher, /run: \(\) => bulkInputRef\.current\?\.click\(\)/);
      assert.match(matcher, /run: \(\) => openManualPicker\(reference\.token\)/);
      assert.match(matcher, /onClick=\{\(\) => openManualPicker\(reference\.token\)\}/);
    });
  }

  const reader = await readFile(
    path.join(root, "packages/markdown/src/react.tsx"),
    "utf8",
  );
  assert.match(
    reader,
    /data-babel-command="read"[\s\S]{0,180}onClick=\{openReader\}/,
    "Detached Reader must remain reachable through the palette's built-in Read command",
  );
});

test("Neum quick open owns an unfiltered all-folder entry source", async () => {
  const workspace = await readFile(
    path.join(root, "apps/neum/src/components/entries-workspace.tsx"),
    "utf8",
  );
  const loader = workspace.match(
    /const refreshQuickOpenEntries = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[kind\]\);/,
  )?.[0];

  assert.ok(loader, "Neum must load a dedicated quick-open entry index");
  assert.match(loader, /listEntries\(\{\s*kind,\s*completeTree:\s*true,/);
  assert.doesNotMatch(loader, /folderId/, "the quick-open query must span every folder");
  assert.match(workspace, /items:\s*quickOpenEntries\.map\(/);
  assert.match(workspace, /<EntryList[\s\S]*?entries=\{entries\}/);
});

test("folder dialogs retain the focused tree item and edit handoff is explicit", async (t) => {
  const pollingPattern =
    /requestPageEdit|querySelector(?:All)?\s*\(|(?:window\.)?setTimeout\s*\(/;

  for (const target of targets) {
    await t.test(target.id, async () => {
      const [folders, workspace, pageSession] = await Promise.all([
        readFile(componentPath(target, "folder-panel.tsx"), "utf8"),
        readFile(componentPath(target, target.workspaceComponent), "utf8"),
        readFile(componentPath(target, target.pageSessionComponent), "utf8"),
      ]);

      assert.match(folders, /\[dialogFolderId,\s*setDialogFolderId\]/);
      assert.match(folders, /setDialogFolderId\(folderId\)/);
      assert.match(folders, /onRename\(dialogFolderId,/);
      assert.match(folders, /onMove\(dialogFolderId,/);
      assert.match(folders, /onDelete\(dialogFolderId\)/);

      assert.match(workspace, /pendingEditPageKey/);
      assert.match(workspace, /function\s+open[A-Za-z]+ForEdit\s*\(/);
      assert.match(workspace, /editRequested=\{pendingEditPageKey === page\.key\}/);
      assert.match(workspace, /onEditRequestConsumed=/);
      assert.match(workspace, /setPendingEditPageKey\(\(current\)/);

      assert.match(pageSession, /editRequested:\s*boolean/);
      assert.match(pageSession, /onEditRequestConsumed:\s*\(\) => void/);
      assert.match(pageSession, /if\s*\(!editRequested/);
      assert.match(pageSession, /setMode\(["']edit["']\)/);
      assert.match(pageSession, /onEditRequestConsumed\(\)/);
      assert.doesNotMatch(
        `${workspace}\n${pageSession}`,
        pollingPattern,
        `${target.id} must not poll or query the DOM to enter edit mode`,
      );
    });
  }
});

test("special flat lists and multi-workspace notebooks retain their adapters", async () => {
  const [reflection, reflectionPage, canvases, canvasPage] = await Promise.all([
    readFile(path.join(root, "apps/vali/src/components/reflection-workspace.tsx"), "utf8"),
    readFile(path.join(root, "apps/vali/src/components/reflection-page-session.tsx"), "utf8"),
    readFile(path.join(root, "apps/ruider/src/components/canvas-workspace.tsx"), "utf8"),
    readFile(path.join(root, "apps/ruider/src/components/canvas-page-session.tsx"), "utf8"),
  ]);

  for (const [label, source] of [
    ["Vali Reflection", reflection],
    ["Ruider canvases", canvases],
  ] as const) {
    assert.match(source, /useListKeyboardNavigation/);
    assert.match(source, /\.listboxProps/);
    assert.match(source, /\.getOptionProps\(/);
    assert.match(source, /role=["']presentation["']/);
    assert.match(source, /data-babel-pane=["']items["']/);
    assert.match(source, /data-babel-pane=["']detail["']/);
    assert.match(source, /useCommandPaletteActions/);
    assert.match(source, /useCommandPaletteItemSource/);
    assert.ok(source.length > 0, `${label} source must be readable`);
  }

  assert.match(reflection, /pendingEditPageKey/);
  assert.match(reflection, /editRequested=\{pendingEditPageKey === page\.key\}/);
  assert.match(reflectionPage, /if\s*\(!editRequested/);
  assert.match(reflectionPage, /setMode\(["']edit["']\)/);
  assert.match(reflectionPage, /onEditRequestConsumed\(\)/);
  for (const actionId of ["vali.reflections.open-today", "vali.reflections.edit-today"]) {
    assert.ok(reflection.includes(`id: "${actionId}"`), `Vali Reflection is missing ${actionId}`);
  }
  assert.ok(canvases.includes('id: "ruider.canvases.new"'));
  assert.match(canvasPage, /useCommandPaletteActions\(`ruider\.canvas-detail\.\$\{pageKey\}`/);
  assert.match(canvasPage, /activeKey === pageKey\s*\?\s*\[/);
  assert.ok(canvasPage.includes('id: "ruider.canvas.rename"'));
  assert.ok(canvasPage.includes('id: "ruider.canvas.delete"'));
  assert.doesNotMatch(
    `${reflection}\n${reflectionPage}`,
    /requestPageEdit|querySelector(?:All)?\s*\(|(?:window\.)?setTimeout\s*\(/,
    "Vali Reflection must use the explicit edit-request handshake",
  );

  for (const id of ["retex", "matter"] as const) {
    const base = path.join(root, "apps", id, "src", "components");
    const [host, items, archive, scratch] = await Promise.all([
      readFile(path.join(base, "workspace-process-host.tsx"), "utf8"),
      readFile(path.join(base, "item-list.tsx"), "utf8"),
      readFile(path.join(base, "archive-workspace.tsx"), "utf8"),
      readFile(path.join(base, "scratch-workspace.tsx"), "utf8"),
    ]);

    assert.match(host, /activeProcess === ["']knowledge["']/);
    assert.match(host, /activeProcess === ["']exercise["']/);
    assert.match(host, /<ArchiveWorkspace/);
    assert.match(host, /<ScratchWorkspace/);

    assert.match(items, /useTreeKeyboardNavigation/);
    assert.match(items, /useListKeyboardNavigation/);
    assert.match(items, /\.treeProps/);
    assert.match(items, /\.listboxProps/);
    assert.ok(
      (items.match(/role=["']presentation["']/g) ?? []).length >= 2,
      `${id} must present both Knowledge tree and Exercise list wrappers neutrally`,
    );

    assert.match(archive, /useCommandPaletteItemSource/);
    assert.match(archive, /pendingEditPageKey/);
    assert.match(scratch, /data-babel-pane=["']detail["']/);
    assert.match(scratch, /data-babel-escape=["']list["']/);
    assert.match(scratch, /data-babel-command=["']save["']/);
    assert.match(scratch, /<ConfirmButton/);
    assert.match(scratch, /<DetachedReaderWindow/);
  }
});

test("note template managers expose list navigation, pane focus, and semantic actions", async (t) => {
  const templateTargets = targets.filter(
    (target) => target.itemComponent === "note-list.tsx",
  );

  for (const target of templateTargets) {
    await t.test(target.id, async () => {
      const managerName = target.id === "bio" || target.id === "mirror-app template"
        ? "note-template-manager.tsx"
        : "template-manager.tsx";
      const [manager, shared] = await Promise.all([
        readFile(componentPath(target, managerName), "utf8"),
        readFile(componentPath(target, "shared.tsx"), "utf8"),
      ]);

      assert.match(manager, /useListKeyboardNavigation/);
      assert.match(manager, /\.listboxProps/);
      assert.match(manager, /\.getOptionProps\(/);
      assert.match(manager, /onActivate:\s*activateTemplate/);
      assert.match(manager, /onEdit:\s*activateTemplate/);
      assert.match(manager, /data-babel-pane=["']items["']/);
      assert.ok(
        (manager.match(/data-babel-pane=["']detail["']/g) ?? []).length >= 2,
        `${target.id} must keep both empty and editing template detail states in the pane cycle`,
      );
      assert.match(manager, /requestAnimationFrame\(\(\) => focusPane\(["']detail["']\)\)/);

      assert.match(manager, /useCommandPaletteActions/);
      for (const actionId of ["template.new", "template.done"]) {
        assert.ok(manager.includes(`id: "${actionId}"`), `${target.id} is missing ${actionId}`);
      }

      assert.match(manager, /data-babel-command=["']save["']/);
      assert.match(manager, /data-babel-command=["']cancel["']/);
      assert.match(manager, /<ConfirmButton/);
      assert.match(shared, /data-babel-command=["']delete["']/);
    });
  }
});

test("search pagination is a visibility-gated semantic action in every app", async (t) => {
  for (const target of targets) {
    await t.test(target.id, async () => {
      const source = await readFile(componentPath(target, "search-results.tsx"), "utf8");
      const appId = target.id === "mirror-app template" ? "mirror-app" : target.id;

      if (appId === "matter" || appId === "retex") {
        assert.match(
          source,
          new RegExp(
            `useCommandPaletteActions\\("${escapeRegExp(appId)}\\.search",\\s*\\[[\\s\\S]{0,1200}`
            + `\\.\\.\\.\\(canLoadMoreKnowledge\\s*\\?\\s*\\[\\{[\\s\\S]{0,500}`
            + `id:\\s*"search\\.loadMoreKnowledge"[\\s\\S]{0,500}`
            + `available:\\s*loadingMore\\s*===\\s*null[\\s\\S]{0,500}`
            + `run:\\s*\\(\\)\\s*=>\\s*loadMore\\("knowledge"\\)[\\s\\S]{0,300}`
            + `\\}\\]\\s*:\\s*\\[\\]\\)`,
          ),
          `${target.id} must register Knowledge pagination only while its button exists`,
        );
        assert.match(
          source,
          /\.\.\.\(canLoadMoreExercises\s*\?\s*\[\{[\s\S]{0,500}id:\s*"search\.loadMoreExercises"[\s\S]{0,500}available:\s*loadingMore\s*===\s*null[\s\S]{0,500}run:\s*\(\)\s*=>\s*loadMore\("exercise"\)[\s\S]{0,300}\}\]\s*:\s*\[\]\)/,
          `${target.id} must register Exercise pagination only while its button exists`,
        );
        assert.match(source, /disabled=\{loadingMore !== null\}[\s\S]{0,120}onClick=\{\(\) => loadMore\("knowledge"\)\}/);
        assert.match(source, /disabled=\{loadingMore !== null\}[\s\S]{0,120}onClick=\{\(\) => loadMore\("exercise"\)\}/);
        return;
      }

      assert.match(
        source,
        new RegExp(
          `useCommandPaletteActions\\("${escapeRegExp(appId)}\\.search",\\s*canLoadMore\\s*\\?\\s*\\[[\\s\\S]{0,700}`
          + `id:\\s*"search\\.loadMore"[\\s\\S]{0,500}`
          + `available:\\s*!loadingMore[\\s\\S]{0,500}`
          + `run:\\s*loadMore[\\s\\S]{0,200}\\]\\s*:\\s*\\[\\]\\)`,
        ),
        `${target.id} must bind its visible Load more button to the palette action`,
      );
      assert.match(source, /disabled=\{loadingMore\}[\s\S]{0,120}onClick=\{loadMore\}/);
    });
  }
});

test("detail load failures expose Retry only for the active page session", async (t) => {
  for (const target of targets) {
    await t.test(target.id, async () => {
      const source = await readFile(
        componentPath(target, target.pageSessionComponent),
        "utf8",
      );
      const appId = target.id === "mirror-app template" ? "mirror-app" : target.id;
      const sourceKind = target.pageSessionComponent === "entry-page-session.tsx"
        ? "entry-detail"
        : target.pageSessionComponent === "archive-page-session.tsx"
          ? "archive-detail"
          : "note-detail";
      const actionId = sourceKind === "entry-detail"
        ? "entry.retry"
        : sourceKind === "archive-detail"
          ? "archive.retry"
          : "note.retry";

      assert.match(
        source,
        new RegExp(
          `useCommandPaletteActions\\(\\x60${escapeRegExp(appId)}\\.${sourceKind}\\.\\$\\{pageKey\\}\\x60,\\s*`
          + `activeKey\\s*===\\s*pageKey\\s*&&\\s*Boolean\\(loadError\\)\\s*\\?\\s*\\[[\\s\\S]{0,700}`
          + `id:\\s*"${escapeRegExp(actionId)}"[\\s\\S]{0,500}`
          + `available:\\s*!loading[\\s\\S]{0,500}run:\\s*retryLoading[\\s\\S]{0,200}`
          + `\\]\\s*:\\s*\\[\\]\\)`,
        ),
        `${target.id} must not expose Retry from a background or healthy page`,
      );
      assert.match(source, /<button type="button" onClick=\{retryLoading\}>/);
    });
  }
});

test("special loading failures retain explicit Retry action adapters", async () => {
  const [reflection, canvas, neumFolders, matterArchive, retexArchive] = await Promise.all([
    readFile(path.join(root, "apps/vali/src/components/reflection-page-session.tsx"), "utf8"),
    readFile(path.join(root, "apps/ruider/src/components/canvas-page-session.tsx"), "utf8"),
    readFile(path.join(root, "apps/neum/src/components/folder-panel.tsx"), "utf8"),
    readFile(path.join(root, "apps/matter/src/components/archive-workspace.tsx"), "utf8"),
    readFile(path.join(root, "apps/retex/src/components/archive-workspace.tsx"), "utf8"),
  ]);

  assert.match(
    reflection,
    /useCommandPaletteActions\([\s\S]{0,180}`vali\.reflection-detail\.\$\{pageKey\}`,[\s\S]{0,180}activeKey === pageKey && canRetryLoading \? \[[\s\S]{0,500}id: "reflection\.retry"[\s\S]{0,500}run: retryLoading/,
  );
  assert.match(reflection, /const canRetryLoading = Boolean\(error\) && exists && detail === null && !loading/);
  assert.match(canvas, /\.\.\.\(loadError && !loading \? \[\{[\s\S]{0,500}id: "ruider\.canvas\.retry"[\s\S]{0,500}run: retryLoading/);
  assert.match(neumFolders, /\.\.\.\(loadError \? \[\{[\s\S]{0,500}id: "folder\.retry"[\s\S]{0,500}run: onRetry/);

  for (const [id, archive] of [["matter", matterArchive], ["retex", retexArchive]] as const) {
    assert.match(
      archive,
      new RegExp(
        `useCommandPaletteActions\\(\\x60${id}\\.\\$\\{type\\}\\.workspace\\x60,[\\s\\S]{0,300}`
        + `processActive && Boolean\\(error\\) && !indexLoading \\? \\[[\\s\\S]{0,500}`
        + `id: "archive\\.retryIndex"[\\s\\S]{0,500}run: retryIndexLoading`,
      ),
    );
    assert.match(archive, /onClick=\{retryIndexLoading\}/);
  }
});
