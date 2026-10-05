import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";
import { maskCodeRegions } from "../packages/markdown/src/core";

import type { ImportedOriginalDocument } from "../packages/platform/src/imports/document-core";

const root = path.resolve(import.meta.dirname, "..");
const adapters = [
  ...["bio", "esperanto", "vali", "herodotus", "leviathan", "klsche", "ruider"].map((id) => ({
    id, directory: `apps/${id}`, list: "note-list", workspace: "notes-workspace",
    detail: "note-detail", command: "note", field: "contentMd", entity: "Note",
  })),
  ...["retex", "matter"].map((id) => ({
    id, directory: `apps/${id}`, list: "item-list", workspace: "archive-workspace",
    detail: "knowledge-detail", command: "item", field: "contentMd", entity: "Knowledge",
  })),
  {
    id: "neum", directory: "apps/neum", list: "entry-list", workspace: "entries-workspace",
    detail: "entry-detail", command: "entry", field: "notesMd", entity: "Entry",
  },
  {
    id: "mirror scaffold", directory: "templates/mirror-app", list: "note-list",
    workspace: "notes-workspace", detail: "note-detail", command: "note",
    field: "contentMd", entity: "Note",
  },
];

function findNode<T extends ts.Node>(
  source: ts.SourceFile,
  predicate: (node: ts.Node) => node is T,
): T {
  let found: T | undefined;
  function visit(node: ts.Node) {
    if (found) return;
    if (predicate(node)) found = node;
    else ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(found, "The adapter must retain its import/save integration.");
  return found;
}

function parsed(source: string) {
  return ts.createSourceFile("adapter.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function evaluate<T>(source: string, variables: Record<string, unknown>, name: string): T {
  const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(...Object.keys(variables), `${code}\nreturn ${name};`)(...Object.values(variables)) as T;
}

for (const adapter of adapters) {
  test(`${adapter.id}: conversion enters the existing unsaved import draft with its original file`, async () => {
    const [list, workspace, draftType] = await Promise.all([
      readFile(path.join(root, adapter.directory, "src/components", `${adapter.list}.tsx`), "utf8"),
      readFile(path.join(root, adapter.directory, "src/components", `${adapter.workspace}.tsx`), "utf8"),
      readFile(path.join(root, adapter.directory, "src/lib/markdown-import.ts"), "utf8"),
    ]);
    assert.equal((list.match(/<DocumentImportAction\b/gu) ?? []).length, 1);
    assert.match(list, /onImportChapters=\{onImportFolder\}/u, `${adapter.id} must send book chapters to its atomic folder-import review`);
    assert.ok(list.includes(`id: "${adapter.command}.importDocument"`));
    assert.match(list, /run: \(\) => documentImportOpenRef\.current\?\.\(\)/u);
    assert.match(list, /registerOpen=\{\(open\) => \{ documentImportOpenRef\.current = open; \}\}/u);
    assert.match(list, /onImport=\{onImport\}/u);
    assert.match(list, /original\?: ImportedOriginalDocument/u);
    assert.match(draftType, /originalDocument\?: ImportedOriginalDocument/u);
    if (adapter.command !== "note") {
      assert.match(list, /available: (?:type|kind) === "knowledge" && Boolean\(onImport\) && selectedFolderId !== null/u);
    }

    const source = parsed(workspace);
    const declaration = findNode(source, (node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === "handleImportMarkdown");
    const markdown = "# Converted title\n\nConverted content.\n\n[Original document](babel-original://123)";
    const file = new File([markdown], "converted.md", { type: "text/markdown" });
    const original: ImportedOriginalDocument = {
      file: new File(["source bytes"], "source.docx"),
      token: "123",
    };
    const drafts: Record<string, unknown>[] = [];
    const errors: string[] = [];
    type ImportModule = {
      parseMarkdownImport: (name: string, bytes: Uint8Array) => Record<string, unknown>;
    };
    let imported: ImportModule;
    if (adapter.id === "neum") {
      const limits = await import("../apps/neum/src/lib/entry-limits");
      const code = ts.transpileModule(draftType, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
      }).outputText;
      const exports = {};
      new Function("require", "exports", code)((id: string) => {
        if (id === "@/lib/entry-limits") return limits;
        if (id === "@babel-apps/markdown/core") return { maskCodeRegions };
        throw new Error(`Unexpected import dependency: ${id}`);
      }, exports);
      imported = exports as ImportModule;
    } else {
      imported = await import(pathToFileURL(path.join(root, adapter.directory, "src/lib/markdown-import.ts")).href) as ImportModule;
    }
    const variables = {
      selectedFolderId: 7, type: "knowledge", kind: "knowledge",
      NOTE_CONTENT_MAX_BYTES: 10 * 1024 * 1024, ENTRY_NOTES_MAX_BYTES: 10 * 1024 * 1024,
      parseMarkdownImport: imported.parseMarkdownImport,
      openDraft: (draft: Record<string, unknown>) => drafts.push(draft),
      setError: (error: string) => errors.push(error),
      setNavigationError: (error: string) => errors.push(error),
      getErrorMessage: (error: Error) => error.message,
    };
    type Handler = (file: File, original?: ImportedOriginalDocument) => Promise<void>;
    const handler = evaluate<Handler>(declaration.getText(source), variables, "handleImportMarkdown");
    await handler(file, original);
    assert.deepEqual(errors, []);
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0].folderId, 7);
    const draft = drafts[0].importDraft as Record<string, unknown>;
    assert.equal(draft.contentMd, markdown);
    assert.equal(draft.originalDocument, original);
    assert.equal(draft.title, "converted");

    await handler(file);
    assert.equal((drafts[1].importDraft as Record<string, unknown>).originalDocument, undefined);
    const unavailable = evaluate<Handler>(
      declaration.getText(source), { ...variables, selectedFolderId: null }, "handleImportMarkdown",
    );
    await unavailable(file, original);
    assert.equal(drafts.length, 2, "All-notes collection must not create an import draft.");
    const tooLarge = { size: 10 * 1024 * 1024 + 1 } as File;
    await assert.rejects(handler(tooLarge, original), /10 MB/u);
    assert.equal(drafts.length, 2);
    assert.match(errors[0], /10 MB/u);
    await assert.rejects(
      handler(new File([new Uint8Array([0xff])], "broken.md"), original),
      /valid UTF-8/u,
      "A failed import must reject so the conversion preview remains open.",
    );
    assert.equal(drafts.length, 2);
  });

  test(`${adapter.id}: original document persistence preserves its local save adapter`, async () => {
    const detail = await readFile(
      path.join(root, adapter.directory, "src/components", `${adapter.detail}.tsx`), "utf8",
    );
    const source = parsed(detail);
    const call = findNode(source, (node): node is ts.CallExpression =>
      ts.isCallExpression(node) && node.expression.getText(source) === "saveWithImportedOriginal");
    assert.equal(call.arguments[0].getText(source), `input.${adapter.field}`);
    assert.equal(call.arguments[1].getText(source), "importDraft?.originalDocument");
    const operations: unknown[][] = [];
    const originalInput = { folderId: 7, title: "Imported", [adapter.field]: "pending source" };
    const stagedImages = [{ token: "image-token" }];
    const save = (...args: unknown[]) => {
      operations.push(args);
      return Promise.resolve({ id: 42 });
    };
    type Save = (markdown: string) => Promise<{ id: number }>;
    const variables = {
      detail: null, input: originalInput, stagedImages,
      [`create${adapter.entity}`]: save, [`update${adapter.entity}`]: save,
    };
    const callbackSource = `const callback = ${call.arguments[2].getText(source)};`;
    const create = evaluate<Save>(callbackSource, variables, "callback");
    assert.deepEqual(await create("persisted original URL"), { id: 42 });
    assert.deepEqual(operations.shift(), [
      { ...originalInput, [adapter.field]: "persisted original URL" }, stagedImages,
    ]);
    const update = evaluate<Save>(
      callbackSource, { ...variables, detail: { id: 42, version: 3 } }, "callback",
    );
    await update("persisted original URL");
    const expected = [
      42,
      ...(adapter.entity === "Entry" ? [3] : []),
      { ...originalInput, [adapter.field]: "persisted original URL" },
      stagedImages,
    ];
    assert.deepEqual(operations.shift(), expected);
    assert.equal(originalInput[adapter.field], "pending source", "Failed saves must retain editable draft content.");
    assert.ok(detail.indexOf("if (saveBlockMessage)") < detail.indexOf("const saved = await saveWithImportedOriginal("));
  });
}
