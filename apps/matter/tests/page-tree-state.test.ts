import assert from "node:assert/strict";
import test from "node:test";

import {
  type PageExpansionState,
  pageDescendantIds,
  pageSelectionPath,
  revealPageSelection,
  togglePageExpansion,
} from "@/components/page-tree-state";

const pages = [
  { id: 1, parentId: null },
  { id: 2, parentId: 1 },
  { id: 3, parentId: 2 },
  { id: 4, parentId: null },
];

test("deep page selections reveal every ancestor and toggles remain immutable", () => {
  const path = pageSelectionPath(pages, 3);
  const initial: PageExpansionState = { expandedIds: new Set([4]), revealedPathKey: "" };
  const revealed = revealPageSelection(initial, path);
  const collapsed = togglePageExpansion(revealed.expandedIds, 2);

  assert.deepEqual(path, { key: "3:1/2", ancestorIds: [1, 2] });
  assert.deepEqual(revealed.expandedIds, new Set([4, 1, 2]));
  assert.deepEqual(collapsed, new Set([4, 1]));
  assert.deepEqual(initial.expandedIds, new Set([4]));
});

test("page descendants support cycle-safe parent choices", () => {
  assert.deepEqual(pageDescendantIds(pages, 1), new Set([2, 3]));
  assert.deepEqual(pageDescendantIds(pages, 3), new Set());
});
