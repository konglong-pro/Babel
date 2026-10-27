import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { createHtmlLibraryHandlers } from "../src/html/server";
import {
  HTML_FOLDER_MAX_DEPTH, HTML_MAX_BUNDLE_BYTES, isHtmlAnnotation, isHtmlAnnotations, isHtmlProgress, normalizeHtmlAssetPath,
  type HtmlAnnotation, type HtmlBundle, type HtmlDocument, type HtmlDocumentSummary, type HtmlFolder,
} from "../src/html/core";

const html = "<!doctype html><h1>Carbon</h1><p>Keep this selection.</p><script src=\"assets/app.js\"></script>";
const assetFiles = [{ path: "Books/index.html", content: html }, { path: "Books/chapter.htm", content: "<h1>Chapter</h1>" },
  { path: "Books/assets/app.js", content: "document.body.dataset.interactive = 'yes';" }, { path: "Books/assets/style.css", content: "body { color: green; }" },
  { path: "Books/assets/picture.svg", content: "<svg xmlns='http://www.w3.org/2000/svg'><script>parent.attack()</script></svg>" }];
const origin = "http://localhost:3000";
function mutation(body: unknown, method = "POST", headers: Record<string, string> = {}) {
  return new Request(`${origin}/api/html/documents`, { method, body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
}
function deletion() { return new Request(`${origin}/api/html/documents/id`, { method: "DELETE" }); }
function upload(files = assetFiles, id = randomUUID(), extraHeaders: Record<string, string> = {}) {
  const body = new FormData();
  body.set("manifest", JSON.stringify({ files: files.map((file, index) => ({ path: file.path, field: `file-${index}` })) }));
  for (const [index, file] of files.entries()) body.set(`file-${index}`, new Blob([file.content]), file.path.split("/").at(-1)!);
  return new Request(`${origin}/api/html/bundles`, { method: "POST", body, headers: { "X-Babel-Html-Import-Id": id, ...extraHeaders } });
}
function importDocument(bundle: HtmlBundle, entryPath = "Books/index.html", folderId: string | null = null, id = randomUUID()) {
  return mutation({ bundleId: bundle.id, entryPath, title: entryPath.split("/").at(-1)!.replace(/\.html?$/iu, ""), folderId }, "POST", { "X-Babel-Html-Import-Id": id });
}
async function bundle(response: Response): Promise<HtmlBundle> { return (await response.json() as { bundle: HtmlBundle }).bundle; }
async function document(response: Response): Promise<HtmlDocument> { return (await response.json() as { document: HtmlDocument }).document; }
async function folder(response: Response): Promise<HtmlFolder> { return (await response.json() as { folder: HtmlFolder }).folder; }
async function library(response: Response): Promise<{ documents: HtmlDocumentSummary[]; folders: HtmlFolder[] }> { return await response.json() as { documents: HtmlDocumentSummary[]; folders: HtmlFolder[] }; }
async function fixture(t: { after: (fn: () => Promise<unknown>) => void }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "babel-html-")); t.after(() => rm(root, { recursive: true, force: true }));
  return { root, handlers: createHtmlLibraryHandlers({ root: () => root }) };
}
const annotation: HtmlAnnotation = { id: "first-highlight", type: "highlight", text: "Keep this selection.", prefix: "Carbon", suffix: "", occurrence: 0,
  comment: "A useful note", color: "#ffee66", createdAt: "2026-10-27T00:00:00.000Z" };

test("HTML core validates reflow-safe text anchors, progress and logical resource paths", () => {
  assert.ok(isHtmlProgress({ position: 0.42, scale: 1.25 }));
  for (const value of [{ position: -1, scale: 1 }, { position: 2, scale: 1 }, { position: 0, scale: NaN }, { position: 0, scale: 1, unknown: true }]) assert.equal(isHtmlProgress(value), false);
  assert.ok(isHtmlAnnotation(annotation)); assert.ok(isHtmlAnnotations([annotation]));
  assert.equal(isHtmlAnnotations([annotation, annotation]), false);
  for (const changes of [{ occurrence: -1 }, { text: "" }, { prefix: "x".repeat(257) }, { type: "script" }, { unknown: true }]) assert.equal(isHtmlAnnotation({ ...annotation, ...changes }), false);
  assert.equal(normalizeHtmlAssetPath("Books/Cafe\u0301/index.html"), "Books/Café/index.html");
  for (const filename of ["", "/index.html", "../index.html", "Books/../index.html", "Books//index.html", "C:/secret.html", "Books\\index.html", "a\u0000b.html"]) assert.equal(normalizeHtmlAssetPath(filename), null);
});

