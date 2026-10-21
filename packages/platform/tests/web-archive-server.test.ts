import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createDocumentImportHandlers } from "../src/imports/document-server";
import { WEB_ARCHIVE_MAX_BYTES } from "../src/imports/web-archive-core";
import { readWebArchiveBytes } from "../src/imports/web-archive-server";
import { archiveFixture, archivePng } from "./web-archive-fixture";

function upload(value: unknown = archiveFixture(), headers: Record<string, string> = {}): Request {
  return new Request("http://localhost:3000/api/imports/web-archive/snapshots", {
    method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000", ...headers },
    body: JSON.stringify(value),
  });
}

test("archives persist immutably across concurrent retries and return only a sandboxed offline snapshot", async context => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "babel-web-archive-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const handlers = createDocumentImportHandlers({ originalRoot: () => directory });
  const responses = await Promise.all([handlers.saveWebArchive(upload()), handlers.saveWebArchive(upload())]);
  const first = await responses[0].json() as { url: string };
  assert.equal(responses[0].status, 201);
  assert.deepEqual(await responses[1].json(), first);
  assert.match(first.url, /^\/api\/imports\/web-archive\/snapshots\/[a-f0-9]{64}$/u);
  const id = first.url.split("/").at(-1)!;
  assert.deepEqual(await readdir(directory), ["web-archives"]);
  assert.deepEqual(await readdir(path.join(directory, "web-archives")), [id]);
  const savedPath = path.join(directory, "web-archives", id, "archive.json");
  const bytes = await readFile(savedPath);
  assert.deepEqual(JSON.parse(bytes.toString("utf8")), archiveFixture());
  const restarted = createDocumentImportHandlers({ originalRoot: () => directory });
  const response = await restarted.readWebArchive(id);
  assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  const policy = response.headers.get("content-security-policy")!;
  for (const directive of ["default-src 'none'", "script-src 'none'", "connect-src 'none'", "img-src data:", "style-src 'unsafe-inline'", "font-src 'none'", "base-uri 'none'", "form-action 'none'", "sandbox"]) assert.ok(policy.split("; ").includes(directive), directive);
  assert.doesNotMatch(policy, /allow-scripts|allow-same-origin/u);
  const html = await response.text();
  assert.ok(html.includes(`src="data:image/png;base64,${archivePng}"`));
  assert.doesNotMatch(html, /<script|src="https?:|<iframe/u);
  const changed = archiveFixture(); changed.markdown += "Changed original";
  const other = await (await handlers.saveWebArchive(upload(changed))).json() as { url: string };
  assert.notEqual(other.url, first.url);
  assert.deepEqual(await readFile(savedPath), bytes, "a later save never changes an earlier archive");
});

test("archive writes enforce origin and validation before storage; reads cannot cross APP roots or accept tampering", async context => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "babel-web-archive-isolation-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const first = createDocumentImportHandlers({ originalRoot: () => path.join(directory, "first") });
  const second = createDocumentImportHandlers({ originalRoot: () => path.join(directory, "second") });
  await assert.rejects(first.saveWebArchive(upload(undefined, { origin: "http://localhost:3001" })), { code: "FORBIDDEN_ORIGIN" });
  await assert.rejects(first.saveWebArchive(upload(undefined, { origin: "https://example.test" })), { code: "FORBIDDEN_ORIGIN" });
  const hostile = archiveFixture(); hostile.snapshot.tree = { tag: "script", children: ["alert(1)"] };
  await assert.rejects(first.saveWebArchive(upload(hostile)), { code: "INVALID_WEB_ARCHIVE" });
  assert.deepEqual(await readdir(directory), [], "rejected content creates no archive directory");
  const saved = await (await first.saveWebArchive(upload())).json() as { url: string };
  const id = saved.url.split("/").at(-1)!;
  await assert.rejects(second.readWebArchive(id), { code: "WEB_ARCHIVE_NOT_FOUND" });
  for (const invalid of ["../archive.json", "..", "a".repeat(63), "A".repeat(64), "z".repeat(64)]) {
    await assert.rejects(first.readWebArchive(invalid), { code: "WEB_ARCHIVE_NOT_FOUND" });
  }
  const location = path.join(directory, "first", "web-archives", id, "archive.json");
  await writeFile(location, JSON.stringify({ ...archiveFixture(), title: "Tampered after saving" }));
  await assert.rejects(first.readWebArchive(id), { code: "WEB_ARCHIVE_NOT_FOUND" });
  await assert.rejects(first.saveWebArchive(upload()), "a retry must not silently trust or overwrite corrupted content");
  assert.deepEqual(await readdir(path.dirname(path.dirname(location))), [id], "failed retries clean only their own temporary directory");
});

test("archive byte reader bounds declared and streamed lengths and cancels pending reads", async () => {
  const empty = new Request("http://localhost:3000", { method: "POST", body: "" });
  await assert.rejects(readWebArchiveBytes(empty), { code: "EMPTY_WEB_ARCHIVE" });
  await assert.rejects(readWebArchiveBytes(upload(undefined, { "content-length": String(WEB_ARCHIVE_MAX_BYTES + 1) })), { code: "WEB_ARCHIVE_TOO_LARGE" });
  let canceled = false;
  const chunk = new Uint8Array(10 * 1024 * 1024);
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(chunk); },
    cancel() { canceled = true; },
  });
  const request = new Request("http://localhost:3000", { method: "POST", headers: { "content-length": "1" }, body: stream, duplex: "half" } as RequestInit);
  await assert.rejects(readWebArchiveBytes(request), { code: "WEB_ARCHIVE_TOO_LARGE" });
  assert.equal(canceled, true);
  const controller = new AbortController();
  const hanging = new Request("http://localhost:3000", {
    method: "POST", signal: controller.signal, duplex: "half", body: new ReadableStream<Uint8Array>(),
  } as RequestInit);
  const reading = readWebArchiveBytes(hanging);
  controller.abort();
  await assert.rejects(reading, { code: "WEB_ARCHIVE_CANCELED" });
  assert.deepEqual(await readWebArchiveBytes(upload()), Buffer.from(JSON.stringify(archiveFixture())));
});
