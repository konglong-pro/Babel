import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

import { prepareWebArchiveImport, readWebArchiveFile } from "../packages/platform/src/imports/web-archive-client";
import type { ImportedOriginalDocument } from "../packages/platform/src/imports/document-core";
import type { WebArchive } from "../packages/platform/src/imports/web-archive-core";

const archive: WebArchive = {
  format: "babel.web-archive", version: 1, title: "Synthetic capture", markdown: "Original captured Markdown.",
  assets: [], snapshot: { tree: { tag: "p", children: ["Original capture"] }, width: 640, background: "#ffffff" }, warnings: [],
};
const source = await readFile(new URL("../packages/platform/src/imports/web-archive-react.tsx", import.meta.url), "utf8");
const parsed = ts.createSourceFile("dialog.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function callback<T>(name: string, variables: Record<string, unknown>): T {
  let declaration: ts.FunctionDeclaration | undefined;
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node;
    else ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.ok(declaration);
  const code = ts.transpileModule(declaration.getText(parsed), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(...Object.keys(variables), `${code}\nreturn ${name};`)(...Object.values(variables)) as T;
}

function variables(overrides: Record<string, unknown> = {}) {
  return {
    archive, title: "Reviewed title", markdown: "Reviewed Markdown.", active: true, disabled: false,
    busyRef: { current: false }, prepareWebArchiveImport,
    setError: (_error: string) => undefined, setPending: (_pending: boolean) => undefined,
    onImport: async (_file: File, _original: ImportedOriginalDocument) => undefined,
    onClose: () => undefined,
    ...overrides,
  };
}

test("archive dialog synchronously locks double submission and cancellation while the draft opens", async () => {
  let finish: () => void = () => undefined;
  const wait = new Promise<void>(resolve => { finish = resolve; });
  const opened: File[] = [];
  let closed = 0;
  const values = variables({
    onImport: async (file: File) => { opened.push(file); await wait; },
    onClose: () => { closed++; },
  });
  const open = callback<() => Promise<void>>("openDraft", values);
  const cancel = callback<() => void>("cancel", values);
  const first = open();
  await open();
  cancel();
  assert.equal(opened.length, 1);
  assert.equal(closed, 0);
  assert.equal(await opened[0].text(), `Reviewed Markdown.\n\n[View original layout](babel-original://${/babel-original:\/\/([a-f0-9-]+)/u.exec(await opened[0].text())![1]})\n`);
  finish();
  await first;
  assert.equal(closed, 1);
});

test("failed opening unlocks retry, retaining the reviewed capture and editable Markdown", async () => {
  let attempts = 0;
  let closed = 0;
  const errors: string[] = [];
  const pending: boolean[] = [];
  const values = variables({
    setError: (error: string) => errors.push(error), setPending: (value: boolean) => pending.push(value),
    onImport: async (file: File, original: ImportedOriginalDocument) => {
      attempts++;
      assert.match(await file.text(), /^Reviewed Markdown\./u);
      assert.deepEqual(JSON.parse(await original.file.text()), archive);
      if (attempts === 1) throw new Error("Draft window unavailable");
    },
    onClose: () => { closed++; },
  });
  const open = callback<() => Promise<void>>("openDraft", values);
  await open();
  assert.equal(values.busyRef.current, false);
  assert.equal(closed, 0);
  assert.equal(errors.at(-1), "Draft window unavailable");
  assert.equal(pending.at(-1), false);
  await open();
  assert.equal(attempts, 2);
  assert.equal(closed, 1);
});

test("inactive workspaces and disabled context cannot open an archive draft", async () => {
  for (const gate of [{ active: false }, { disabled: true }]) {
    let imports = 0;
    await callback<() => Promise<void>>("openDraft", variables({ ...gate, onImport: () => { imports++; } }))();
    assert.equal(imports, 0);
  }
});

test("bad replacement files keep the previous capture and release the synchronous read lock", async () => {
  const errors: string[] = [];
  const changes: unknown[] = [];
  const busyRef = { current: false };
  const choose = callback<(file: File) => Promise<void>>("chooseFile", {
    busyRef, readWebArchiveFile,
    setReading: () => undefined, setError: (error: string) => errors.push(error),
    setArchive: (value: unknown) => changes.push(value), setTitle: (value: unknown) => changes.push(value),
    setMarkdown: (value: unknown) => changes.push(value), setPreview: (value: unknown) => changes.push(value),
  });
  await choose(new File(["{}"], "bad.babel.json"));
  assert.equal(busyRef.current, false);
  assert.deepEqual(changes, []);
  assert.ok(errors.at(-1));
});

test("preview renderer errors stay inside the review dialog and do not replace its capture", () => {
  const errors: string[] = [];
  const previews: string[] = [];
  callback<() => void>("togglePreview", {
    archive, preview: "", setError: (error: string) => errors.push(error),
    setPreview: (value: string) => previews.push(value),
    renderWebArchiveSnapshot: () => { throw new Error("Preview unavailable"); },
  })();
  assert.equal(errors.at(-1), "Preview unavailable");
  assert.deepEqual(previews, []);
  assert.match(source, /<iframe[^>]*sandbox=""[^>]*referrerPolicy="no-referrer"/u);
  assert.match(source, /type="file" hidden aria-label="David archive \(\.babel\.json\)"/u);
  assert.match(source, />Choose archive<\/button>/u);
});
