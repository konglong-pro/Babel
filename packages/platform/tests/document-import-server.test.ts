import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { DOCUMENT_IMPORT_MAX_BYTES, documentImportExtension } from "../src/imports/document-core";
import {
  createDocumentImportHandlers,
  readDocumentBytes,
  readDocumentFileName,
  runDocumentWorker,
  validateConversionResult,
} from "../src/imports/document-server";

function upload(name = "notes.txt", content: BodyInit = "hello", headers: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/imports/documents", {
    method: "POST",
    headers: { "x-babel-file-name": encodeURIComponent(name), "content-type": "application/octet-stream", ...headers },
    body: content,
  });
}

test("document upload accepts selected formats and rejects paths, header injection and invalid encodings", () => {
  for (const name of ["笔记.docx", "note.PDF", "slides.pptx", "book.epub", "table.xls", "table.xlsx", "a.html", "a.htm", "a.txt", "a.csv", "a.json", "a.xml"]) {
    assert.equal(readDocumentFileName(upload(name)), name);
    assert.ok(documentImportExtension(name));
  }
  for (const name of ["../a.txt", "C:\\a.txt", "a\r\n.txt", "", "a/notes.txt", `${"中".repeat(90)}.txt`]) {
    assert.throws(() => readDocumentFileName(upload(name)), { code: "INVALID_FILE_NAME" });
  }
  assert.throws(() => readDocumentFileName(upload("a.txt", "x", { "x-babel-file-name": "%invalid" })), { code: "INVALID_FILE_NAME" });
  for (const name of ["a.exe", "a.zip", "a.doc", "scan.png", "a.md"]) {
    assert.throws(() => readDocumentFileName(upload(name)), { code: "UNSUPPORTED_DOCUMENT" });
  }
});

test("source body is byte counted even without Content-Length", async () => {
  assert.equal((await readDocumentBytes(upload())).toString(), "hello");
  await assert.rejects(readDocumentBytes(upload("a.txt", "", { "content-length": "0" })), { code: "EMPTY_DOCUMENT" });
  await assert.rejects(readDocumentBytes(upload("a.txt", "x", { "content-length": String(DOCUMENT_IMPORT_MAX_BYTES + 1) })), { code: "DOCUMENT_TOO_LARGE" });
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(DOCUMENT_IMPORT_MAX_BYTES));
      controller.enqueue(new Uint8Array([1]));
      controller.close();
    },
  });
  const request = new Request("http://localhost:3000", { method: "POST", body: stream, duplex: "half" } as RequestInit);
  await assert.rejects(readDocumentBytes(request), { code: "DOCUMENT_TOO_LARGE" });
});

test("conversion result rejects empty, malformed and oversized Markdown", () => {
  const result = { markdown: "# Hello 世界", title: null, warnings: ["Review tables"], sdkVersion: "0.1.6b2" };
  assert.deepEqual(validateConversionResult(result), result);
  assert.throws(() => validateConversionResult({ ...result, markdown: " \n " }), { code: "NO_EXTRACTABLE_TEXT" });
  assert.throws(() => validateConversionResult({ ...result, warnings: [false] }), { code: "INVALID_CONVERSION" });
  assert.throws(() => validateConversionResult({ ...result, title: 1 }), { code: "INVALID_CONVERSION" });
  assert.throws(() => validateConversionResult({ ...result, markdown: "中".repeat(4 * 1024 * 1024) }), { code: "MARKDOWN_TOO_LARGE" });
});

