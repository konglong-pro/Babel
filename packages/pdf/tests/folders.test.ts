import assert from "node:assert/strict";
import test from "node:test";
import type { PdfFolder } from "@babel-apps/platform/pdf/core";
import { pdfFolderEntries, pdfFolderSubtreeIds } from "../src/folders";

const folder = (id: string, name: string, parentId: string | null = null): PdfFolder => ({ id, name, parentId, createdAt: "2026-10-20T00:00:00Z", updatedAt: "2026-10-20T00:00:00Z" });

test("PDF navigation derives nested paths in server order, preserving duplicate names in separate branches", () => {
  const entries = pdfFolderEntries([folder("c", "Papers", "b"), folder("b", "Biology"), folder("a", "Chemistry"), folder("d", "Papers", "a")]);
  assert.deepEqual(entries.map((entry) => [entry.folder.id, entry.path, entry.depth]), [
    ["b", "Biology", 0], ["c", "Biology / Papers", 1], ["a", "Chemistry", 0], ["d", "Chemistry / Papers", 1],
  ]);
  assert.deepEqual(entries[0].children.map((entry) => entry.folder.id), ["c"]);
});

test("folder move exclusions include the complete subtree and stay finite for malformed cycles", () => {
  const folders = [folder("a", "A", "c"), folder("b", "B", "a"), folder("c", "C", "b"), folder("d", "Other")];
  assert.deepEqual([...pdfFolderSubtreeIds(folders, "a")].sort(), ["a", "b", "c"]);
  const entries = pdfFolderEntries(folders);
  assert.equal(entries.length, 4);
  assert.equal(new Set(entries.map((entry) => entry.folder.id)).size, 4);
  assert.ok(entries.every((entry) => entry.depth < 4));
});
