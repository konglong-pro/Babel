import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

import { entrySubtreeIds } from "../apps/neum/src/components/entry-tree-state";

const root = path.resolve(import.meta.dirname, "..");
const targets = ["vali", "ruider", "bio", "carbon", "esperanto", "herodotus", "klsche", "leviathan", "neum", "template"];

function sourceFunction(ast: ts.SourceFile, name: string): string {
  let result: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) result = node;
    else ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(result, `Missing production function ${name}`);
  return result.getText(ast);
}

type Page = { key: string; title: string; dirty?: boolean; pending?: boolean };

for (const id of targets) {
  const entry = id === "neum";
  const entity = entry ? "entry" : "note";
  const workspace = id === "template" ? "templates/mirror-app" : `apps/${id}`;
  const components = path.join(root, workspace, "src/components");
  const source = await readFile(path.join(components, entry ? "entries-workspace.tsx" : "notes-workspace.tsx"), "utf8");
  const ast = ts.createSourceFile("workspace.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const keyName = entry ? "savedEntryId" : "savedNoteId";
  const moveName = entry ? "withEntryFolderMove" : "withNoteFolderMove";
  const code = ts.transpileModule([
    sourceFunction(ast, keyName),
    ...(entry ? [] : [sourceFunction(ast, "subtreeIds")]),
    sourceFunction(ast, moveName),
  ].join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const prefix = source.includes("SAVED_NOTE_KEY_PREFIX") ? "notes:note:" : `${entity}:`;

  function setup(status: Partial<Page> = {}, childDraft = false) {
    const items = [
      { id: 1, parentId: null, folderId: 10, kind: "knowledge" },
      { id: 2, parentId: 1, folderId: 10, kind: "knowledge" },
      { id: 3, parentId: 2, folderId: 10, kind: "knowledge" },
      { id: 4, parentId: null, folderId: 10, kind: "knowledge" },
    ];
    const pages: Page[] = [
      { key: `${prefix}1`, title: "Parent", dirty: true, pending: true },
      { key: `${prefix}2`, title: "Child", ...status },
      { key: `${prefix}4`, title: "Unrelated", dirty: true },
    ];
    const resource = { parentId: 2, content: "Keep this draft", images: ["blob:child"] };
    const drafts = childDraft ? { draft: resource } : {};
    if (childDraft) pages.push({ key: "draft", title: "Unsaved child" });
    const moving: number[][] = [];
    const updates: Array<{ key: string; href: string }> = [];
    let revisions: Record<number, number> = {};
    let saves = 0;
    const context = {
      notes: items, entries: items, quickOpenEntries: entry ? items : [],
      folders: [{ id: 10 }, { id: 20 }], pages, drafts, kind: "knowledge",
      SAVED_NOTE_KEY_PREFIX: prefix,
      entrySubtreeIds,
      savedNotePage: ({ id, folderId }: { id: number; folderId: number }) => ({ href: `/notes?folder=${folderId}&note=${id}` }),
      entryWorkspaceHref: (_kind: string, { folderId, entryId }: { folderId: number; entryId: number }) => `/knowledge?folder=${folderId}&entry=${entryId}`,
      updatePage: (key: string, patch: { href: string }) => updates.push({ key, ...patch }),
      setMovingItemIds: (ids: ReadonlySet<number>) => moving.push([...ids]),
      setMoveRevisions: (update: (current: Record<number, number>) => Record<number, number>) => { revisions = update(revisions); },
    };
    const run = new Function(...Object.keys(context), `${code}\nreturn ${moveName};`)(...Object.values(context)) as <T>(id: number, folderId: number, save: () => Promise<T>, editingId?: number | null) => Promise<T>;
    return { run, pages, resource, drafts, moving, updates, revisions: () => revisions, saves: () => saves, save: async () => { saves += 1; return "saved"; } };
  }

  test(`${id}: editor folder moves refresh clean descendants and preserve the submitting form`, async () => {
    const state = setup();
    let finish!: (result: string) => void;
    const request = state.run(1, 20, () => new Promise<string>(resolve => { finish = resolve; }), 1);
    assert.deepEqual(state.moving, [[2, 3]], "The submitting parent editor must stay mounted during the request.");
    assert.deepEqual(state.updates, [], "Location and reload state cannot advance before the save commits.");
    finish("canonical saved detail");
    assert.equal(await request, "canonical saved detail");
    assert.deepEqual(state.moving, [[2, 3], []]);
    assert.deepEqual(state.revisions(), { 2: 1, 3: 1 });
    assert.deepEqual(state.updates.map(({ key }) => key), [`${prefix}1`, `${prefix}2`]);
    assert.ok(state.updates.every(({ href }) => href.includes("folder=20")));
    assert.equal(state.pages[2].dirty, true, "Unrelated open drafts remain untouched.");
  });

  for (const [label, status, draft] of [
    ["dirty child", { dirty: true }, false],
    ["pending child", { pending: true }, false],
    ["unsaved descendant draft", {}, true],
  ] as const) {
    test(`${id}: reject folder moves before saving when there is a ${label}`, async () => {
      const state = setup(status, draft);
      await assert.rejects(state.run(1, 20, state.save, 1), /Save or close open drafts/);
      assert.equal(state.saves(), 0);
      assert.deepEqual(state.moving, []);
      assert.deepEqual(state.updates, []);
      assert.deepEqual(state.revisions(), {});
      assert.deepEqual(state.resource, { parentId: 2, content: "Keep this draft", images: ["blob:child"] });
    });
  }

  test(`${id}: same-folder edits preserve drafts and failed moves never reload them`, async () => {
    const state = setup({ dirty: true }, true);
    assert.equal(await state.run(1, 10, state.save, 1), "saved");
    assert.deepEqual(state.moving, []);
    const failed = setup();
    await assert.rejects(failed.run(1, 20, async () => { throw new Error("save failed"); }, 1), /save failed/);
    assert.deepEqual(failed.moving, [[2, 3], []]);
    assert.deepEqual(failed.updates, []);
    assert.deepEqual(failed.revisions(), {});
    const tree = setup();
    await assert.rejects(tree.run(1, 20, tree.save), /Save or close open drafts/, "Tree moves still protect the root editor.");
  });

  test(`${id}: the actual editor save and tree move share subtree protection`, async () => {
    const session = await readFile(path.join(components, `${entity}-page-session.tsx`), "utf8");
    const detail = await readFile(path.join(components, `${entity}-detail.tsx`), "utf8");
    const capital = entry ? "Entry" : "Note";
    assert.ok(source.includes(`onUpdate${capital}={update${capital}FromEditor}`));
    assert.ok(session.includes(`onUpdate${capital}={onUpdate${capital}}`));
    assert.ok(detail.includes(`? onUpdate${capital}(detail.id,`));
    assert.ok(source.includes(`${moveName}(id, input.folderId,`));
    assert.match(session, /setPageStatus\(pageKey, \{ dirty, pending \}\)/);
    assert.match(detail, /onPendingChange\(true\)/);
  });
}
