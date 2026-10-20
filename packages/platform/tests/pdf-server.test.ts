import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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

async function decoded(response: Response): Promise<PdfDocument> {
  return ((await response.json()) as { document: PdfDocument }).document;
}

test("PDF library keeps immutable originals and independent application-owned metadata", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "babel-pdf-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const appRoot = path.join(root, "first");
  const first = createPdfLibraryHandlers({ root: () => appRoot });
  const second = createPdfLibraryHandlers({ root: () => path.join(root, "second") });
  assert.deepEqual(await (await first.list()).json(), { documents: [] });
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
  assert.deepEqual(await (await second.list()).json(), { documents: [] });
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
