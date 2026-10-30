import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import { ApiError, createHttpErrorHandlers } from "../src/http/errors";
import { PDF_DEFAULT_PROGRESS, PDF_MAX_FILE_BYTES, type PdfAnnotation, type PdfDocument } from "../src/pdf/core";
import { createPdfLibraryHandlers } from "../src/pdf/server";

const pdf = Buffer.from("%PDF-1.7\n1 0 obj\n<</Type/Catalog>>\nendobj\n%%EOF\n");

function upload(content: BlobPart = pdf, name = "教材.pdf", title?: string, headers: Record<string, string> = {}) {
  const body = new FormData();
  body.set("file", new Blob([content], { type: "application/pdf" }), name);
  if (title !== undefined) body.set("title", title);
  return new Request("http://localhost:3000/api/pdf/documents", { method: "POST", body, headers });
}

function patch(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/pdf/documents/id/progress", {
    method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers },
  });
}

function fileRequest(headers: Record<string, string> = {}, method = "GET") {
  return new Request("http://localhost:3000/api/pdf/documents/id/file", { headers, method });
}

function deletion(headers: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/pdf/documents/id", { method: "DELETE", headers });
}

function chunked(bytes: Uint8Array, boundary: string, chunkSize: number) {
  let position = 0;
  const body = new ReadableStream<Uint8Array>({ pull(controller) {
    if (position >= bytes.byteLength) { controller.close(); return; }
    controller.enqueue(bytes.subarray(position, position + chunkSize));
    position += chunkSize;
  } });
  return new Request("http://localhost:3000/api/pdf/documents", {
    method: "POST", headers: { "content-type": `multipart/form-data; boundary="${boundary}"` }, body, duplex: "half",
  } as RequestInit);
}