test("HTML imports keep a shared immutable resource bundle and protect every raw asset response", async (t) => {
  const { root, handlers } = await fixture(t);
  assert.deepEqual(await library(await handlers.list()), { documents: [], folders: [] });
  const response = await handlers.importBundle(upload()); assert.equal(response.status, 201);
  const resources = await bundle(response);
  assert.equal(resources.files.length, assetFiles.length);
  assert.equal(resources.size, assetFiles.reduce((size, file) => size + Buffer.byteLength(file.content), 0));
  const book = await document(await handlers.importDocument(importDocument(resources)));
  assert.equal(book.bundle.id, resources.id); assert.equal(book.folderId, null); assert.equal(book.entryPath, "Books/index.html");
  assert.deepEqual(book.progress, { position: 0, scale: 1 }); assert.deepEqual(book.annotations, []);
  const main = await handlers.asset(new Request(`${origin}/asset`), book.id, ["Books", "index.html"]);
  assert.equal(main.headers.get("content-type"), "text/plain"); assert.match(main.headers.get("content-disposition")!, /^attachment;/u);
  assert.equal(main.headers.get("access-control-allow-origin"), "*"); assert.equal(main.headers.get("cross-origin-resource-policy"), "cross-origin");
  assert.equal(main.headers.get("x-content-type-options"), "nosniff"); assert.match(main.headers.get("content-security-policy")!, /default-src 'none'; sandbox/u);
  assert.equal(await main.text(), html);
  const script = await handlers.asset(new Request(`${origin}/asset`), book.id, "Books/assets/app.js");
  assert.match(script.headers.get("content-type")!, /^text\/javascript/u); assert.match(script.headers.get("content-disposition")!, /^inline;/u);
  assert.equal(await script.text(), assetFiles[2].content);
  const svg = await handlers.asset(new Request(`${origin}/asset`), book.id, "Books/assets/picture.svg");
  assert.match(svg.headers.get("content-disposition")!, /^attachment;/u); assert.match(svg.headers.get("content-security-policy")!, /sandbox/u); await svg.arrayBuffer();
  assert.deepEqual(await readFile(path.join(root, "bundles", resources.id, "0"), "utf8"), html);
  assert.deepEqual((await library(await handlers.list())).documents.map((entry) => entry.id), [book.id]);
});

test("HTML assets support HEAD and ranges while refusing nonmembers and invalid paths", async (t) => {
  const { handlers } = await fixture(t); const resources = await bundle(await handlers.importBundle(upload()));
  const book = await document(await handlers.importDocument(importDocument(resources)));
  const head = await handlers.asset(new Request(`${origin}/asset`, { method: "HEAD" }), book.id, "Books/index.html");
  assert.equal(head.status, 200); assert.equal(head.headers.get("content-length"), String(Buffer.byteLength(html))); assert.equal(await head.text(), "");
  const ranged = await handlers.asset(new Request(`${origin}/asset`, { headers: { range: "bytes=0-8" } }), book.id, "Books/index.html");
  assert.equal(ranged.status, 206); assert.equal(await ranged.text(), html.slice(0, 9));
  const suffix = await handlers.asset(new Request(`${origin}/asset`, { headers: { range: "bytes=-4" } }), book.id, "Books/index.html");
  assert.equal(await suffix.text(), html.slice(-4));
  for (const range of ["bytes=-0", "bytes=9999999-", "bytes=2-1", "bytes=0-1,3-4"]) assert.equal((await handlers.asset(new Request(`${origin}/asset`, { headers: { range } }), book.id, "Books/index.html")).status, 416);
  for (const name of ["../metadata.sqlite", "Books/no-file.js", "Books/../index.html", "bundles/0", "Books\\index.html"])
    await assert.rejects(handlers.asset(new Request(`${origin}/asset`), book.id, name), { code: "HTML_NOT_FOUND" });
});