test("originals are immutable, idempotent, private to the APP root and served only as downloads", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "babel-original-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = createDocumentImportHandlers({ originalRoot: () => path.join(root, "first") });
  const second = createDocumentImportHandlers({ originalRoot: () => path.join(root, "second") });
  const responses = await Promise.all([first.saveOriginal(upload("笔记.txt", "原文")), first.saveOriginal(upload("笔记.txt", "原文"))]);
  const saved = await responses[0].json() as { url: string };
  assert.deepEqual(await responses[1].json(), saved);
  assert.match(saved.url, /^\/api\/imports\/documents\/originals\/[a-f0-9]{64}$/u);
  const id = saved.url.split("/").at(-1)!;
  assert.deepEqual(await readdir(path.join(root, "first")), [id]);
  const original = await first.readOriginal(id);
  assert.equal(await original.text(), "原文");
  assert.equal(original.headers.get("content-type"), "application/octet-stream");
  assert.equal(original.headers.get("x-content-type-options"), "nosniff");
  assert.match(original.headers.get("content-disposition")!, /attachment;.*filename\*=UTF-8''%E7/u);
  await assert.rejects(second.readOriginal(id), { code: "ORIGINAL_NOT_FOUND" });
  await assert.rejects(first.readOriginal("../source"), { code: "ORIGINAL_NOT_FOUND" });
  await assert.rejects(first.saveOriginal(upload("a.txt", "x", { origin: "http://localhost:3001" })), { code: "FORBIDDEN_ORIGIN" });
  const renamed = await (await first.saveOriginal(upload("different.txt", "原文"))).json() as { url: string };
  assert.notEqual(renamed.url, saved.url);
});

function availablePython(): string | undefined {
  const candidates = [process.env.BABEL_MARKITDOWN_PYTHON, ...(process.platform === "win32" ? ["C:\\Program Files\\Python311\\python.exe", "python.exe"] : ["python3", "python"])];
  return candidates.find((candidate) => candidate && spawnSync(candidate, ["--version"], { windowsHide: true, encoding: "utf8" }).status === 0);
}

test("worker lifecycle propagates errors, cancellation and timeouts and cleans staged source files", async (t) => {
  const python = availablePython();
  if (!python) { t.skip("Python is optional; install the converter to run worker lifecycle tests."); return; }
  const root = await mkdtemp(path.join(os.tmpdir(), "babel-worker-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const worker = path.join(root, "worker.py");
  const tracker = path.join(root, "input-path.txt");
  await writeFile(worker, `import sys,json,time,pathlib
if sys.argv[1] == '--probe':
 print(json.dumps({'ready':True,'sdkVersion':'fixture'}))
else:
 source=pathlib.Path(sys.argv[1])
 pathlib.Path(${JSON.stringify(tracker)}).write_text(str(source),encoding='utf-8')
 mode=source.read_text(encoding='utf-8')
 if mode=='slow': time.sleep(10)
 if mode=='invalid': print('invalid json')
 elif mode=='fail':
  print(json.dumps({'error':{'code':'ENCRYPTED_DOCUMENT','message':'Password protected'}}));sys.exit(1)
 else: print(json.dumps({'markdown':'# '+mode,'title':None,'warnings':[],'sdkVersion':'fixture'}))
`, "utf8");
  const runtime = { python, worker };
  const handlers = createDocumentImportHandlers({ originalRoot: () => path.join(root, "originals"), resolveRuntime: async () => runtime });
  assert.deepEqual(await (await handlers.capability()).json(), { ready: true, sdkVersion: "fixture" });
  assert.equal((await (await handlers.convert(upload())).json()).markdown, "# hello");
  const stagedPath = await readFile(tracker, "utf8");
  await assert.rejects(access(path.dirname(stagedPath)));
  await assert.rejects(handlers.convert(upload("a.txt", "fail")), { code: "ENCRYPTED_DOCUMENT" });
  await assert.rejects(handlers.convert(upload("a.txt", "invalid")), { code: "CONVERSION_FAILED" });
  await assert.rejects(handlers.convert(upload("a.txt", "hello", { origin: "https://example.com" })), { code: "FORBIDDEN_ORIGIN" });
  const slow = path.join(root, "slow.txt");
  await writeFile(slow, "slow");
  await assert.rejects(runDocumentWorker(runtime, [slow, ".txt"], undefined, 40), { code: "CONVERSION_TIMEOUT" });
  const controller = new AbortController();
  const canceled = runDocumentWorker(runtime, [slow, ".txt"], controller.signal);
  controller.abort();
  await assert.rejects(canceled, { code: "CONVERSION_CANCELED" });
  await assert.rejects(runDocumentWorker({ python: path.join(root, "missing"), worker }, ["--probe"]), { code: "SDK_UNAVAILABLE" });
});