function heldUpload(id: string) {
  const boundary = "held-pdf-boundary";
  let release!: () => void;
  let reached!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const paused = new Promise<void>((resolve) => { reached = resolve; });
  let first = true;
  const body = new ReadableStream<Uint8Array>({ async pull(controller) {
    if (first) {
      first = false;
      controller.enqueue(Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="book.pdf"\r\n\r\n`), pdf]));
    } else {
      reached();
      await gate;
      controller.enqueue(Buffer.from(`\r\n--${boundary}--\r\n`));
      controller.close();
    }
  } }, { highWaterMark: 0 });
  const controller = new AbortController();
  const request = new Request("http://localhost:3000/api/pdf/documents", {
    method: "POST", body, signal: controller.signal, duplex: "half",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}`, "X-Babel-Pdf-Import-Id": id },
  } as RequestInit);
  return { request, paused, release, controller };
}

async function decoded(response: Response): Promise<PdfDocument> {
  return ((await response.json()) as { document: PdfDocument }).document;
}

test("PDF library keeps immutable originals and independent application-owned metadata", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "babel-pdf-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const appRoot = path.join(root, "first");
  const first = createPdfLibraryHandlers({ root: () => appRoot });
  const second = createPdfLibraryHandlers({ root: () => path.join(root, "second") });
  assert.deepEqual(await (await first.list()).json(), { documents: [], folders: [] });
  const response = await first.importPdf(upload(pdf, "中文教材.pdf", "  化学导论  "));
  assert.equal(response.status, 201);
  const document = await decoded(response);
  assert.equal(document.title, "化学导论");
  assert.equal(document.fileName, "中文教材.pdf");
  assert.equal(document.size, pdf.byteLength);
  assert.deepEqual(document.progress, PDF_DEFAULT_PROGRESS);
  assert.deepEqual(document.annotations, []);
  assert.equal(document.progressRevision, 0);
  assert.equal(document.annotationsRevision, 0);
  assert.ok(Number.isFinite(Date.parse(document.importedAt)));
  assert.deepEqual(await decoded(await first.getDocument(document.id)), document);
  const list = await (await first.list()).json() as { documents: unknown[] };
  assert.equal(list.documents.length, 1);
  assert.equal("annotations" in (list.documents[0] as object), false);
  assert.deepEqual(await readFile(path.join(appRoot, "files", `${document.id}.pdf`)), pdf);
  const repeated = await decoded(await first.importPdf(upload(Buffer.concat([pdf, Buffer.from("different")] ), "中文教材.pdf")));
  assert.notEqual(repeated.id, document.id);
  assert.equal(repeated.title, "中文教材");
  await assert.rejects(second.getDocument(document.id), { code: "PDF_NOT_FOUND" });
  await assert.rejects(second.file(fileRequest(), document.id), { code: "PDF_NOT_FOUND" });
  assert.deepEqual(await (await second.list()).json(), { documents: [], folders: [] });
  const separatelyImported = await decoded(await second.importPdf(upload()));
  assert.notEqual(separatelyImported.id, document.id);
  for (const malicious of ["../metadata.sqlite", "..\\metadata.sqlite", "%2e%2e", "../../x", "id.pdf", ""]) {
    await assert.rejects(first.getDocument(malicious), { code: "PDF_NOT_FOUND" });
    await assert.rejects(first.file(fileRequest(), malicious), { code: "PDF_NOT_FOUND" });
  }
  const metadata = new Database(path.join(appRoot, "metadata.sqlite"), { readonly: true });
  assert.equal(metadata.pragma("journal_mode", { simple: true }), "delete");
  assert.equal(metadata.pragma("integrity_check", { simple: true }), "ok");
  metadata.close();
  assert.deepEqual((await readdir(appRoot)).sort(), ["files", "metadata.sqlite"]);
});

test("PDF import IDs make completed retries idempotent across restarts and remain app-owned", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "babel-pdf-import-id-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const appRoot = path.join(root, "first");
  const library = createPdfLibraryHandlers({ root: () => appRoot });
  const id = randomUUID();
  const headers = { "X-Babel-Pdf-Import-Id": id.toUpperCase() };
  const first = await library.importPdf(upload(pdf, "book.pdf", "Book", headers));
  assert.equal(first.status, 201);
  const document = await decoded(first);
  assert.equal(document.id, id);
  const progressed = await decoded(await library.patchProgress(patch({ revision: 0, progress: { page: 4, scale: 1.5, rotation: 0 } }), id));
  const restarted = createPdfLibraryHandlers({ root: () => appRoot });
  const replay = await restarted.importPdf(upload(pdf, "book.pdf", " Book ", headers));
  assert.equal(replay.status, 200);
  assert.deepEqual(await decoded(replay), progressed);
  assert.equal((await (await library.list()).json() as { documents: unknown[] }).documents.length, 1);
  assert.deepEqual(await readdir(path.join(appRoot, "files")), [`${id}.pdf`]);
  const second = createPdfLibraryHandlers({ root: () => path.join(root, "second") });
  assert.equal((await second.importPdf(upload(pdf, "other.pdf", undefined, headers))).status, 201);
  assert.equal((await decoded(await second.getDocument(id))).fileName, "other.pdf");
  assert.deepEqual(await readFile(path.join(appRoot, "files", `${id}.pdf`)), pdf);
});

test("PDF import ID conflicts never replace an original, including different content with the same name and size", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "babel-pdf-import-conflict-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const library = createPdfLibraryHandlers({ root: () => root });
  const id = randomUUID();
  const headers = { "X-Babel-Pdf-Import-Id": id };
  const document = await decoded(await library.importPdf(upload(pdf, "book.pdf", "Book", headers)));
  const changed = Buffer.from(pdf);
  changed[20] ^= 1;
  for (const attempt of [
    upload(pdf, "different.pdf", "Book", headers), upload(pdf, "book.pdf", "Different title", headers),
    upload(Buffer.concat([pdf, pdf]), "book.pdf", "Book", headers), upload(changed, "book.pdf", "Book", headers),
  ]) await assert.rejects(library.importPdf(attempt), { code: "PDF_IMPORT_ID_CONFLICT", status: 409 });
  assert.deepEqual(await decoded(await library.getDocument(id)), document);
  assert.deepEqual(await readFile(path.join(root, "files", `${id}.pdf`)), pdf);
  assert.deepEqual(await readdir(path.join(root, "files")), [`${id}.pdf`]);
});

test("PDF import IDs reject invalid versions and paths before creating storage", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "babel-pdf-import-invalid-id-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const library = createPdfLibraryHandlers({ root: () => root });
  for (const id of ["", "../book.pdf", "..\\metadata.sqlite", "not-a-uuid", "00000000-0000-1000-8000-000000000000", "00000000-0000-4000-7000-000000000000", `${randomUUID()},${randomUUID()}`]) {
    await assert.rejects(library.importPdf(upload(pdf, "book.pdf", undefined, { "X-Babel-Pdf-Import-Id": id })), { code: "VALIDATION_ERROR", status: 400 });
  }
  assert.deepEqual(await readdir(root), []);
});