test("stable HTML bundle identities replay identical uploads without overwriting different content", async (t) => {
  const { root, handlers } = await fixture(t); const id = randomUUID();
  const first = await bundle(await handlers.importBundle(upload(assetFiles, id)));
  const repeated = await handlers.importBundle(upload([...assetFiles].reverse(), id)); assert.equal(repeated.status, 200);
  assert.deepEqual(await bundle(repeated), first);
  await assert.rejects(handlers.importBundle(upload([{ ...assetFiles[0], content: "Different" }], id)), { code: "HTML_IMPORT_ID_CONFLICT" });
  assert.deepEqual(await readdir(path.join(root, "bundles")), [id]);
  await writeFile(path.join(root, "bundles", id, "0"), "x".repeat(Buffer.byteLength(html)));
  await assert.rejects(handlers.importBundle(upload(assetFiles, id)), { code: "HTML_FILE_CHANGED" });
});

test("HTML document retries preserve relocated membership, reading state and annotation revisions", async (t) => {
  const { handlers } = await fixture(t);
  const source = await folder(await handlers.createFolder(mutation({ name: "Chemistry" })));
  const target = await folder(await handlers.createFolder(mutation({ name: "Reactions" })));
  const resources = await bundle(await handlers.importBundle(upload())); const id = randomUUID();
  const imported = await document(await handlers.importDocument(importDocument(resources, "Books/index.html", source.id, id)));
  const progress = await document(await handlers.patchProgress(mutation({ revision: 0, progress: { position: 0.5, scale: 1.25 } }, "PATCH"), id));
  const annotated = await document(await handlers.patchAnnotations(mutation({ revision: 0, annotations: [annotation] }, "PATCH"), id));
  const moved = await document(await handlers.moveDocument(mutation({ folderId: target.id }, "PATCH"), id));
  assert.deepEqual(moved.progress, progress.progress); assert.equal(moved.progressRevision, 1); assert.equal(moved.annotationsRevision, annotated.annotationsRevision); assert.deepEqual(moved.annotations, [annotation]);
  await handlers.deleteFolder(deletion(), source.id);
  const replay = await handlers.importDocument(importDocument(resources, "Books/index.html", source.id, id)); assert.equal(replay.status, 200); assert.deepEqual(await document(replay), moved);
  await assert.rejects(handlers.patchProgress(mutation({ revision: 0, progress: { position: 1, scale: 1 } }, "PATCH"), id), { code: "HTML_REVISION_CONFLICT" });
  await assert.rejects(handlers.patchAnnotations(mutation({ revision: 0, annotations: [] }, "PATCH"), id), { code: "HTML_REVISION_CONFLICT" });
  await assert.rejects(handlers.importDocument(importDocument(resources, "Books/chapter.htm", null, id)), { code: "HTML_IMPORT_ID_CONFLICT" });
  assert.equal(imported.importedAt, moved.importedAt);
});

test("deleting one HTML entry keeps shared resources until the final entry is deleted", async (t) => {
  const { root, handlers } = await fixture(t); const excerpt = path.join(root, "saved-note-image.png"); await writeFile(excerpt, "A copied note image");
  const resources = await bundle(await handlers.importBundle(upload()));
  const first = await document(await handlers.importDocument(importDocument(resources)));
  const second = await document(await handlers.importDocument(importDocument(resources, "Books/chapter.htm")));
  await assert.rejects(handlers.deleteBundle(deletion(), resources.id), { code: "HTML_BUNDLE_IN_USE" });
  const pinned = await handlers.asset(new Request(`${origin}/asset`), second.id, "Books/assets/app.js");
  assert.equal((await handlers.deleteDocument(deletion(), first.id)).status, 204);
  assert.equal((await handlers.getBundle(resources.id)).status, 200);
  await assert.rejects(handlers.asset(new Request(`${origin}/asset`), second.id, "Books/index.html"), { code: "HTML_NOT_FOUND" });
  const chapter = await handlers.asset(new Request(`${origin}/asset`), second.id, "Books/chapter.htm");
  assert.equal(await chapter.text(), assetFiles[1].content);
  assert.equal((await handlers.deleteDocument(deletion(), second.id)).status, 204);
  assert.equal(await pinned.text(), assetFiles[2].content);
  await assert.rejects(handlers.getBundle(resources.id), { code: "HTML_BUNDLE_NOT_FOUND" });
  await assert.rejects(handlers.patchProgress(mutation({ revision: 0, progress: { position: 0, scale: 1 } }, "PATCH"), second.id), { code: "HTML_NOT_FOUND" });
  assert.deepEqual(await readdir(path.join(root, "bundles")), []); assert.equal(await readFile(excerpt, "utf8"), "A copied note image");
  assert.deepEqual(await library(await handlers.list()), { documents: [], folders: [] });
});

