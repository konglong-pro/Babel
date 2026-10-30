import assert from "node:assert/strict";
import test from "node:test";

import {
  folderDropPosition,
  folderKeyboardPosition,
} from "../src/folders/reorder";

const folders = [
  { id: 1, parentId: null },
  { id: 2, parentId: null },
  { id: 3, parentId: null },
  { id: 4, parentId: 1 },
  { id: 5, parentId: 1 },
];

test("folder drops calculate positions after removing the dragged sibling", () => {
  assert.equal(folderDropPosition(folders, 1, 3, "after"), 2);
  assert.equal(folderDropPosition(folders, 3, 1, "before"), 0);
  assert.equal(folderDropPosition(folders, 2, 3, "before"), null);
});

test("folder drops never change a folder's parent", () => {
  assert.equal(folderDropPosition(folders, 4, 2, "before"), null);
  assert.equal(folderDropPosition(folders, 1, 4, "after"), null);
  assert.equal(folderDropPosition(folders, 5, 4, "before"), 0);
});

test("keyboard positions move one sibling and stop at each boundary", () => {
  assert.equal(folderKeyboardPosition(folders, 2, "up"), 0);
  assert.equal(folderKeyboardPosition(folders, 2, "down"), 2);
  assert.equal(folderKeyboardPosition(folders, 1, "up"), null);
  assert.equal(folderKeyboardPosition(folders, 3, "down"), null);
});