test("simultaneous PDF import retries own distinct staging files and cannot remove a committed original", { timeout: 5000 }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "babel-pdf-import-race-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = createPdfLibraryHandlers({ root: () => root });
  const second = createPdfLibraryHandlers({ root: () => root });
  for (const abort of [false, true]) {
    const id = randomUUID();
    const held = heldUpload(id);
    t.after(held.release);
    const importing = first.importPdf(held.request);
    await held.paused;
    const staged = (await readdir(path.join(root, "files"))).find((name) => name.startsWith(`.pending-${id}-`));
    assert.ok(staged);
    const completed = await second.importPdf(upload(pdf, "book.pdf", undefined, { "X-Babel-Pdf-Import-Id": id }));
    assert.equal(completed.status, 201);
    assert.ok((await readdir(path.join(root, "files"))).includes(staged));
    if (abort) held.controller.abort();
    held.release();
    if (abort) await assert.rejects(importing, { code: "PDF_UPLOAD_CANCELED" });
    else {
      const replay = await importing;
      assert.equal(replay.status, 200);
      assert.equal((await decoded(replay)).id, id);
    }
    assert.deepEqual(await readFile(path.join(root, "files", `${id}.pdf`)), pdf);
    assert.ok(!(await readdir(path.join(root, "files"))).includes(staged));
  }
  assert.equal((await (await first.list()).json() as { documents: unknown[] }).documents.length, 2);
  assert.equal((await readdir(path.join(root, "files"))).length, 2);
});

test("PDF import retries never overwrite an existing original with no completed metadata", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "babel-pdf-import-existing-file-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const library = createPdfLibraryHandlers({ root: () => root });
  const id = randomUUID();
  await mkdir(path.join(root, "files"));
  const original = path.join(root, "files", `${id}.pdf`);
  await writeFile(original, "An existing unclaimed original.");
  await assert.rejects(library.importPdf(upload(pdf, "book.pdf", undefined, { "X-Babel-Pdf-Import-Id": id })), { code: "PDF_IMPORT_IN_PROGRESS", status: 409 });
  assert.equal(await readFile(original, "utf8"), "An existing unclaimed original.");
  assert.deepEqual(await readdir(path.join(root, "files")), [`${id}.pdf`]);
  assert.deepEqual(await (await library.list()).json(), { documents: [], folders: [] });
});

test("PDF import streams browser multipart boundaries and arbitrary PDF bytes without corruption", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "babel-pdf-stream-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const library = createPdfLibraryHandlers({ root: () => root });
  const boundary = "babel-pdf-boundary";
  const original = Buffer.concat([pdf, Buffer.from(`binary\r\n--${boundary}X1\x00\xff\r\nend`)]);
  for (const chunkSize of [1, 2, boundary.length, 127, 65536]) {
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\n中文标题\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="scan.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      original, Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const document = await decoded(await library.importPdf(chunked(body, boundary, chunkSize)));
    assert.equal(document.title, "中文标题");
    assert.equal(document.fileName, "scan.bin");
    assert.deepEqual(Buffer.from(await (await library.file(fileRequest(), document.id)).arrayBuffer()), original);
  }
});

test("PDF file responses support bounded, suffix and open byte ranges, HEAD and safe inline names", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "babel-pdf-range-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const library = createPdfLibraryHandlers({ root: () => root });
  const document = await decoded(await library.importPdf(upload()));
  const full = await library.file(fileRequest(), document.id);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("content-type"), "application/pdf");
  assert.equal(full.headers.get("accept-ranges"), "bytes");
  assert.equal(full.headers.get("x-content-type-options"), "nosniff");
  assert.match(full.headers.get("content-disposition")!, /^inline;.*filename\*=UTF-8''%E6/u);
  assert.equal(full.headers.get("content-length"), String(pdf.length));
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), pdf);
  for (const [range, start, end] of [["bytes=0-7", 0, 7], ["bytes=9-", 9, pdf.length - 1], ["bytes=-5", pdf.length - 5, pdf.length - 1], ["bytes=2-9999", 2, pdf.length - 1], ["bytes=-9999", 0, pdf.length - 1]] as const) {
    const response = await library.file(fileRequest({ range }), document.id);
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-range"), `bytes ${start}-${end}/${pdf.length}`);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), pdf.subarray(start, end + 1));
  }
  for (const range of ["bytes=-0", "bytes=-", "bytes=99999-", "bytes=3-2", "bytes=0-1,3-4", "items=0-1"]) {
    const response = await library.file(fileRequest({ range }), document.id);
    assert.equal(response.status, 416);
    assert.equal(response.headers.get("content-range"), `bytes */${pdf.length}`);
  }
  const head = await library.file(fileRequest({}, "HEAD"), document.id);
  assert.equal(head.headers.get("content-length"), String(pdf.length));
  assert.equal(await head.text(), "");
  const changed = await library.file(fileRequest({ range: "bytes=0-1", "if-range": '"different"' }), document.id);
  assert.equal(changed.status, 200);
  await changed.arrayBuffer();
  await writeFile(path.join(root, "files", `${document.id}.pdf`), "changed");
  await assert.rejects(library.file(fileRequest(), document.id), { code: "PDF_FILE_CHANGED" });
});

