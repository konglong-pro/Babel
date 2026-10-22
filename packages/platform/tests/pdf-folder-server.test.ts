import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import { PDF_FOLDER_MAX_DEPTH, type PdfDocument, type PdfDocumentSummary, type PdfFolder } from "../src/pdf/core";
import { createPdfLibraryHandlers } from "../src/pdf/server";

const pdf = Buffer.from("%PDF-1.7\n1 0 obj\n<</Type/Catalog>>\nendobj\n%%EOF\n");

function mutation(body: unknown, method = "POST", headers: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/pdf/folders", {
    method, body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers },
  });
}

function deletion(headers: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/pdf/folders/id", { method: "DELETE", headers });
}

function upload(folderId?: string, id?: string) {
  const body = new FormData();
  body.set("file", new Blob([pdf], { type: "application/pdf" }), "book.pdf");
  return new Request("http://localhost:3000/api/pdf/documents", {
    method: "POST", body, headers: {
      ...(folderId === undefined ? {} : { "X-Babel-Pdf-Folder-Id": folderId }),
      ...(id === undefined ? {} : { "X-Babel-Pdf-Import-Id": id }),
    },
  });
}

async function folder(response: Response): Promise<PdfFolder> {
  return (await response.json() as { folder: PdfFolder }).folder;
}

async function document(response: Response): Promise<PdfDocument> {
  return (await response.json() as { document: PdfDocument }).document;
}

async function library(response: Response): Promise<{ folders: PdfFolder[]; documents: PdfDocumentSummary[] }> {
  return await response.json() as { folders: PdfFolder[]; documents: PdfDocumentSummary[] };
}

test("PDF folders extend an existing metadata database without changing originals, progress or annotations", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "babel-pdf-old-schema-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const id = randomUUID();
  const metadata = new Database(path.join(root, "metadata.sqlite"));
  metadata.exec(`CREATE TABLE pdf_documents (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, file_name TEXT NOT NULL, size INTEGER NOT NULL,
    imported_at TEXT NOT NULL, updated_at TEXT NOT NULL, page INTEGER NOT NULL DEFAULT 1,
    scale REAL NOT NULL DEFAULT 1, rotation INTEGER NOT NULL DEFAULT 0,
    progress_revision INTEGER NOT NULL DEFAULT 0, annotations_revision INTEGER NOT NULL DEFAULT 0,
    annotations TEXT NOT NULL DEFAULT '[]'
  )`);
  const annotations = [{ id: "old-highlight", type: "highlight", page: 7, rects: [{ x: 0, y: 0, width: 0.2, height: 0.1 }],
    text: "Preserve this excerpt", comment: "Keep", color: "#ffee66", createdAt: "2026-10-19T01:00:00.000Z" }];
  metadata.prepare("INSERT INTO pdf_documents VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    id, "Existing book", "existing.pdf", pdf.length, "2026-10-19T01:00:00.000Z", "2026-10-19T02:00:00.000Z", 7, 1.5, 90, 3, 2, JSON.stringify(annotations),
  );
  const previous = metadata.prepare("SELECT * FROM pdf_documents").get();
  const columns = metadata.pragma("table_info(pdf_documents)");
  metadata.close();
  await mkdir(path.join(root, "files"));
  await writeFile(path.join(root, "files", `${id}.pdf`), pdf);
  const handlers = createPdfLibraryHandlers({ root: () => root });
  const initial = await library(await handlers.list());
  assert.deepEqual(initial.folders, []);
  assert.equal(initial.documents[0].folderId, null);
  const old = await document(await handlers.getDocument(id));
  assert.deepEqual(old.progress, { page: 7, scale: 1.5, rotation: 90 });
  assert.equal(old.progressRevision, 3);
  assert.equal(old.annotationsRevision, 2);
  assert.deepEqual(old.annotations, annotations);
  const target = await folder(await handlers.createFolder(mutation({ name: "Archive" })));
  assert.equal((await document(await handlers.moveDocument(mutation({ folderId: target.id }, "PATCH"), id))).folderId, target.id);
  const reopened = new Database(path.join(root, "metadata.sqlite"), { readonly: true });
  assert.deepEqual(reopened.pragma("table_info(pdf_documents)"), columns);
  assert.deepEqual({ ...reopened.prepare("SELECT * FROM pdf_documents").get() as object, updated_at: (previous as { updated_at: string }).updated_at }, previous);
  assert.equal(reopened.pragma("integrity_check", { simple: true }), "ok");
  assert.deepEqual(reopened.pragma("foreign_key_check"), []);
  reopened.close();
  assert.deepEqual(await readFile(path.join(root, "files", `${id}.pdf`)), pdf);
});

