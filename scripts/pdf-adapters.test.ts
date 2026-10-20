import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const registry = JSON.parse(await readFile(path.join(root, "babel.apps.json"), "utf8")) as {
  apps: Array<{ id: string; workspace: string; env: Record<string, string> }>;
};
const targets = [...registry.apps, { id: "__APP_ID__", workspace: "templates/mirror-app", env: { __APP_ENV_PREFIX___UPLOAD_DIRECTORY: "" } }];

for (const target of targets) test(`${target.workspace}: PDF reader, private storage and note adapters are connected`, async () => {
  const read = (filename: string) => readFile(path.join(root, target.workspace, filename), "utf8");
  const [manifestText, layout, header, configuration, server, reader] = await Promise.all([
    read("package.json"), read("src/app/layout.tsx"), read("src/components/app-header.tsx"),
    read("next.config.ts"), read("src/lib/pdf.server.ts"), read("src/app/pdf-reader/page.tsx"),
  ]);
  const manifest = JSON.parse(manifestText) as { dependencies: Record<string, string>; scripts: Record<string, string> };
  assert.equal(manifest.dependencies["@babel-apps/pdf"], "0.1.0");
  for (const hook of ["predev", "prebuild", "prestart"]) assert.match(manifest.scripts[hook], /npm run pdf:assets/);
  assert.match(configuration, /["']@babel-apps\/pdf["']/);
  assert.match(layout, /@babel-apps\/pdf\/pdf.css/);
  assert.match(layout, /<PdfRouteBoundary reader=\{children\}>/);
  const knowledge = ["neum", "retex", "matter"].includes(target.id);
  assert.ok(header.includes(`appId="${target.id}"`));
  assert.ok(header.includes(`notebookHref="/${knowledge ? "knowledge" : "notes"}"`));
  assert.match(reader, /<PdfReader/);
  assert.ok(reader.includes(`appId="${target.id}"`));
  assert.match(reader, /ownerId=/);
  assert.match(server, /createPdfLibraryHandlers/);
  assert.match(server, /"pdf-library"/);
  for (const name of Object.keys(target.env).filter(name => name.endsWith("_UPLOAD_DIRECTORY"))) assert.ok(server.includes(`process.env.${name}`));
  assert.doesNotMatch(server, /lib\/db|db\/client/);
  const routes = [
    ["", ["GET", "POST"], ["list", "importPdf"]],
    ["/[id]", ["GET", "DELETE"], ["getDocument", "deleteDocument"]],
    ["/[id]/file", ["GET", "HEAD"], ["file"]],
    ["/[id]/progress", ["PATCH"], ["patchProgress"]],
    ["/[id]/annotations", ["PATCH"], ["patchAnnotations"]],
  ] as const;
  for (const [suffix, methods, handlers] of routes) {
    const source = await read(`src/app/api/pdf/documents${suffix}/route.ts`);
    assert.match(source, /handleApi/);
    for (const method of methods) assert.match(source, new RegExp(`export (?:(?:async )?function|const) ${method}`));
    for (const handler of handlers) assert.ok(source.includes(`pdfLibraryHandlers.${handler}`));
  }
  const workspace = target.id === "neum" ? "entries-workspace" : knowledge ? "archive-workspace" : "notes-workspace";
  const detail = target.id === "neum" ? "entry-detail" : knowledge ? "knowledge-detail" : "note-detail";
  const [creation, editor] = await Promise.all([read(`src/components/${workspace}.tsx`), read(`src/components/${detail}.tsx`)]);
  assert.match(creation, /usePdfExcerptCreation\(/);
  assert.match(creation, /isReady:.*!indexLoading/);
  if (/const processActive =/.test(creation)) assert.match(creation, /isReady:.*processActive/);
  assert.match(editor, /usePdfExcerptEditor\(/);
  assert.match(editor, /preparePdfExcerpt/);
  assert.match(editor, /pendingRef\.current/);
  assert.match(editor, /getClientRects\(\)|getBoundingClientRect\(\)/);
});