test("independent progress and annotation revisions prevent stale-window overwrites and survive restart", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "babel-pdf-revision-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const library = createPdfLibraryHandlers({ root: () => root });
  const document = await decoded(await library.importPdf(upload()));
  const annotation: PdfAnnotation = {
    id: randomUUID(), type: "highlight", page: 3, rects: [{ x: 0.1, y: 0.2, width: 0.5, height: 0.03 }],
    text: "可逆反应", comment: "复习", color: "#ffcc66", createdAt: new Date().toISOString(),
  };
  const progress = { page: 3, scale: 1.5, rotation: 90 };
  const progressed = await decoded(await library.patchProgress(patch({ revision: 0, progress }), document.id));
  assert.equal(progressed.progressRevision, 1);
  const annotated = await decoded(await library.patchAnnotations(patch({ revision: 0, annotations: [annotation] }), document.id));
  assert.equal(annotated.annotationsRevision, 1);
  assert.deepEqual(annotated.progress, progress);
  assert.deepEqual(annotated.annotations, [annotation]);
  await assert.rejects(library.patchProgress(patch({ revision: 0, progress: PDF_DEFAULT_PROGRESS }), document.id), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, "PDF_REVISION_CONFLICT");
    assert.deepEqual(error.details, { document: annotated });
    return true;
  });
  await assert.rejects(library.patchAnnotations(patch({ revision: 0, annotations: [] }), document.id), { code: "PDF_REVISION_CONFLICT" });
  const concurrent = await Promise.allSettled([
    library.patchAnnotations(patch({ revision: 1, annotations: [{ ...annotation, comment: "first" }] }), document.id),
    library.patchAnnotations(patch({ revision: 1, annotations: [] }), document.id),
  ]);
  assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
  const failure = concurrent.find((result) => result.status === "rejected") as PromiseRejectedResult;
  assert.equal(failure.reason.code, "PDF_REVISION_CONFLICT");
  const restarted = createPdfLibraryHandlers({ root: () => root });
  const loaded = await decoded(await restarted.getDocument(document.id));
  assert.equal(loaded.progressRevision, 1);
  assert.equal(loaded.annotationsRevision, 2);
  assert.deepEqual(loaded.progress, progress);
  assert.deepEqual(await readFile(path.join(root, "files", `${document.id}.pdf`)), pdf);
});