test("PDF folders support nested creation, rename, reparent, restart and empty-only deletion", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "babel-pdf-folder-crud-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const handlers = createPdfLibraryHandlers({ root: () => root });
  const response = await handlers.createFolder(mutation({ name: "  Chemistry  ", parentId: null }));
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const chemistry = await folder(response);
  assert.equal(chemistry.name, "Chemistry");
  assert.equal(chemistry.parentId, null);
  const organic = await folder(await handlers.createFolder(mutation({ name: "Organic", parentId: chemistry.id })));
  const inorganic = await folder(await handlers.createFolder(mutation({ name: "Inorganic", parentId: chemistry.id })));
  await assert.rejects(handlers.deleteFolder(deletion(), chemistry.id), { code: "PDF_FOLDER_NOT_EMPTY", status: 409 });
  await assert.rejects(handlers.patchFolder(mutation({ parentId: organic.id }, "PATCH"), chemistry.id), { code: "VALIDATION_ERROR", status: 400 });
  await assert.rejects(handlers.patchFolder(mutation({ parentId: chemistry.id }, "PATCH"), chemistry.id), { code: "VALIDATION_ERROR" });
  const renamed = await folder(await handlers.patchFolder(mutation({ name: "Organic reactions", parentId: null }, "PATCH"), organic.id));
  assert.equal(renamed.name, "Organic reactions");
  assert.equal(renamed.parentId, null);
  assert.equal(renamed.createdAt, organic.createdAt);
  assert.ok(Date.parse(renamed.updatedAt) >= Date.parse(renamed.createdAt));
  const restarted = createPdfLibraryHandlers({ root: () => root });
  assert.deepEqual((await library(await restarted.list())).folders.find((entry) => entry.id === organic.id), renamed);
  assert.equal((await handlers.deleteFolder(deletion(), inorganic.id)).status, 204);
  assert.equal((await handlers.deleteFolder(deletion(), chemistry.id)).status, 204);
  await assert.rejects(handlers.deleteFolder(deletion(), chemistry.id), { code: "PDF_FOLDER_NOT_FOUND", status: 404 });
  assert.deepEqual((await library(await handlers.list())).folders, [renamed]);
});

test("PDF folder validation prevents duplicate siblings, unsafe paths, invalid destinations and excessive subtree depth", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "babel-pdf-folder-validation-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const handlers = createPdfLibraryHandlers({ root: () => root });
  for (const name of [null, 1, "", " ", ".", "..", "a/b", "a\\b", "a\u0000b", "a\u007fb", "x".repeat(121)]) {
    await assert.rejects(handlers.createFolder(mutation({ name })), { code: "VALIDATION_ERROR", status: 400 });
  }
  const top = await folder(await handlers.createFolder(mutation({ name: "Chemistry" })));
  await assert.rejects(handlers.createFolder(mutation({ name: " chemistry " })), { code: "PDF_FOLDER_EXISTS", status: 409 });
  const accented = await folder(await handlers.createFolder(mutation({ name: "Café" })));
  await assert.rejects(handlers.createFolder(mutation({ name: "CAFE\u0301" })), { code: "PDF_FOLDER_EXISTS" });
  assert.equal((await folder(await handlers.createFolder(mutation({ name: "Chemistry", parentId: accented.id })))).name, "Chemistry");
  assert.equal((await folder(await handlers.createFolder(mutation({ name: "化学笔记" })))).name, "化学笔记");
  for (const parentId of ["", 1, "../outside", "00000000-0000-1000-8000-000000000000"]) {
    await assert.rejects(handlers.createFolder(mutation({ name: "Invalid", parentId })), { code: "VALIDATION_ERROR" });
  }
  await assert.rejects(handlers.createFolder(mutation({ name: "Gone", parentId: randomUUID() })), { code: "PDF_FOLDER_NOT_FOUND" });
  await assert.rejects(handlers.patchFolder(mutation({ name: "Cafe\u0301" }, "PATCH"), top.id), { code: "PDF_FOLDER_EXISTS" });
  await assert.rejects(handlers.patchFolder(mutation({}, "PATCH"), top.id), { code: "VALIDATION_ERROR" });
  await assert.rejects(handlers.patchFolder(mutation({ unexpected: true }, "PATCH"), top.id), { code: "VALIDATION_ERROR" });
  for (const id of ["", "../../notes", randomUUID()]) {
    await assert.rejects(handlers.patchFolder(mutation({ name: "Other" }, "PATCH"), id), { code: "PDF_FOLDER_NOT_FOUND" });
    await assert.rejects(handlers.deleteFolder(deletion(), id), { code: "PDF_FOLDER_NOT_FOUND" });
  }
  let deepest = top;
  const levels = [top];
  for (let depth = 2; depth <= PDF_FOLDER_MAX_DEPTH; depth++) {
    deepest = await folder(await handlers.createFolder(mutation({ name: `Level ${depth}`, parentId: deepest.id })));
    levels.push(deepest);
  }
  await assert.rejects(handlers.createFolder(mutation({ name: "Too deep", parentId: deepest.id })), { code: "VALIDATION_ERROR" });
  const subtree = await folder(await handlers.createFolder(mutation({ name: "Move subtree" })));
  const child = await folder(await handlers.createFolder(mutation({ name: "Child", parentId: subtree.id })));
  await assert.rejects(handlers.patchFolder(mutation({ parentId: levels[PDF_FOLDER_MAX_DEPTH - 2].id }, "PATCH"), subtree.id), { code: "VALIDATION_ERROR" });
  const moved = await folder(await handlers.patchFolder(mutation({ parentId: levels[PDF_FOLDER_MAX_DEPTH - 3].id }, "PATCH"), subtree.id));
  assert.equal(moved.parentId, levels[PDF_FOLDER_MAX_DEPTH - 3].id);
  assert.equal((await library(await handlers.list())).folders.find((entry) => entry.id === child.id)?.parentId, subtree.id);
});