test("known unreferenced bundles can be discarded but document creation cannot race a dangling reference", async (t) => {
  const { root, handlers } = await fixture(t); const resources = await bundle(await handlers.importBundle(upload()));
  assert.equal((await handlers.deleteBundle(deletion(), resources.id)).status, 204);
  await assert.rejects(handlers.getBundle(resources.id), { code: "HTML_BUNDLE_NOT_FOUND" }); assert.deepEqual(await readdir(path.join(root, "bundles")), []);
  const pending = await bundle(await handlers.importBundle(upload()));
  const results = await Promise.allSettled([handlers.importDocument(importDocument(pending)), handlers.deleteBundle(deletion(), pending.id)]);
  const libraryState = await library(await handlers.list());
  if (libraryState.documents.length) { assert.equal((await handlers.getBundle(pending.id)).status, 200); assert.equal(results[1].status, "rejected"); }
  else { await assert.rejects(handlers.getBundle(pending.id), { code: "HTML_BUNDLE_NOT_FOUND" }); assert.equal(results[0].status, "rejected"); }
});

test("HTML folders retain nested structure, reject duplicate siblings and only delete empty folders", async (t) => {
  const { handlers } = await fixture(t);
  const top = await folder(await handlers.createFolder(mutation({ name: "  Chemistry  " })));
  const child = await folder(await handlers.createFolder(mutation({ name: "Organic", parentId: top.id })));
  assert.equal(top.name, "Chemistry");
  await assert.rejects(handlers.createFolder(mutation({ name: "chemistry" })), { code: "HTML_FOLDER_EXISTS" });
  const accented = await folder(await handlers.createFolder(mutation({ name: "Café" })));
  await assert.rejects(handlers.createFolder(mutation({ name: "CAFE\u0301" })), { code: "HTML_FOLDER_EXISTS" });
  await assert.rejects(handlers.deleteFolder(deletion(), top.id), { code: "HTML_FOLDER_NOT_EMPTY" });
  await assert.rejects(handlers.patchFolder(mutation({ parentId: child.id }, "PATCH"), top.id), { code: "VALIDATION_ERROR" });
  const changed = await folder(await handlers.patchFolder(mutation({ name: "Reactions", parentId: accented.id }, "PATCH"), child.id));
  assert.equal(changed.parentId, accented.id); assert.equal(changed.createdAt, child.createdAt);
  assert.equal((await handlers.deleteFolder(deletion(), top.id)).status, 204);
  let deepest = changed;
  for (let level = 3; level <= HTML_FOLDER_MAX_DEPTH; level++) deepest = await folder(await handlers.createFolder(mutation({ name: `Level ${level}`, parentId: deepest.id })));
  await assert.rejects(handlers.createFolder(mutation({ name: "Too deep", parentId: deepest.id })), { code: "VALIDATION_ERROR" });
  const another = await folder(await handlers.createFolder(mutation({ name: "Another" })));
  await handlers.createFolder(mutation({ name: "Nested", parentId: another.id }));
  await assert.rejects(handlers.patchFolder(mutation({ parentId: deepest.id }, "PATCH"), another.id), { code: "VALIDATION_ERROR" });
});

