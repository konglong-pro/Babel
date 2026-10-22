import assert from "node:assert/strict";
import test from "node:test";

import {
  type EntryExpansionState,
  entrySelectionPath,
  revealEntryPath,
  revealEntrySelection,
  toggleEntryExpansion,
} from "@/components/entry-tree-state";

const threeLevelEntries = [
  { id: 1, parentId: null },
  { id: 2, parentId: 1 },
  { id: 3, parentId: 2 },
];

test("reveals every ancestor of a three-level page selection", () => {
  const path = entrySelectionPath(threeLevelEntries, 3);
  const snapshot: ReadonlySet<number> = new Set([9]);
  const revealed = revealEntryPath(snapshot, path);

  assert.deepEqual(path, { key: "3:1/2", ancestorIds: [1, 2] });
  assert.deepEqual(revealed, new Set([9, 1, 2]));
  assert.deepEqual(snapshot, new Set([9]));
  assert.notStrictEqual(revealed, snapshot);
});

test("page expansion snapshots stay independent and can include leaves", () => {
  const original: ReadonlySet<number> = new Set([1]);
  const openedLeaf = toggleEntryExpansion(original, 3);
  const closedParent = toggleEntryExpansion(openedLeaf, 1);

  assert.deepEqual(original, new Set([1]));
  assert.deepEqual(openedLeaf, new Set([1, 3]));
  assert.deepEqual(closedParent, new Set([3]));
});

test("a selected page path is revealed again after moving away and back", () => {
  const originalPath = entrySelectionPath(threeLevelEntries, 3);
  const movedPath = entrySelectionPath(
    [
      { id: 1, parentId: null },
      { id: 4, parentId: null },
      { id: 2, parentId: 4 },
      { id: 3, parentId: 2 },
    ],
    3,
  );
  let state: EntryExpansionState = {
    expandedIds: new Set(),
    revealedPathKey: "",
  };

  state = revealEntrySelection(state, originalPath);
  state = {
    ...state,
    expandedIds: toggleEntryExpansion(state.expandedIds, 2),
  };
  assert.equal(state.expandedIds.has(2), false);

  state = revealEntrySelection(state, movedPath);
  state = revealEntrySelection(state, originalPath);

  assert.equal(state.expandedIds.has(2), true);
  assert.equal(state.revealedPathKey, originalPath.key);
});

test("page selection paths stop safely at missing parents and cycles", () => {
  assert.deepEqual(entrySelectionPath([{ id: 1, parentId: 99 }], 1), {
    key: "1:",
    ancestorIds: [],
  });
  assert.deepEqual(
    entrySelectionPath(
      [
        { id: 1, parentId: 2 },
        { id: 2, parentId: 1 },
      ],
      1,
    ),
    { key: "1:2", ancestorIds: [2] },
  );
});