test("PDF folder imports and moves remain app-owned, preserve reading state and do not change import retries", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "babel-pdf-folder-ownership-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const firstRoot = path.join(root, "first");
  const first = createPdfLibraryHandlers({ root: () => firstRoot });
  const second = createPdfLibraryHandlers({ root: () => path.join(root, "second") });
  const target = await folder(await first.createFolder(mutation({ name: "Chemistry" })));
  const other = await folder(await first.createFolder(mutation({ name: "Physics" })));
  const id = randomUUID();
  const imported = await document(await first.importPdf(upload(target.id.toUpperCase(), id)));
  assert.equal(imported.folderId, target.id);
  const progress = { page: 5, scale: 1.25, rotation: 90 };
  const progressed = await document(await first.patchProgress(mutation({ revision: 0, progress }, "PATCH"), id));
  const moved = await document(await first.moveDocument(mutation({ folderId: other.id }, "PATCH"), id));
  assert.equal(moved.folderId, other.id);
  assert.deepEqual(moved.progress, progress);
  assert.equal(moved.progressRevision, progressed.progressRevision);
  assert.equal(moved.annotationsRevision, progressed.annotationsRevision);
  assert.deepEqual(await readFile(path.join(firstRoot, "files", `${id}.pdf`)), pdf);
  assert.equal((await first.deleteFolder(deletion(), target.id)).status, 204);
  const retry = await first.importPdf(upload(target.id, id));
  assert.equal(retry.status, 200);
  assert.deepEqual(await document(retry), moved);
  assert.deepEqual(await document(await first.importPdf(upload(undefined, id))), moved);
  await assert.rejects(first.deleteFolder(deletion(), other.id), { code: "PDF_FOLDER_NOT_EMPTY" });
  await assert.rejects(second.patchFolder(mutation({ name: "Foreign" }, "PATCH"), other.id), { code: "PDF_FOLDER_NOT_FOUND" });
  await assert.rejects(second.deleteFolder(deletion(), other.id), { code: "PDF_FOLDER_NOT_FOUND" });
  await assert.rejects(second.importPdf(upload(other.id)), { code: "PDF_FOLDER_NOT_FOUND" });
  const secondDocument = await document(await second.importPdf(upload()));
  await assert.rejects(second.moveDocument(mutation({ folderId: other.id }, "PATCH"), secondDocument.id), { code: "PDF_FOLDER_NOT_FOUND" });
  await assert.rejects(second.moveDocument(mutation({ folderId: null }, "PATCH"), id), { code: "PDF_NOT_FOUND" });
  assert.equal((await document(await first.moveDocument(mutation({ folderId: null }, "PATCH"), id))).folderId, null);
  assert.equal((await first.deleteFolder(deletion(), other.id)).status, 204);
  assert.equal((await document(await createPdfLibraryHandlers({ root: () => firstRoot }).getDocument(id))).folderId, null);
  assert.equal((await library(await second.list())).documents[0].folderId, null);
});