test("HTML libraries isolate applications and validate ownership, origin and metadata bodies", async (t) => {
  const { root, handlers } = await fixture(t); const other = createHtmlLibraryHandlers({ root: () => path.join(root, "other-app") });
  const target = await folder(await handlers.createFolder(mutation({ name: "Private" })));
  const resources = await bundle(await handlers.importBundle(upload())); const book = await document(await handlers.importDocument(importDocument(resources, "Books/index.html", target.id)));
  await assert.rejects(other.getDocument(book.id), { code: "HTML_NOT_FOUND" }); await assert.rejects(other.getBundle(resources.id), { code: "HTML_BUNDLE_NOT_FOUND" });
  await assert.rejects(other.asset(new Request(`${origin}/asset`), book.id, "Books/index.html"), { code: "HTML_NOT_FOUND" });
  await assert.rejects(other.patchFolder(mutation({ name: "Foreign" }, "PATCH"), target.id), { code: "HTML_FOLDER_NOT_FOUND" });
  await assert.rejects(handlers.createFolder(mutation({ name: "Blocked" }, "POST", { origin: "http://localhost:3001" })), { code: "FORBIDDEN_ORIGIN" });
  await assert.rejects(handlers.importBundle(upload(assetFiles, randomUUID(), { origin: "null" })), { code: "FORBIDDEN_ORIGIN" });
  await assert.rejects(handlers.moveDocument(mutation({ folderId: null }, "PATCH", { origin: "https://example.com" }), book.id), { code: "FORBIDDEN_ORIGIN" });
  await assert.rejects(handlers.patchAnnotations(mutation({ revision: 0, annotations: [annotation] }, "PATCH", { "content-length": String(4 * 1024 * 1024 + 1) }), book.id), { code: "HTML_BODY_TOO_LARGE" });
  await assert.rejects(handlers.importDocument(mutation({ bundleId: resources.id, entryPath: "../index.html" })), { code: "VALIDATION_ERROR" });
  await assert.rejects(handlers.importDocument(mutation({ bundleId: resources.id, entryPath: "Books/assets/app.js" })), { code: "VALIDATION_ERROR" });
  await assert.rejects(handlers.moveDocument(mutation({ folderId: null, unknown: true }, "PATCH"), book.id), { code: "VALIDATION_ERROR" });
  assert.equal((await library(await handlers.list())).documents.length, 1);
});

test("HTML streaming import rejects unsafe manifests, missing resources and oversize declarations without retaining partial files", async (t) => {
  const { root, handlers } = await fixture(t);
  for (const files of [[{ path: "../index.html", content: html }], [{ path: "a/index.html", content: html }, { path: "A/INDEX.HTML", content: html }], [{ path: "app.js", content: "code" }], [{ path: "index.html", content: "" }]])
    await assert.rejects(handlers.importBundle(upload(files)));
  const body = new FormData(); body.set("manifest", JSON.stringify({ files: [{ path: "index.html", field: "file-0" }, { path: "missing.css", field: "file-1" }] }));
  body.set("file-0", new Blob([html]), "index.html");
  await assert.rejects(handlers.importBundle(new Request(`${origin}/api/html/bundles`, { method: "POST", body })), { code: "INVALID_HTML_UPLOAD" });
  await assert.rejects(handlers.importBundle(upload(assetFiles, randomUUID(), { "content-length": String(HTML_MAX_BUNDLE_BYTES + 32 * 1024 * 1024) })), { code: "HTML_BUNDLE_TOO_LARGE" });
  assert.deepEqual(await readdir(path.join(root, "bundles")), []);
});

test("HTML streaming import handles split multipart boundaries and cancellation", async (t) => {
  const { root, handlers } = await fixture(t);
  const request = upload([{ path: "index.html", content: `${html}\r\n--not-the-real-boundary-more-data` }]);
  const bytes = new Uint8Array(await request.arrayBuffer()); let offset = 0;
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { if (offset >= bytes.length) controller.close(); else controller.enqueue(bytes.subarray(offset, offset = Math.min(offset + 3, bytes.length))); } });
  const split = new Request(request.url, { method: "POST", body: stream, duplex: "half", headers: request.headers } as RequestInit);
  const resources = await bundle(await handlers.importBundle(split)); assert.equal(resources.files.length, 1);
  const controller = new AbortController(); let reached!: () => void; const paused = new Promise<void>((resolve) => { reached = resolve; });
  const streamBody = new ReadableStream<Uint8Array>({ start(sink) { sink.enqueue(Buffer.from("--cancel-boundary\r\n")); reached(); } });
  const canceled = handlers.importBundle(new Request(`${origin}/api/html/bundles`, { method: "POST", body: streamBody, duplex: "half", signal: controller.signal,
    headers: { "content-type": "multipart/form-data; boundary=cancel-boundary" } } as RequestInit));
  await paused; controller.abort(); await assert.rejects(canceled, { code: "HTML_UPLOAD_CANCELED" });
  assert.deepEqual(await readdir(path.join(root, "bundles")), [resources.id]);
});

test("an empty HTML resource does not prevent importing other valid entries in a directory", async (t) => {
  const { handlers } = await fixture(t);
  const resources = await bundle(await handlers.importBundle(upload([{ path: "index.html", content: html }, { path: "empty.html", content: "" }])));
  assert.equal(resources.files.find((file) => file.path === "empty.html")?.size, 0);
  const imported = await handlers.importDocument(importDocument(resources, "index.html")); assert.equal(imported.status, 201);
  await assert.rejects(handlers.importDocument(importDocument(resources, "empty.html")), { code: "VALIDATION_ERROR" });
});

