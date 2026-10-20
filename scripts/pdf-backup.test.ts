import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { verifyPdfMetadataForBackup } from "./lib/pdf-backup";

test("backup leaves apps without a PDF library untouched", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "babel-pdf-backup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const filename = path.join(root, "metadata.sqlite");
  assert.equal(verifyPdfMetadataForBackup(filename, "Test"), false);
  assert.equal(existsSync(filename), false);
});

test("backup verifies metadata and consolidates a WAL database into a closed DELETE journal", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "babel-pdf-backup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const filename = path.join(root, "metadata.sqlite"), source = new Database(filename);
  source.pragma("journal_mode = WAL");
  source.exec("CREATE TABLE excerpts (text TEXT); INSERT INTO excerpts VALUES ('keep my annotations')");
  source.close();
  assert.equal(verifyPdfMetadataForBackup(filename, "Test"), true);
  const restored = new Database(filename);
  try {
    assert.equal(restored.pragma("journal_mode", { simple: true }), "delete");
    assert.deepEqual(restored.prepare("SELECT text FROM excerpts").get(), { text: "keep my annotations" });
  } finally { restored.close(); }
  for (const suffix of ["-wal", "-shm", "-journal"]) assert.equal(existsSync(`${filename}${suffix}`), false);
});

test("backup refuses corrupt PDF metadata before Git staging", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "babel-pdf-backup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const filename = path.join(root, "metadata.sqlite");
  await writeFile(filename, Buffer.alloc(8192, 42));
  assert.throws(() => verifyPdfMetadataForBackup(filename, "Test"), /database|malformed/iu);
});
