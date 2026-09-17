import assert from "node:assert/strict";
import test from "node:test";

import {
  itemDropPosition,
  itemKeyboardPosition,
} from "../src/items/reorder";

const items = [
  { id: 1, parentId: null, scopeId: "knowledge:10" },
  { id: 2, parentId: null, scopeId: "knowledge:10" },
  { id: 3, parentId: null, scopeId: "knowledge:10" },
  { id: 4, parentId: 1, scopeId: "knowledge:10" },
  { id: 5, parentId: 1, scopeId: "knowledge:10" },
  { id: 6, parentId: null, scopeId: "knowledge:11" },
  { id: 7, parentId: null, scopeId: "snippet:10" },
];

test("item drops calculate final positions within one sibling scope", () => {
  assert.equal(itemDropPosition(items, 1, 3, "after"), 2);
  assert.equal(itemDropPosition(items, 3, 1, "before"), 0);
  assert.equal(itemDropPosition(items, 2, 3, "before"), null);
  assert.equal(itemDropPosition(items, 5, 4, "before"), 0);
});

test("item drops reject other parents, folders, and libraries", () => {
  assert.equal(itemDropPosition(items, 1, 4, "after"), null);
  assert.equal(itemDropPosition(items, 1, 6, "after"), null);
  assert.equal(itemDropPosition(items, 1, 7, "after"), null);
});

test("item keyboard positions move one sibling and stop at boundaries", () => {
  assert.equal(itemKeyboardPosition(items, 2, "up"), 0);
  assert.equal(itemKeyboardPosition(items, 2, "down"), 2);
  assert.equal(itemKeyboardPosition(items, 1, "up"), null);
  assert.equal(itemKeyboardPosition(items, 3, "down"), null);
});

