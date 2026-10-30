import assert from "node:assert/strict";
import test from "node:test";

import {
  DOCUMENT_IMPORT_MAX_BYTES,
  DOCUMENT_IMPORT_MAX_MARKDOWN_BYTES,
  type ImportedOriginalDocument,
} from "../src/imports/document-core";
import {
  convertDocumentFile,
  prepareDocumentImportDraft,
  saveWithImportedOriginal,
  validateDocumentImportFile,
} from "../src/imports/document-client";

const token = "12345678-1234-4567-89ab-123456789abc";
const placeholder = `babel-original://${token}`;
const savedUrl = `/api/imports/documents/originals/${"a".repeat(64)}`;

function sourceFile(name = "source.docx"): File {
  return new File(["test source"], name, { type: "application/octet-stream" });
}

function original(): ImportedOriginalDocument {
  return { file: sourceFile(), token };
}

test("document chooser validates format, empty input, source name and size before uploading", () => {
  for (const name of ["REPORT.DOCX", "slides.pptx", "sheet.xlsx", "old.xls", "book.epub", "page.htm", "data.xml"]) {
    assert.doesNotThrow(() => validateDocumentImportFile(sourceFile(name)));
  }
  assert.throws(() => validateDocumentImportFile(sourceFile("notes.exe")), /supported/u);
  assert.throws(() => validateDocumentImportFile(new File([], "empty.txt")), /empty/u);
  assert.throws(() => validateDocumentImportFile(sourceFile("../source.docx")), /name/u);
  assert.throws(() => validateDocumentImportFile(sourceFile(`${"文".repeat(80)}.txt`)), /UTF-8/u);
  const oversized = sourceFile();
  Object.defineProperty(oversized, "size", { value: DOCUMENT_IMPORT_MAX_BYTES + 1 });
  assert.throws(() => validateDocumentImportFile(oversized), /50 MiB/u);
});

test("conversion sends only local file bytes with an encoded name and cancellable request", async context => {
  const source = sourceFile("报告 #1.docx");
  const signal = new AbortController().signal;
  const result = { markdown: "# Converted", title: "Converted", warnings: ["Review tables"], sdkVersion: "0.1.5" };
  const requests: { url: unknown; init?: RequestInit }[] = [];
  context.mock.method(globalThis, "fetch", async (url: unknown, init?: RequestInit) => {
    requests.push({ url, init });
    return Response.json(result);
  });
  assert.deepEqual(await convertDocumentFile(source, signal), result);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/imports/documents");
  assert.equal(requests[0].init?.body, source);
  assert.equal(requests[0].init?.signal, signal);
  const headers = new Headers(requests[0].init?.headers);
  assert.equal(headers.get("Content-Type"), "application/octet-stream");
  assert.equal(decodeURIComponent(headers.get("X-Babel-File-Name")!), source.name);
});

test("conversion surfaces server errors, invalid results and cancellation", async context => {
  const fetchMock = context.mock.method(globalThis, "fetch", async () => Response.json(
    { error: { code: "DOCUMENT_SDK_UNAVAILABLE", message: "Install the local SDK first." } },
    { status: 503 },
  ));
  await assert.rejects(convertDocumentFile(sourceFile()), /Install the local SDK first/u);
  fetchMock.mock.mockImplementation(async () => Response.json({ markdown: "content", warnings: [] }));
  await assert.rejects(convertDocumentFile(sourceFile()), /invalid result/u);
  fetchMock.mock.mockImplementation(async () => { throw new DOMException("Cancelled", "AbortError"); });
  await assert.rejects(convertDocumentFile(sourceFile()), { name: "AbortError" });
});

test("conversion and edited drafts enforce UTF-8 Markdown size, including the optional source link", async context => {
  context.mock.method(globalThis, "fetch", async () => Response.json({
    markdown: "字".repeat(Math.ceil(DOCUMENT_IMPORT_MAX_MARKDOWN_BYTES / 3)),
    title: null, warnings: [], sdkVersion: "test",
  }));
  await assert.rejects(convertDocumentFile(sourceFile()), /10 MiB/u);
  const nearLimit = "x".repeat(DOCUMENT_IMPORT_MAX_MARKDOWN_BYTES);
  assert.equal(prepareDocumentImportDraft({
    file: sourceFile(), markdown: nearLimit, title: "Title", keepOriginal: false, token,
  }).file.size, DOCUMENT_IMPORT_MAX_MARKDOWN_BYTES);
  assert.throws(() => prepareDocumentImportDraft({
    file: sourceFile(), markdown: nearLimit, title: "Title", keepOriginal: true, token,
  }), /10 MiB/u);
});

