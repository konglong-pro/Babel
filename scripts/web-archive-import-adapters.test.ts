import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

import { maskCodeRegions } from "../packages/markdown/src/core";
import { prepareWebArchiveImport, webArchiveDraftImages, type WebArchiveDraftImage } from "../packages/platform/src/imports/web-archive-client";
import type { ImportedOriginalDocument } from "../packages/platform/src/imports/document-core";
import type { WebArchive } from "../packages/platform/src/imports/web-archive-core";

const root = path.resolve(import.meta.dirname, "..");
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jwX8AAAAASUVORK5CYII=";
const archive: WebArchive = {
  format: "babel.web-archive", version: 1, title: "Synthetic rich lesson",
  markdown: "## Assistant\n\n![Photo](assets/photo.png)\n\nPhoto caption.\n\n![Wave](assets/wave.png)\n\nWave caption.\n\n$\\lambda$\n\n|Type|Size|\n|---|---|\n|Solution|1 nm|\n\n```js\n1 + 1\n```",
  assets: ["photo", "wave"].map(id => ({ id, name: `${id}.png`, mimeType: "image/png" as const, dataBase64: png })),
  snapshot: { tree: { tag: "article", children: ["Synthetic rich lesson"] }, width: 640, background: "#ffffff" },
  warnings: [],
};