test("simultaneous PDF folder changes cannot create duplicate siblings or cycles", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "babel-pdf-folder-concurrency-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = createPdfLibraryHandlers({ root: () => root });
  const second = createPdfLibraryHandlers({ root: () => root });
  const duplicates = await Promise.allSettled([
    first.createFolder(mutation({ name: "Notes" })), second.createFolder(mutation({ name: " notes " })),
  ]);
  assert.equal(duplicates.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal((duplicates.find((result) => result.status === "rejected") as PromiseRejectedResult).reason.code, "PDF_FOLDER_EXISTS");
  const one = await folder(await first.createFolder(mutation({ name: "One" })));
  const two = await folder(await second.createFolder(mutation({ name: "Two" })));
  const moves = await Promise.allSettled([
    first.patchFolder(mutation({ parentId: two.id }, "PATCH"), one.id),
    second.patchFolder(mutation({ parentId: one.id }, "PATCH"), two.id),
  ]);
  assert.equal(moves.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal((moves.find((result) => result.status === "rejected") as PromiseRejectedResult).reason.code, "VALIDATION_ERROR");
  const folders = (await library(await first.list())).folders;
  assert.ok(folders.find((entry) => entry.id === one.id)?.parentId === null || folders.find((entry) => entry.id === two.id)?.parentId === null);
});

test("PDF folder mutations enforce origin and bounded bodies before changing metadata", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "babel-pdf-folder-request-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const handlers = createPdfLibraryHandlers({ root: () => root });
  const created = await folder(await handlers.createFolder(mutation({ name: "Keep" })));
  const imported = await document(await handlers.importPdf(upload()));
  const foreign = { origin: "http://localhost:3001" };
  await assert.rejects(handlers.createFolder(mutation({ name: "Blocked" }, "POST", foreign)), { code: "FORBIDDEN_ORIGIN" });
  await assert.rejects(handlers.patchFolder(mutation({ name: "Blocked" }, "PATCH", foreign), created.id), { code: "FORBIDDEN_ORIGIN" });
  await assert.rejects(handlers.deleteFolder(deletion(foreign), created.id), { code: "FORBIDDEN_ORIGIN" });
  await assert.rejects(handlers.moveDocument(mutation({ folderId: created.id }, "PATCH", foreign), imported.id), { code: "FORBIDDEN_ORIGIN" });
  await assert.rejects(handlers.createFolder(mutation({ name: "Too large" }, "POST", { "content-length": String(4 * 1024 * 1024 + 1) })), { code: "PDF_BODY_TOO_LARGE" });
  await assert.rejects(handlers.moveDocument(mutation({}, "PATCH"), imported.id), { code: "VALIDATION_ERROR" });
  await assert.rejects(handlers.moveDocument(mutation({ folderId: null, unexpected: true }, "PATCH"), imported.id), { code: "VALIDATION_ERROR" });
  for (const folderId of ["", "../metadata.sqlite", "not-a-uuid"]) {
    await assert.rejects(handlers.importPdf(upload(folderId)), { code: "VALIDATION_ERROR" });
  }
  const current = await library(await handlers.list());
  assert.deepEqual(current.folders, [created]);
  assert.equal(current.documents[0].folderId, null);
  assert.deepEqual(await readdir(path.join(root, "files")), [`${imported.id}.pdf`]);
});

