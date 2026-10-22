import assert from "node:assert/strict";
import test from "node:test";

import {
  type FolderExpansionState,
  folderSelectionPath,
  revealFolderPath,
  revealFolderSelection,
  toggleFolderExpansion,
} from "@/components/folder-tree-state";

const folders = [
  { id: 1, parentId: null },
  { id: 2, parentId: 1 },
  { id: 3, parentId: 2 },
  { id: 4, parentId: null },
] as const;

test("a deep selection reveals all three-level ancestors", () => {
  const path = folderSelectionPath(folders, 3);
  const expandedIds = revealFolderPath(new Set(), path);

  assert.equal(path.key, "3:1/2");
  assert.deepEqual(path.ancestorIds, [1, 2]);
  assert.deepEqual([...expandedIds], [1, 2]);
});

test("toggling uses the revealed snapshot without mutating it", () => {
  const revealedIds = revealFolderPath(new Set([4]), folderSelectionPath(folders, 3));
  const collapsedIds = toggleFolderExpansion(revealedIds, 2);

  assert.deepEqual([...revealedIds], [4, 1, 2]);
  assert.deepEqual([...collapsedIds], [4, 1]);
  assert.deepEqual([...toggleFolderExpansion(collapsedIds, 2)], [4, 1, 2]);
});

test("a changed ancestor path is revealed again after a move", () => {
  const originalPath = folderSelectionPath(folders, 3);
  const collapsedIds = toggleFolderExpansion(
    revealFolderPath(new Set(), originalPath),
    2,
  );
  const movedFolders = folders.map((folder) =>
    folder.id === 3 ? { ...folder, parentId: 4 } : folder,
  );
  const movedPath = folderSelectionPath(movedFolders, 3);

  assert.notEqual(movedPath.key, originalPath.key);
  assert.deepEqual([...revealFolderPath(collapsedIds, movedPath)], [1, 4]);
});

test("returning from B to A reveals A again after its ancestor was collapsed", () => {
  const pathA = folderSelectionPath(folders, 3);
  const pathB = folderSelectionPath(folders, 4);
  let state: FolderExpansionState = {
    expandedIds: new Set(),
    revealedPathKey: "root",
  };

  state = revealFolderSelection(state, pathA);
  state = {
    ...state,
    expandedIds: toggleFolderExpansion(state.expandedIds, 2),
  };
  assert.equal(state.expandedIds.has(2), false);

  state = revealFolderSelection(state, pathB);
  assert.equal(state.revealedPathKey, pathB.key);
  state = revealFolderSelection(state, pathA);

  assert.equal(state.revealedPathKey, pathA.key);
  assert.equal(state.expandedIds.has(2), true);
});

test("selection paths stop safely at missing parents and cycles", () => {
  assert.deepEqual(folderSelectionPath([{ id: 1, parentId: 99 }], 1).ancestorIds, []);
  assert.deepEqual(
    folderSelectionPath(
      [
        { id: 1, parentId: 2 },
        { id: 2, parentId: 1 },
      ],
      1,
    ).ancestorIds,
    [2],
  );
});