test("PDF deletion removes the original and its metadata without touching other apps or excerpt notes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "babel-pdf-delete-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const appRoot = path.join(root, "first", "pdf-library");
  const first = createPdfLibraryHandlers({ root: () => appRoot });
  const second = createPdfLibraryHandlers({ root: () => path.join(root, "second", "pdf-library") });
  const document = await decoded(await first.importPdf(upload()));
  const kept = await decoded(await first.importPdf(upload(pdf, "kept.pdf")));
  const otherApp = await decoded(await second.importPdf(upload()));
  const annotation: PdfAnnotation = {
    id: randomUUID(), type: "comment", page: 2, rects: [{ x: 0.1, y: 0.2, width: 0.5, height: 0.03 }],
    text: "Keep this excerpt", comment: "Copied into a note", color: "#ffcc66", createdAt: new Date().toISOString(),
  };
  await first.patchProgress(patch({ revision: 0, progress: { page: 2, scale: 1.5, rotation: 90 } }), document.id);
  await first.patchAnnotations(patch({ revision: 0, annotations: [annotation] }), document.id);
  const notes = path.join(root, "first", "notes");
  await mkdir(notes);
  await writeFile(path.join(notes, "excerpt.md"), "A previously saved excerpt.");
  await writeFile(path.join(notes, "excerpt.png"), "Copied screenshot bytes");
  await assert.rejects(second.deleteDocument(deletion(), document.id), { code: "PDF_NOT_FOUND" });
  await assert.rejects(first.deleteDocument(deletion({ origin: "http://localhost:3001" }), document.id), { code: "FORBIDDEN_ORIGIN" });
  for (const id of ["../metadata.sqlite", "..\\metadata.sqlite", "%2e%2e", "../../notes/excerpt.md", "id.pdf", "", randomUUID()]) {
    await assert.rejects(first.deleteDocument(deletion(), id), { code: "PDF_NOT_FOUND" });
  }
  const response = await first.deleteDocument(deletion({ origin: "http://127.0.0.1:3000" }), document.id);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(await response.text(), "");
  await assert.rejects(readFile(path.join(appRoot, "files", `${document.id}.pdf`)), { code: "ENOENT" });
  await assert.rejects(first.getDocument(document.id), { code: "PDF_NOT_FOUND" });
  await assert.rejects(first.file(fileRequest(), document.id), { code: "PDF_NOT_FOUND" });
  await assert.rejects(first.deleteDocument(deletion(), document.id), { code: "PDF_NOT_FOUND" });
  assert.deepEqual((await (await first.list()).json() as { documents: PdfDocument[] }).documents.map((entry) => entry.id), [kept.id]);
  assert.equal((await decoded(await second.getDocument(otherApp.id))).id, otherApp.id);
  assert.equal(await readFile(path.join(notes, "excerpt.md"), "utf8"), "A previously saved excerpt.");
  assert.equal(await readFile(path.join(notes, "excerpt.png"), "utf8"), "Copied screenshot bytes");
  assert.deepEqual(await readdir(path.join(appRoot, "files")), [`${kept.id}.pdf`]);
  const metadata = new Database(path.join(appRoot, "metadata.sqlite"), { readonly: true });
  assert.equal(metadata.prepare("SELECT * FROM pdf_documents WHERE id = ?").get(document.id), undefined);
  assert.equal(metadata.pragma("integrity_check", { simple: true }), "ok");
  metadata.close();
  const restarted = createPdfLibraryHandlers({ root: () => appRoot });
  await assert.rejects(restarted.getDocument(document.id), { code: "PDF_NOT_FOUND" });
});

test("deleted PDFs cannot be resurrected by delayed progress or annotation writes while open readers can finish", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "babel-pdf-delete-race-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const library = createPdfLibraryHandlers({ root: () => root });
  const staleWindow = createPdfLibraryHandlers({ root: () => root });
  const document = await decoded(await library.importPdf(upload()));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  t.after(release);
  function delayed(body: unknown) {
    const stream = new ReadableStream<Uint8Array>({ async start(controller) {
      await gate;
      controller.enqueue(Buffer.from(JSON.stringify(body)));
      controller.close();
    } });
    return new Request("http://localhost:3000/api/pdf/documents/id/progress", { method: "PATCH", body: stream, duplex: "half" } as RequestInit);
  }
  const writes = Promise.allSettled([
    staleWindow.patchProgress(delayed({ revision: 0, progress: PDF_DEFAULT_PROGRESS }), document.id),
    staleWindow.patchAnnotations(delayed({ revision: 0, annotations: [] }), document.id),
  ]);
  const reader = await staleWindow.file(fileRequest({ range: "bytes=0-7" }), document.id);
  assert.equal((await library.deleteDocument(deletion(), document.id)).status, 204);
  release();
  for (const result of await writes) {
    assert.equal(result.status, "rejected");
    assert.equal((result as PromiseRejectedResult).reason.code, "PDF_NOT_FOUND");
  }
  assert.deepEqual(Buffer.from(await reader.arrayBuffer()), pdf.subarray(0, 8));
  assert.deepEqual(await (await library.list()).json(), { documents: [], folders: [] });
  assert.deepEqual(await readdir(path.join(root, "files")), []);
  const concurrent = await decoded(await library.importPdf(upload()));
  const results = await Promise.allSettled([library.deleteDocument(deletion(), concurrent.id), staleWindow.deleteDocument(deletion(), concurrent.id)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal((results.find((result) => result.status === "rejected") as PromiseRejectedResult).reason.code, "PDF_NOT_FOUND");
});

test("PDF deletion restores a staged original if the metadata transaction fails and can remove missing originals", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "babel-pdf-delete-rollback-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const library = createPdfLibraryHandlers({ root: () => root });
  const document = await decoded(await library.importPdf(upload()));
  const metadata = new Database(path.join(root, "metadata.sqlite"));
  metadata.exec("CREATE TRIGGER reject_pdf_delete BEFORE DELETE ON pdf_documents BEGIN SELECT RAISE(ABORT, 'test failure'); END");
  metadata.close();
  await assert.rejects(library.deleteDocument(deletion(), document.id), { code: "PDF_LIBRARY_UNAVAILABLE" });
  assert.deepEqual(await decoded(await library.getDocument(document.id)), document);
  assert.deepEqual(await readFile(path.join(root, "files", `${document.id}.pdf`)), pdf);
  assert.deepEqual(await readdir(path.join(root, "files")), [`${document.id}.pdf`]);
  const repaired = new Database(path.join(root, "metadata.sqlite"));
  repaired.exec("DROP TRIGGER reject_pdf_delete");
  repaired.close();
  await unlink(path.join(root, "files", `${document.id}.pdf`));
  assert.equal((await library.deleteDocument(deletion(), document.id)).status, 204);
  await assert.rejects(library.getDocument(document.id), { code: "PDF_NOT_FOUND" });
});