test("failed HTML transactions restore quarantined resources and remove newly staged bundles", async (t) => {
  const { root, handlers } = await fixture(t); await handlers.list(); const filename = path.join(root, "metadata.sqlite");
  const metadata = new Database(filename); metadata.exec("CREATE TRIGGER reject_html_bundle BEFORE INSERT ON html_bundles BEGIN SELECT RAISE(ABORT, 'test failure'); END"); metadata.close();
  await assert.rejects(handlers.importBundle(upload()), { code: "HTML_LIBRARY_UNAVAILABLE" }); assert.deepEqual(await readdir(path.join(root, "bundles")), []);
  const repaired = new Database(filename); repaired.exec("DROP TRIGGER reject_html_bundle"); repaired.close();
  const resources = await bundle(await handlers.importBundle(upload())); const book = await document(await handlers.importDocument(importDocument(resources)));
  const failing = new Database(filename); failing.exec("CREATE TRIGGER reject_html_bundle_delete BEFORE DELETE ON html_bundles BEGIN SELECT RAISE(ABORT, 'test failure'); END"); failing.close();
  await assert.rejects(handlers.deleteDocument(deletion(), book.id), { code: "HTML_LIBRARY_UNAVAILABLE" });
  assert.equal((await document(await handlers.getDocument(book.id))).bundleId, resources.id); assert.equal(await readFile(path.join(root, "bundles", resources.id, "0"), "utf8"), html);
  const restored = new Database(filename); assert.equal(restored.pragma("integrity_check", { simple: true }), "ok"); assert.deepEqual(restored.pragma("foreign_key_check"), []); restored.close();
});

test("HTML bundle serving and deletion refuse symlinked resource directories", async (t) => {
  const { root, handlers } = await fixture(t); const resources = await bundle(await handlers.importBundle(upload())); const book = await document(await handlers.importDocument(importDocument(resources)));
  const original = path.join(root, "bundles", resources.id); const outside = path.join(root, "outside"); await rename(original, outside);
  try { await symlink(outside, original, process.platform === "win32" ? "junction" : "dir"); }
  catch (error) { if (error && typeof error === "object" && "code" in error && (error.code === "EPERM" || error.code === "EACCES")) { t.skip("This environment does not permit test directory links."); return; } throw error; }
  await assert.rejects(handlers.asset(new Request(`${origin}/asset`), book.id, "Books/index.html"), { code: "HTML_NOT_FOUND" });
  await assert.rejects(handlers.deleteDocument(deletion(), book.id), { code: "HTML_LIBRARY_UNAVAILABLE" });
  assert.equal((await document(await handlers.getDocument(book.id))).id, book.id); assert.equal(await readFile(path.join(outside, "0"), "utf8"), html);
  const blocked = createHtmlLibraryHandlers({ root: () => path.join(root, "blocked") }); await blocked.list();
  await mkdir(path.join(root, "elsewhere")); await symlink(path.join(root, "elsewhere"), path.join(root, "blocked", "bundles"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(blocked.importBundle(upload()), { code: "HTML_LIBRARY_UNAVAILABLE" }); assert.deepEqual(await readdir(path.join(root, "elsewhere")), []);
});

test("corrupt bundle metadata cannot turn a resource index into a filesystem path", async (t) => {
  const { root, handlers } = await fixture(t); const resources = await bundle(await handlers.importBundle(upload()));
  const book = await document(await handlers.importDocument(importDocument(resources)));
  const metadata = new Database(path.join(root, "metadata.sqlite"));
  const row = metadata.prepare("SELECT files FROM html_bundles WHERE id = ?").get(resources.id) as { files: string };
  const files = JSON.parse(row.files) as Array<{ index: unknown }>;
  files[0].index = "../../metadata.sqlite";
  metadata.prepare("UPDATE html_bundles SET files = ? WHERE id = ?").run(JSON.stringify(files), resources.id); metadata.close();
  await assert.rejects(handlers.asset(new Request(`${origin}/asset`), book.id, "Books/index.html"), { code: "HTML_LIBRARY_UNAVAILABLE" });
});