function parsed(source: string) {
  return ts.createSourceFile("adapter.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
function find(source: ts.SourceFile, predicate: (node: ts.Node) => boolean): ts.Node {
  let found: ts.Node | undefined;
  function visit(node: ts.Node) {
    if (!found && predicate(node)) found = node;
    else if (!found) ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(found, "The notebook must retain its real import/edit lifecycle.");
  return found;
}
function evaluate<T>(source: string, variables: Record<string, unknown>, name: string): T {
  const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(...Object.keys(variables), `${code}\nreturn ${name};`)(...Object.values(variables)) as T;
}

test("rich archives use every registered notebook's unsaved draft and managed-image Save lifecycle", async context => {
  const registry = JSON.parse(await readFile(path.join(root, "babel.apps.json"), "utf8")) as { apps: { id: string; workspace: string }[] };
  let allocated = 0;
  const revoked: string[] = [];
  context.mock.method(URL, "createObjectURL", () => `blob:archive-test-${++allocated}`);
  context.mock.method(URL, "revokeObjectURL", (url: string) => { revoked.push(url); });
  const fetch = context.mock.method(globalThis, "fetch", async () => { throw new Error("Draft creation must not persist anything"); });

  for (const target of [...registry.apps, { id: "template", workspace: "templates/mirror-app" }]) {
    const knowledge = target.id === "retex" || target.id === "matter";
    const neum = target.id === "neum";
    const directory = path.join(root, target.workspace);
    const [list, workspace, parserSource, detail, limits] = await Promise.all([
      readFile(path.join(directory, `src/components/${knowledge ? "item" : neum ? "entry" : "note"}-list.tsx`), "utf8"),
      readFile(path.join(directory, `src/components/${knowledge ? "archive" : neum ? "entries" : "notes"}-workspace.tsx`), "utf8"),
      readFile(path.join(directory, "src/lib/markdown-import.ts"), "utf8"),
      readFile(path.join(directory, `src/components/${knowledge ? "knowledge" : neum ? "entry" : "note"}-detail.tsx`), "utf8"),
      import(pathToFileURL(path.join(directory, `src/lib/${neum ? "entry" : "note"}-limits.ts`)).href),
    ]);
    assert.equal((list.match(/<WebArchiveImportAction\b/gu) ?? []).length, 1, target.id);
    assert.match(list, /<WebArchiveImportAction\s+onImport=\{onImport\}\s+disabled=\{selectedFolderId === null \|\| referencePanelOpen\}/u);
    const actionSource = /\{\s+id: "(?:note|item|entry)\.importWebArchive",[\s\S]*?\n    \}/u.exec(list)?.[0];
    assert.ok(actionSource, target.id);
    const actionFor = (folder: number | null, reference: boolean, mode = "knowledge") => evaluate<{ available: boolean }>(`const action = ${actionSource};`, {
      selectedFolderId: folder, referencePanelOpen: reference, type: mode, kind: mode, onImport: () => undefined,
      webArchiveImportOpenRef: { current: null },
    }, "action");
    assert.equal(actionFor(7, false).available, true, target.id);
    assert.equal(actionFor(null, false).available, false, target.id);
    assert.equal(actionFor(7, true).available, false, `${target.id}: reference panel gate`);
    if (knowledge || neum) assert.equal(actionFor(7, false, "snippet").available, false, target.id);

    type Draft = { imageReferences: { token: string; path: string }[]; archiveImages?: WebArchiveDraftImage[]; originalDocument?: ImportedOriginalDocument; contentMd: string };
    const parser = {} as { parseMarkdownImport: (name: string, bytes: Uint8Array) => Draft };
    new Function("require", "exports", ts.transpileModule(parserSource, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText)((id: string) => {
      if (id.endsWith("note-limits") || id.endsWith("entry-limits")) return limits;
      if (id === "@babel-apps/markdown/core") return { maskCodeRegions };
      throw new Error(`Unexpected dependency ${id}`);
    }, parser);
    const workspaceAst = parsed(workspace);
    const handlerSource = find(workspaceAst, node => ts.isFunctionDeclaration(node) && node.name?.text === "handleImportMarkdown").getText(workspaceAst);
    const drafts: { folderId: number; importDraft: Draft }[] = [];
    const variables = {
      selectedFolderId: 7, type: "knowledge", kind: "knowledge",
      ...limits,
      parseMarkdownImport: parser.parseMarkdownImport, webArchiveDraftImages,
      openDraft: (draft: { folderId: number; importDraft: Draft }) => drafts.push(draft),
      setError: () => undefined, setNavigationError: () => undefined,
      getErrorMessage: (error: Error) => error.message,
    };
    type Handler = (file: File, original?: ImportedOriginalDocument) => Promise<void>;
    const handler = evaluate<Handler>(handlerSource, variables, "handleImportMarkdown");
    const limitsPrefix = neum ? "ENTRY" : "NOTE";
    assert.equal(limits[`${limitsPrefix}_NEW_IMAGE_MAX_COUNT`], 50, target.id);
    assert.equal(limits[`${limitsPrefix}_IMAGE_MAX_BYTES`], 10 * 1024 * 1024, target.id);
    assert.equal(limits[`${limitsPrefix}_SAVE_MAX_BYTES`], 100 * 1024 * 1024, target.id);
    const prepared = prepareWebArchiveImport(archive);
    await handler(prepared.file, prepared.original);
    assert.equal(drafts.length, 1, target.id);
    assert.equal(drafts[0].folderId, 7, target.id);
    const draft = drafts[0].importDraft;
    assert.equal(draft.originalDocument, prepared.original, target.id);
    assert.equal(draft.archiveImages?.length, 2, target.id);
    assert.deepEqual(draft.archiveImages!.map(image => image.token), draft.imageReferences.map(reference => reference.token));
    assert.ok(draft.contentMd.includes(`babel-original://${prepared.original.token}`), target.id);
    for (const image of draft.archiveImages!) {
      assert.ok(draft.contentMd.includes(`://${image.token}`), target.id);
      assert.equal(Buffer.from(await image.file.arrayBuffer()).toString("base64"), png, target.id);
    }

    const detailAst = parsed(detail);
    const initializer = find(detailAst, node => ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && node.name.elements[0]?.getText(detailAst) === "stagedImages") as ts.VariableDeclaration;
    const stateCall = initializer.initializer as ts.CallExpression;
    const pdfImage = { token: "pdf-existing", file: new File(["pdf"], "pdf.png"), previewUrl: "blob:pdf-existing" };
    const initialize = evaluate<() => WebArchiveDraftImage[]>(`const initialize = ${stateCall.arguments[0].getText(detailAst)};`, { importDraft: { ...draft, pdfImage } }, "initialize");
    const staged = initialize();
    assert.deepEqual(staged, [...draft.archiveImages!, pdfImage], `${target.id}: archived photos coexist with PDF excerpt images`);
    const effect = find(detailAst, node => ts.isCallExpression(node) && node.expression.getText(detailAst) === "useEffect" && node.arguments[0]?.getText(detailAst).includes("for (const image of stagedRef.current) URL.revokeObjectURL(image.previewUrl)") === true) as ts.CallExpression;
    const cleanupEffect = evaluate<() => () => void>(`const effect = ${effect.arguments[0].getText(detailAst)};`, { stagedRef: { current: staged }, onDirtyChange: () => undefined }, "effect");
    const previousRevoked = revoked.length;
    cleanupEffect()();
    assert.deepEqual(revoked.slice(previousRevoked), staged.map(image => image.previewUrl), `${target.id}: closing an unsaved draft releases all previews`);

    const failing = evaluate<Handler>(handlerSource, { ...variables, openDraft: () => { throw new Error("Draft window unavailable"); } }, "handleImportMarkdown");
    const beforeFailure = revoked.length;
    await assert.rejects(failing(prepared.file, prepared.original), /Draft window unavailable/u);
    assert.equal(revoked.length - beforeFailure, 2, `${target.id}: failed opening releases previews and can be retried`);
    await assert.rejects(evaluate<Handler>(handlerSource, { ...variables, selectedFolderId: null }, "handleImportMarkdown")(prepared.file, prepared.original), /Select a (?:knowledge )?folder/u);

    const [post, get] = await Promise.all([
      readFile(path.join(directory, "src/app/api/imports/web-archive/snapshots/route.ts"), "utf8"),
      readFile(path.join(directory, "src/app/api/imports/web-archive/snapshots/[id]/route.ts"), "utf8"),
    ]);
    assert.match(post, /handleApi\(\(\) => documentImportHandlers\.saveWebArchive\(request\)\)/u, target.id);
    assert.match(get, /documentImportHandlers\.readWebArchive\(\(await context.params\)\.id\)/u, target.id);
  }
  assert.equal(fetch.mock.callCount(), 0);
});