test("PDF deletion and reading reject a symlinked files directory without touching its target", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "babel-pdf-delete-link-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const library = createPdfLibraryHandlers({ root: () => path.join(root, "library") });
  const document = await decoded(await library.importPdf(upload()));
  const files = path.join(root, "library", "files");
  const keptFiles = path.join(root, "library", "kept-files");
  const target = path.join(root, "other-app-files");
  await mkdir(target);
  await writeFile(path.join(target, `${document.id}.pdf`), pdf);
  await rename(files, keptFiles);
  try { await symlink(target, files, process.platform === "win32" ? "junction" : "dir"); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EPERM") { t.skip("Creating directory links requires additional filesystem permission."); return; }
    throw error;
  }
  await assert.rejects(library.deleteDocument(deletion(), document.id), { code: "PDF_LIBRARY_UNAVAILABLE" });
  await assert.rejects(library.file(fileRequest(), document.id), { code: "PDF_NOT_FOUND" });
  assert.deepEqual(await readFile(path.join(target, `${document.id}.pdf`)), pdf);
  assert.deepEqual(await decoded(await library.getDocument(document.id)), document);
  await unlink(files);
  await rename(keptFiles, files);
  assert.equal((await library.deleteDocument(deletion(), document.id)).status, 204);
  assert.deepEqual(await readFile(path.join(target, `${document.id}.pdf`)), pdf);
});

test("PDF deletion never recursively removes a non-file original", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "babel-pdf-delete-directory-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const library = createPdfLibraryHandlers({ root: () => root });
  const document = await decoded(await library.importPdf(upload()));
  const original = path.join(root, "files", `${document.id}.pdf`);
  await unlink(original);
  await mkdir(original);
  await writeFile(path.join(original, "keep.txt"), "Never recursively delete this.");
  await assert.rejects(library.deleteDocument(deletion(), document.id), { code: "PDF_LIBRARY_UNAVAILABLE" });
  assert.equal(await readFile(path.join(original, "keep.txt"), "utf8"), "Never recursively delete this.");
  assert.deepEqual(await decoded(await library.getDocument(document.id)), document);
});

