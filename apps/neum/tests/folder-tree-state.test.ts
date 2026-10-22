import assert from "node:assert/strict";
import test from "node:test";

import {
  type FolderExpansionState,
  folderSelectionPath,
  revealFolderPath,
  revealFolderSelection,
  toggleFolderExpansion,
} from "@/components/folder-tree-state";

const threeLevelFolders = [
  { id: 1, parentId: null },
  { id: 2, parentId: 1 },
  { id: 3, parentId: 2 },
];

test("reveals every ancestor of a three-level selection without mutating the snapshot", () => {
  const path = folderSelectionPath(threeLevelFolders, 3);
  const snapshot: ReadonlySet<number> = new Set([9]);
  const revealed = revealFolderPath(snapshot, path);

  assert.deepEqual(path, { key: "3:1/2", ancestorIds: [1, 2] });
  assert.deepEqual(revealed, new Set([9, 1, 2]));
  assert.deepEqual(snapshot, new Set([9]));
  assert.notStrictEqual(revealed, snapshot);
});

test("toggle returns independent expansion snapshots", () => {
  const original: ReadonlySet<number> = new Set([1]);
  const opened = toggleFolderExpansion(original, 2);
  const closed = toggleFolderExpansion(opened, 1);

  assert.deepEqual(original, new Set([1]));
  assert.deepEqual(opened, new Set([1, 2]));
  assert.deepEqual(closed, new Set([2]));
  assert.notStrictEqual(opened, original);
  assert.notStrictEqual(closed, opened);
});

test("selection path key changes when the selected branch moves", () => {
  const before = folderSelectionPath(threeLevelFolders, 3);
  const movedFolders = [
    { id: 1, parentId: null },
    { id: 4, parentId: null },
    { id: 2, parentId: 4 },
    { id: 3, parentId: 2 },
  ];
  const after = folderSelectionPath(movedFolders, 3);

  assert.equal(before.key, "3:1/2");
  assert.equal(after.key, "3:4/2");
  assert.deepEqual(after.ancestorIds, [4, 2]);
});

test("a selected path is revealed again after moving away and back", () => {
  const originalPath = folderSelectionPath(threeLevelFolders, 3);
  const movedPath = folderSelectionPath(
    [
      { id: 1, parentId: null },
      { id: 4, parentId: null },
      { id: 2, parentId: 4 },
      { id: 3, parentId: 2 },
    ],
    3,
  );
  let state: FolderExpansionState = {
    expandedIds: new Set(),
    revealedPathKey: "",
  };

  state = revealFolderSelection(state, originalPath);
  state = {
    ...state,
    expandedIds: toggleFolderExpansion(state.expandedIds, 2),
  };
  assert.equal(state.expandedIds.has(2), false);

  state = revealFolderSelection(state, movedPath);
  state = revealFolderSelection(state, originalPath);

  assert.equal(state.expandedIds.has(2), true);
  assert.equal(state.revealedPathKey, originalPath.key);
});

test("selection paths stop safely at missing parents and cycles", () => {
  assert.deepEqual(folderSelectionPath([{ id: 1, parentId: 99 }], 1), {
    key: "1:",
    ancestorIds: [],
  });
  assert.deepEqual(
    folderSelectionPath(
      [
        { id: 1, parentId: 2 },
        { id: 2, parentId: 1 },
      ],
      1,
    ),
    { key: "1:2", ancestorIds: [2] },
  );
  assert.deepEqual(folderSelectionPath([], 42), { key: "42:", ancestorIds: [] });
});
