import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { HTML_FRAME_SANDBOX, HTML_READER_CONTENT_SECURITY_POLICY } from "../packages/html/src/sandbox";

const root = path.resolve(import.meta.dirname, "..");
const registry = JSON.parse(await readFile(path.join(root, "babel.apps.json"), "utf8")) as {
  apps: Array<{ id: string; name: string; workspace: string; env: Record<string, string> }>;
};
const targets = [...registry.apps, { id: "__APP_ID__", name: "__APP_NAME__", workspace: "templates/mirror-app", env: { __APP_ENV_PREFIX___UPLOAD_DIRECTORY: "" } }];

function property(object: ts.ObjectLiteralExpression, key: string): ts.Expression | undefined {
  for (const member of object.properties) {
    if (!ts.isPropertyAssignment(member)) continue;
    const name = ts.isIdentifier(member.name) || ts.isStringLiteral(member.name) ? member.name.text : "";
    if (name === key) return member.initializer;
  }
  return undefined;
}

function literal(value: ts.Expression | undefined): string | undefined {
  return value && (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) ? value.text : undefined;
}

/** Inspect the header for this route, rather than matching an unrelated CSP string. */
function readerHeaders(configuration: string): Map<string, string> {
  const source = ts.createSourceFile("next.config.ts", configuration, ts.ScriptTarget.Latest, true);
  const entries: ts.ObjectLiteralExpression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isObjectLiteralExpression(node) && literal(property(node, "source")) === "/html-reader") entries.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(entries.length, 1, "The detached HTML reader must have one explicit response-header policy.");
  const headers = property(entries[0], "headers");
  assert.ok(headers && ts.isArrayLiteralExpression(headers));
  const result = new Map<string, string>();
  for (const item of headers.elements) {
    assert.ok(ts.isObjectLiteralExpression(item));
    const key = literal(property(item, "key")); const value = literal(property(item, "value"));
    assert.ok(key && value); assert.equal(result.has(key.toLowerCase()), false, `Duplicate ${key} header`);
    result.set(key.toLowerCase(), value);
  }
  return result;
}

