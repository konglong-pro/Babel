import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

import {
  createPageSessionsState,
  pageSessionsReducer,
  type PageSessionDescriptor,
  type PageSessionsAction,
} from "../packages/platform/src/pages/core";

const root = path.resolve(import.meta.dirname, "..");
const registry = JSON.parse(await readFile(path.join(root, "babel.apps.json"), "utf8")) as { apps: { id: string; workspace: string }[] };

for (const target of [...registry.apps, { id: "template", workspace: "templates/mirror-app" }]) {
  test(`${target.id}: closed/rekeyed draft resources are released while new and hidden drafts remain owned`, async context => {
    const workspaceName = target.id === "retex" || target.id === "matter" ? "archive-workspace" : target.id === "neum" ? "entries-workspace" : "notes-workspace";
    const source = await readFile(path.join(root, target.workspace, `src/components/${workspaceName}.tsx`), "utf8");
    const ast = ts.createSourceFile("workspace.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let effect: ts.CallExpression | undefined;
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" && node.arguments[0]?.getText(ast).includes("const closedKeys = [...draftPageKeysRef.current]")) effect = node;
      else ts.forEachChild(node, visit);
    }
    visit(ast);
    assert.ok(effect, "Each notebook must release parent draft references when its page closes or is saved.");
    assert.equal(effect.arguments[1].getText(ast), "[pages]", "Resource cleanup must not run from its own draft state updates.");
    const code = ts.transpileModule(`const effect = ${effect.arguments[0].getText(ast)};`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    }).outputText;
    const draftPageKeysRef = { current: new Set<string>() };
    const tasks: (() => void)[] = [];
    type Resources = { archiveImages: { file: File; previewUrl: string; token: string }[]; originalDocument: { file: File } };
    let drafts: Record<string, Resources> = {};
    let state = createPageSessionsState();
    const revoke = context.mock.method(URL, "revokeObjectURL", () => undefined);
    const resource = (id: string): Resources => ({
      archiveImages: [{ file: new File([`image-${id}`], `${id}.png`), previewUrl: `blob:${id}`, token: id }],
      originalDocument: { file: new File([`archive-${id}`], `${id}.babel.json`) },
    });
    const page = (key: string): PageSessionDescriptor => ({ key, kind: "Note", title: key, href: `/notes?draft=${key}`, dirty: true, restorable: false });
    const render = () => {
      const run = new Function("pages", "draftPageKeysRef", "setDrafts", "queueMicrotask", `${code}\nreturn effect;`)(
        state.pages,
        draftPageKeysRef,
        (update: (current: Record<string, Resources>) => Record<string, Resources>) => { drafts = update(drafts); },
        (task: () => void) => tasks.push(task),
      ) as () => void;
      run();
    };
    const changePages = (action: PageSessionsAction) => { state = pageSessionsReducer(state, action); render(); };
    const flush = () => { while (tasks.length > 0) tasks.shift()!(); };

    render();
    const first = resource("first");
    drafts = { first };
    // A local setDrafts render may precede the provider's batched open update.
    render(); flush();
    assert.equal(drafts.first, first, "A just-prepared draft cannot be pruned before openPage joins the batch.");
    changePages({ type: "open", page: page("first") }); flush();

    const hidden = resource("hidden");
    drafts = { ...drafts, hidden };
    changePages({ type: "open", page: page("hidden") }); flush();
    changePages({ type: "activate", key: "first" }); flush();
    assert.equal(drafts.hidden, hidden, "Switching active pages preserves hidden unsaved images and capture files.");
    changePages({ type: "status", key: "hidden", dirty: true, pending: true }); flush();
    assert.equal(drafts.hidden, hidden, "Pending/dirty status changes cannot prune a hidden draft.");

    changePages({ type: "close", key: "first" }); flush();
    assert.deepEqual(Object.keys(drafts), ["hidden"]);
    assert.equal(drafts.hidden, hidden);
    changePages({ type: "rekey", key: "hidden", page: { key: "saved:7", kind: "Note", title: "Saved", href: "/notes?note=7" } }); flush();
    assert.deepEqual(drafts, {}, "Successful save/rekey releases original archive and image File references.");
    const settled = drafts;
    render(); flush();
    assert.equal(drafts, settled, "An unchanged page set must not trigger a state-update loop.");

    const reopened = resource("reopened");
    drafts = { reopened };
    changePages({ type: "open", page: page("reopened") }); flush();
    changePages({ type: "close", key: "reopened" });
    changePages({ type: "open", page: page("reopened") });
    flush();
    assert.equal(drafts.reopened, reopened, "A stale queued cleanup cannot remove a key that is open again.");
    assert.equal(revoke.mock.callCount(), 0, "Parent cleanup releases references; mounted forms own URL revocation.");
  });
}
