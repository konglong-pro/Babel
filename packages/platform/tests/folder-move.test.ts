import assert from "node:assert/strict";
import test from "node:test";
import { canMoveFolderItem, parseFolderItemDrag } from "../src/folders/move";

const items = [{ id: 1, folderId: 10 }, { id: 2, folderId: 10 }];
const drag = { scope: "notes", id: 1, folderId: 10 };

test("moving folders accepts only current items and another allowed destination", () => {
  assert.equal(canMoveFolderItem(drag, "notes", items, [10, 20], 20), true);
  assert.equal(canMoveFolderItem(drag, "notes", items, [10, 20], 10), false);
  assert.equal(canMoveFolderItem(drag, "notes", items, [10, 20], 30), false);
  assert.equal(canMoveFolderItem(drag, "exercises", items, [10, 20], 20), false);
  assert.equal(canMoveFolderItem({ ...drag, id: 3 }, "notes", items, [10, 20], 20), false);
  assert.equal(canMoveFolderItem(drag, "notes", [{ id: 1, folderId: 30 }], [10, 20], 20), false);
});

test("external text, malformed, and invalid drag identifiers are rejected", () => {
  for (const value of ["1", "null", "hello", "{}", JSON.stringify({ ...drag, id: "1" }), JSON.stringify({ ...drag, folderId: -1 }), JSON.stringify({ ...drag, id: 1.5 })]) {
    assert.equal(parseFolderItemDrag(value), null);
  }
  assert.deepEqual(parseFolderItemDrag(JSON.stringify(drag)), drag);
});