for (const target of targets) test(`${target.workspace}: HTML library, offline reader and app-owned storage are connected`, async () => {
  const read = (filename: string) => readFile(path.join(root, target.workspace, filename), "utf8");
  const [manifestText, layout, header, configuration, server, reader] = await Promise.all([
    read("package.json"), read("src/app/layout.tsx"), read("src/components/app-header.tsx"), read("next.config.ts"),
    read("src/lib/html.server.ts"), read("src/app/html-reader/page.tsx"),
  ]);
  const manifest = JSON.parse(manifestText) as { dependencies: Record<string, string> };
  assert.equal(manifest.dependencies["@babel-apps/html"], "0.1.0");
  assert.match(configuration, /["']@babel-apps\/html["']/u);
  assert.match(layout, /@babel-apps\/html\/html.css/u);
  assert.match(layout, /@babel-apps\/pdf\/pdf.css/u);
  assert.match(layout, /<HtmlRouteBoundary reader=\{children\}>/u);
  assert.ok(layout.indexOf("<HtmlRouteBoundary") < layout.indexOf("<PageSessionProvider"), "The detached reader must bypass notebook page sessions.");
  const notebookHref = ["neum", "retex", "matter"].includes(target.id) ? "/knowledge" : "/notes";
  assert.ok(header.includes(`<HtmlLibraryButton appId="${target.id}" appName="${target.name}" notebookHref="${notebookHref}"`));
  assert.match(reader, /<HtmlReader/u);
  assert.ok(reader.includes(`appId="${target.id}"`)); assert.ok(reader.includes(`appName="${target.name}"`));
  assert.match(reader, /documentId=/u); assert.match(reader, /ownerId=/u); assert.match(reader, /anchor=/u);
  assert.match(server, /@babel-apps\/platform\/html\/server/u); assert.match(server, /createHtmlLibraryHandlers/u);
  assert.match(server, /"html-library"/u); assert.ok(server.includes(`"data", "${target.id}"`));
  for (const name of Object.keys(target.env).filter((name) => name.endsWith("_UPLOAD_DIRECTORY"))) assert.ok(server.includes(`process.env.${name}`));
  assert.doesNotMatch(server, /lib\/db|db\/client|pdf-library/u);
  const headers = readerHeaders(configuration);
  assert.equal(headers.get("content-security-policy"), HTML_READER_CONTENT_SECURITY_POLICY);
  assert.equal(headers.get("referrer-policy"), "no-referrer");

  const routes = [
    ["bundles", ["POST"], ["importBundle"]],
    ["bundles/[id]", ["GET", "DELETE"], ["getBundle", "deleteBundle"]],
    ["documents", ["GET", "POST"], ["list", "importDocument"]],
    ["documents/[id]", ["GET", "PATCH", "DELETE"], ["getDocument", "moveDocument", "deleteDocument"]],
    ["documents/[id]/assets/[...path]", ["GET", "HEAD"], ["asset"]],
    ["documents/[id]/progress", ["PATCH"], ["patchProgress"]],
    ["documents/[id]/annotations", ["PATCH"], ["patchAnnotations"]],
    ["folders", ["POST"], ["createFolder"]],
    ["folders/[id]", ["PATCH", "DELETE"], ["patchFolder", "deleteFolder"]],
  ] as const;
  for (const [suffix, methods, handlers] of routes) {
    const source = await read(`src/app/api/html/${suffix}/route.ts`);
    assert.match(source, /handleApi/u); assert.match(source, /export const runtime = "nodejs"/u); assert.match(source, /export const dynamic = "force-dynamic"/u);
    for (const method of methods) assert.match(source, new RegExp(`export (?:(?:async )?function|const) ${method}\\b`, "u"));
    for (const handler of handlers) assert.ok(source.includes(`htmlLibraryHandlers.${handler}`));
    assert.doesNotMatch(source, /node:fs|lib\/db|readFile|createReadStream/u, "Adapters must retain the shared ownership and response-header checks.");
    if (suffix.endsWith("[...path]")) assert.match(source, /htmlLibraryHandlers\.asset\(request, id, path\)/u);
  }
  const workspace = target.id === "neum" ? "entries-workspace" : notebookHref === "/knowledge" ? "archive-workspace" : "notes-workspace";
  const detail = target.id === "neum" ? "entry-detail" : notebookHref === "/knowledge" ? "knowledge-detail" : "note-detail";
  const [creation, editor] = await Promise.all([read(`src/components/${workspace}.tsx`), read(`src/components/${detail}.tsx`)]);
  assert.match(creation, /pdfExcerptNoteTitle\(excerpt/u);
  assert.match(creation, /excerpt\.sourceType === "html" \? "HTML Notes" : "PDF Notes"/u);
  assert.match(editor, /usePdfExcerptEditor\(/u);
  assert.match(editor, /preparePdfExcerpt/u);
  assert.doesNotMatch(editor, /"PDF excerpt"/u);
});

test("the shared HTML reader uses an opaque script sandbox and the originating notebook excerpt connection", async () => {
  const [boundary, reader, launcher] = await Promise.all([
    readFile(path.join(root, "packages/html/src/react.tsx"), "utf8"), readFile(path.join(root, "packages/html/src/reader.tsx"), "utf8"),
    readFile(path.join(root, "launcher/Babel.ps1"), "utf8"),
  ]);
  assert.equal(HTML_FRAME_SANDBOX, "allow-scripts");
  assert.match(boundary, /usePathname\(\) === "\/html-reader" \? reader : children/u);
  assert.match(reader, /sandbox=\{HTML_FRAME_SANDBOX\}/u);
  assert.match(reader, /referrerPolicy="no-referrer"/u);
  assert.doesNotMatch(reader, /allow-same-origin/u);
  assert.match(reader, /usePdfNotebookConnection\(ownerId, "HTML"\)/u);
  assert.match(reader, /sourceType: "html"/u);
  assert.match(reader, /location: selection\.section/u);
  assert.ok(launcher.includes('(Join-Path $RootPath "packages\\html")'), "HTML updates must invalidate launcher builds.");
});