test("PDF folder destinations are checked inside import and move transactions after a concurrent deletion", { timeout: 5000 }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "babel-pdf-folder-race-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = createPdfLibraryHandlers({ root: () => root });
  const second = createPdfLibraryHandlers({ root: () => root });
  const target = await folder(await first.createFolder(mutation({ name: "Temporary" })));
  const existing = await document(await first.importPdf(upload()));
  let release!: () => void;
  let reached!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const paused = new Promise<void>((resolve) => { reached = resolve; });
  t.after(release);
  const boundary = "folder-race-boundary";
  let firstChunk = true;
  const body = new ReadableStream<Uint8Array>({ async pull(controller) {
    if (firstChunk) {
      firstChunk = false;
      controller.enqueue(Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="book.pdf"\r\n\r\n`), pdf]));
    } else {
      reached();
      await gate;
      controller.enqueue(Buffer.from(`\r\n--${boundary}--\r\n`));
      controller.close();
    }
  } }, { highWaterMark: 0 });
  const importing = first.importPdf(new Request("http://localhost:3000/api/pdf/documents", {
    method: "POST", body, duplex: "half", headers: { "content-type": `multipart/form-data; boundary=${boundary}`, "X-Babel-Pdf-Folder-Id": target.id },
  } as RequestInit));
  const movingBody = new ReadableStream<Uint8Array>({ async start(controller) {
    await gate;
    controller.enqueue(Buffer.from(JSON.stringify({ folderId: target.id })));
    controller.close();
  } });
  const moving = first.moveDocument(new Request("http://localhost:3000/api/pdf/documents/id", { method: "PATCH", body: movingBody, duplex: "half" } as RequestInit), existing.id);
  const settled = Promise.allSettled([importing, moving]);
  await paused;
  assert.equal((await second.deleteFolder(deletion(), target.id)).status, 204);
  release();
  for (const result of await settled) {
    assert.equal(result.status, "rejected");
    assert.equal((result as PromiseRejectedResult).reason.code, "PDF_FOLDER_NOT_FOUND");
  }
  const current = await library(await first.list());
  assert.deepEqual(current.folders, []);
  assert.equal(current.documents.length, 1);
  assert.equal(current.documents[0].folderId, null);
  assert.deepEqual(await readdir(path.join(root, "files")), [`${existing.id}.pdf`]);
});

test("failed folder membership writes roll back moves and staged imports, and document deletion clears membership", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "babel-pdf-folder-rollback-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const handlers = createPdfLibraryHandlers({ root: () => root });
  const source = await folder(await handlers.createFolder(mutation({ name: "Source" })));
  const target = await folder(await handlers.createFolder(mutation({ name: "Target" })));
  const imported = await document(await handlers.importPdf(upload(source.id)));
  const metadataPath = path.join(root, "metadata.sqlite");
  const metadata = new Database(metadataPath);
  metadata.exec(`CREATE TRIGGER reject_membership_insert BEFORE INSERT ON pdf_document_folders BEGIN SELECT RAISE(ABORT, 'test failure'); END;
    CREATE TRIGGER reject_membership_update BEFORE UPDATE ON pdf_document_folders BEGIN SELECT RAISE(ABORT, 'test failure'); END`);
  metadata.close();
  await assert.rejects(handlers.moveDocument(mutation({ folderId: target.id }, "PATCH"), imported.id), { code: "PDF_LIBRARY_UNAVAILABLE" });
  await assert.rejects(handlers.importPdf(upload(target.id)), { code: "PDF_LIBRARY_UNAVAILABLE" });
  assert.deepEqual(await document(await handlers.getDocument(imported.id)), imported);
  assert.deepEqual(await readdir(path.join(root, "files")), [`${imported.id}.pdf`]);
  assert.equal((await library(await handlers.list())).documents.length, 1);
  const repaired = new Database(metadataPath);
  repaired.exec("DROP TRIGGER reject_membership_insert; DROP TRIGGER reject_membership_update");
  repaired.exec("CREATE TRIGGER reject_document_delete BEFORE DELETE ON pdf_documents BEGIN SELECT RAISE(ABORT, 'test failure'); END");
  repaired.close();
  await assert.rejects(handlers.deleteDocument(deletion(), imported.id), { code: "PDF_LIBRARY_UNAVAILABLE" });
  assert.deepEqual(await document(await handlers.getDocument(imported.id)), imported);
  await assert.rejects(handlers.deleteFolder(deletion(), source.id), { code: "PDF_FOLDER_NOT_EMPTY" });
  assert.deepEqual(await readdir(path.join(root, "files")), [`${imported.id}.pdf`]);
  const recovered = new Database(metadataPath);
  recovered.exec("DROP TRIGGER reject_document_delete");
  recovered.close();
  assert.equal((await handlers.deleteDocument(deletion(), imported.id)).status, 204);
  assert.equal((await handlers.deleteFolder(deletion(), source.id)).status, 204);
  assert.equal((await handlers.deleteFolder(deletion(), target.id)).status, 204);
  const final = new Database(metadataPath, { readonly: true });
  assert.deepEqual(final.prepare("SELECT * FROM pdf_document_folders").all(), []);
  assert.deepEqual(final.pragma("foreign_key_check"), []);
  final.close();
  assert.deepEqual(await library(await handlers.list()), { documents: [], folders: [] });
});