test("preview creates an editable Markdown draft and optional escaped original link without uploading", async context => {
  const fetchMock = context.mock.method(globalThis, "fetch", async () => { throw new Error("Must not upload during preview"); });
  const plain = prepareDocumentImportDraft({
    file: sourceFile(), markdown: "Edited text\n", title: "  New title  ", keepOriginal: false, token,
  });
  assert.equal(plain.file.name, "New title.md");
  assert.equal(await plain.file.text(), "Edited text\n");
  assert.equal(plain.original, undefined);
  const source = sourceFile("report [final].docx");
  const attached = prepareDocumentImportDraft({
    file: source, markdown: "Edited text\n", title: "New title", keepOriginal: true, token,
  });
  assert.equal(attached.original?.file, source);
  assert.equal(attached.original?.token, token);
  assert.equal(await attached.file.text(), `Edited text\n\n[Original file: report \\[final\\].docx](${placeholder})\n`);
  assert.equal(fetchMock.mock.callCount(), 0);
  for (const title of ["", "../title", "bad\\title", "line\nbreak", "x".repeat(241)]) {
    assert.throws(() => prepareDocumentImportDraft({ file: source, markdown: "Text", title, keepOriginal: false, token }), /title/u);
  }
});

test("saving uploads the opted-in original once and replaces every matching draft link", async context => {
  const source = original();
  const fetchMock = context.mock.method(globalThis, "fetch", async (url: unknown, init?: RequestInit) => {
    assert.equal(url, "/api/imports/documents/originals");
    assert.equal(init?.body, source.file);
    return Response.json({ url: savedUrl });
  });
  const content = `[One](${placeholder}) [Two](${placeholder})`;
  const saved = await saveWithImportedOriginal(content, source, async markdown => ({ id: 1, markdown }));
  assert.equal(saved.markdown, `[One](${savedUrl}) [Two](${savedUrl})`);
  assert.equal(source.savedUrl, savedUrl);
  await saveWithImportedOriginal(content, source, async markdown => markdown);
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("removing the original link skips the upload; a longer unrelated token does not match", async context => {
  const fetchMock = context.mock.method(globalThis, "fetch", async () => { throw new Error("Must not upload"); });
  assert.equal(await saveWithImportedOriginal("Plain text", original(), async markdown => markdown), "Plain text");
  assert.equal(await saveWithImportedOriginal("Plain text", undefined, async markdown => markdown), "Plain text");
  const editedLink = `[Other](${placeholder}a)`;
  assert.equal(await saveWithImportedOriginal(editedLink, original(), async markdown => markdown), editedLink);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("failed note saves keep the original URL for retry and do not delete a possibly referenced attachment", async context => {
  const source = original();
  const fetchMock = context.mock.method(globalThis, "fetch", async () => Response.json({ url: savedUrl }));
  await assert.rejects(saveWithImportedOriginal(placeholder, source, async () => { throw new Error("Save interrupted"); }), /Save interrupted/u);
  assert.equal(source.savedUrl, savedUrl);
  assert.equal(await saveWithImportedOriginal(placeholder, source, async markdown => markdown), savedUrl);
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("source link expansion over the note limit is rejected before uploading the original", async context => {
  const fetchMock = context.mock.method(globalThis, "fetch", async () => { throw new Error("Must not upload"); });
  let saves = 0;
  const content = `${"x".repeat(DOCUMENT_IMPORT_MAX_MARKDOWN_BYTES - placeholder.length)}${placeholder}`;
  await assert.rejects(saveWithImportedOriginal(content, original(), async markdown => {
    saves += 1; return markdown;
  }), /10 MiB/u);
  assert.equal(fetchMock.mock.callCount(), 0);
  assert.equal(saves, 0);
});

test("invalid upload locations and upload failures never invoke the note save callback", async context => {
  let saves = 0;
  const save = async (markdown: string) => { saves += 1; return markdown; };
  const fetchMock = context.mock.method(globalThis, "fetch", async () => Response.json({ url: "https://example.com/source.docx" }));
  await assert.rejects(saveWithImportedOriginal(placeholder, original(), save), /invalid original file location/u);
  fetchMock.mock.mockImplementation(async () => Response.json({ url: `/api/imports/documents/originals/${"a".repeat(63)}` }));
  await assert.rejects(saveWithImportedOriginal(placeholder, original(), save), /invalid original file location/u);
  fetchMock.mock.mockImplementation(async () => Response.json({ error: { message: "Upload failed" } }, { status: 500 }));
  await assert.rejects(saveWithImportedOriginal(placeholder, original(), save), /Upload failed/u);
  await assert.rejects(saveWithImportedOriginal(placeholder, { ...original(), savedUrl: "//outside/source" }, save), /location is invalid/u);
  assert.equal(saves, 0);
});
