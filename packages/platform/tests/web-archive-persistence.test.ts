import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { saveWithImportedOriginal } from "../src/imports/document-client";
import { DOCUMENT_IMPORT_MAX_MARKDOWN_BYTES, type ImportedOriginalDocument } from "../src/imports/document-core";
import { createDocumentImportHandlers } from "../src/imports/document-server";
import { prepareWebArchiveImport } from "../src/imports/web-archive-client";
import { WEB_ARCHIVE_MAX_BYTES } from "../src/imports/web-archive-core";
import { archiveFixture, archivePng } from "./web-archive-fixture";

test("saving a real archive draft uploads its immutable snapshot once and retains it after a note-save retry", async context => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "babel-web-archive-save-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const prepared = prepareWebArchiveImport(archiveFixture());
  const content = await prepared.file.text();
  const handlers = createDocumentImportHandlers({ originalRoot: () => directory });
  const fetch = context.mock.method(globalThis, "fetch", async (url: unknown, init?: RequestInit) => {
    assert.equal(url, "/api/imports/web-archive/snapshots");
    assert.equal(init?.body, prepared.original.file);
    const headers = new Headers(init?.headers);
    assert.equal(decodeURIComponent(headers.get("x-babel-file-name")!), "capture.babel.json");
    return handlers.saveWebArchive(new Request(`http://localhost:3000${url}`, init));
  });
  await assert.rejects(saveWithImportedOriginal(content, prepared.original, async () => { throw new Error("Note save interrupted"); }), /Note save interrupted/u);
  const location = prepared.original.savedUrl!;
  assert.match(location, /^\/api\/imports\/web-archive\/snapshots\/[a-f0-9]{64}$/u);
  const saved = await saveWithImportedOriginal(content, prepared.original, async markdown => markdown);
  assert.ok(saved.includes(`[View original layout](${location})`));
  assert.doesNotMatch(saved, /babel-original:/u);
  assert.equal(fetch.mock.callCount(), 1);
  const id = location.split("/").at(-1)!;
  assert.deepEqual(await readdir(path.join(directory, "web-archives")), [id]);
  const response = await createDocumentImportHandlers({ originalRoot: () => directory }).readWebArchive(id);
  assert.ok((await response.text()).includes(`data:image/png;base64,${archivePng}`));
});

test("removed source links skip persistence and archive/document URL kinds cannot be confused", async context => {
  const prepared = prepareWebArchiveImport(archiveFixture());
  const placeholder = `babel-original://${prepared.original.token}`;
  const url = `/api/imports/web-archive/snapshots/${"a".repeat(64)}`;
  let saves = 0;
  const save = async (content: string) => { saves++; return content; };
  const fetch = context.mock.method(globalThis, "fetch", async () => Response.json({ url }));
  assert.equal(await saveWithImportedOriginal("The source link was removed.", prepared.original, save), "The source link was removed.");
  assert.equal(fetch.mock.callCount(), 0);
  await assert.rejects(saveWithImportedOriginal(placeholder, {
    ...prepared.original, savedUrl: `/api/imports/documents/originals/${"a".repeat(64)}`,
  }, save), /location is invalid/u);
  const normal: ImportedOriginalDocument = { file: new File(["plain"], "original.txt"), token: prepared.original.token, savedUrl: url };
  await assert.rejects(saveWithImportedOriginal(placeholder, normal, save), /location is invalid/u);
  for (const invalid of ["https://example.test/archive", `/api/imports/documents/originals/${"a".repeat(64)}`, `/api/imports/web-archive/snapshots/${"a".repeat(64)}?download=1`]) {
    fetch.mock.mockImplementation(async () => Response.json({ url: invalid }));
    await assert.rejects(saveWithImportedOriginal(placeholder, { ...prepared.original }, save), /invalid original file location/u);
  }
  assert.equal(saves, 1, "only explicitly removing the source link saved content");
});

test("archive originals reject oversized inputs and final note-link expansion before uploading", async context => {
  const prepared = prepareWebArchiveImport(archiveFixture());
  const placeholder = `babel-original://${prepared.original.token}`;
  const fetch = context.mock.method(globalThis, "fetch", async () => { throw new Error("Invalid sources must not upload"); });
  const save = async (markdown: string) => markdown;
  const file = new File(["source"], "capture.babel.json");
  Object.defineProperty(file, "size", { value: WEB_ARCHIVE_MAX_BYTES + 1 });
  await assert.rejects(saveWithImportedOriginal(placeholder, { ...prepared.original, file }, save), /150 MiB/u);
  const expanded = "x".repeat(DOCUMENT_IMPORT_MAX_MARKDOWN_BYTES - placeholder.length) + placeholder;
  await assert.rejects(saveWithImportedOriginal(expanded, prepared.original, save), /10 MiB/u);
  assert.equal(fetch.mock.callCount(), 0);
});