test("PDF writes enforce same-origin, body limits, magic bytes, multipart structure and cleanup", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "babel-pdf-invalid-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const library = createPdfLibraryHandlers({ root: () => root });
  const document = await decoded(await library.importPdf(upload()));
  await assert.rejects(library.importPdf(upload(pdf, "a.pdf", undefined, { origin: "http://localhost:3001" })), { code: "FORBIDDEN_ORIGIN" });
  await assert.rejects(library.patchProgress(patch({ revision: 0, progress: PDF_DEFAULT_PROGRESS }, { origin: "https://example.test" }), document.id), { code: "FORBIDDEN_ORIGIN" });
  await assert.rejects(library.patchAnnotations(patch({ revision: 0, annotations: [] }, { origin: "http://localhost:3001" }), document.id), { code: "FORBIDDEN_ORIGIN" });
  await assert.rejects(library.importPdf(upload("not a pdf")), { code: "INVALID_PDF" });
  await assert.rejects(library.importPdf(upload("")), { code: "EMPTY_PDF" });
  await assert.rejects(library.importPdf(upload(pdf, "a.pdf", " ")), { code: "VALIDATION_ERROR" });
  await assert.rejects(library.importPdf(upload(pdf, "a.pdf", "x".repeat(241))), { code: "VALIDATION_ERROR" });
  await assert.rejects(library.importPdf(upload(pdf, "a.pdf", undefined, { "content-length": String(PDF_MAX_FILE_BYTES + 65537) })), { code: "PDF_BODY_TOO_LARGE" });
  await assert.rejects(library.patchAnnotations(patch({ revision: 0, annotations: [] }, { "content-length": String(4 * 1024 * 1024 + 1) }), document.id), { code: "PDF_BODY_TOO_LARGE" });
  const boundary = "invalid-pdf-boundary";
  for (const body of [
    "not multipart", `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="../private.pdf"\r\n\r\n${pdf}\r\n--${boundary}--\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.pdf"\r\n\r\n${pdf}`,
    `--${boundary}\r\nContent-Disposition: form-data; name="unknown"\r\n\r\nextra\r\n--${boundary}--\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.pdf"\r\n\r\n${pdf}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="b.pdf"\r\n\r\n${pdf}\r\n--${boundary}--\r\n`,
  ]) await assert.rejects(library.importPdf(chunked(Buffer.from(body), boundary, 3)), (error: unknown) => error instanceof ApiError && error.status === 400);
  await assert.rejects(library.patchProgress(patch({ revision: 0, progress: { page: 0, scale: 1, rotation: 0 } }), document.id), { code: "VALIDATION_ERROR" });
  await assert.rejects(library.patchProgress(patch({ revision: -1, progress: PDF_DEFAULT_PROGRESS }), document.id), { code: "VALIDATION_ERROR" });
  await assert.rejects(library.patchAnnotations(patch({ revision: 0, annotations: [{}] }), document.id), { code: "VALIDATION_ERROR" });
  const files = await readdir(path.join(root, "files"));
  assert.deepEqual(files, [`${document.id}.pdf`]);
  const { handleApi } = createHttpErrorHandlers({ errorStatuses: {}, imageErrorStatuses: {}, isImageStorageError: (error): error is { code: never; message: string } => { void error; return false; } });
  const errorResponse = await handleApi(() => library.importPdf(upload("no")));
  assert.equal(errorResponse.status, 415);
  assert.deepEqual(await errorResponse.json(), { error: { code: "INVALID_PDF", message: "The selected file does not have a valid PDF header." } });
});

test("stream limits cannot be bypassed without Content-Length and canceled imports leave no file", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "babel-pdf-byte-limit-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const library = createPdfLibraryHandlers({ root: () => root });
  // A single oversized chunk is rejected before buffering or writing any data.
  // The array's zero-filled pages are never traversed by this test.
  const oversized = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(new Uint8Array(PDF_MAX_FILE_BYTES + 64 * 1024 + 1));
    controller.close();
  } });
  const hugeRequest = new Request("http://localhost:3000/api/pdf/documents", {
    method: "POST", headers: { "content-type": "multipart/form-data; boundary=test" }, body: oversized, duplex: "half",
  } as RequestInit);
  await assert.rejects(library.importPdf(hugeRequest), { code: "PDF_TOO_LARGE" });
  const controller = new AbortController();
  controller.abort();
  const canceled = new Request(upload(), { signal: controller.signal });
  await assert.rejects(library.importPdf(canceled), { code: "PDF_UPLOAD_CANCELED" });
  assert.deepEqual(await readdir(path.join(root, "files")), []);
  const document = await decoded(await library.importPdf(upload()));
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(new Uint8Array(4 * 1024 * 1024 + 1));
    controller.close();
  } });
  const hugePatch = new Request("http://localhost:3000/api/pdf/documents/id/annotations", { method: "PATCH", body, duplex: "half" } as RequestInit);
  await assert.rejects(library.patchAnnotations(hugePatch, document.id), { code: "PDF_BODY_TOO_LARGE" });
  assert.deepEqual((await decoded(await library.getDocument(document.id))).annotations, []);
});
