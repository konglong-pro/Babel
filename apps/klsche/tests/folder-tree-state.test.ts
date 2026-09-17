import assert from "node:assert/strict";
import test from "node:test";

import {
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

test("folder selection paths list ancestors from root to parent", () => {
  const path = folderSelectionPath(folders, 3);

  assert.equal(path.key, "3:1/2");
  assert.deepEqual(path.ancestorIds, [1, 2]);
  assert.deepEqual(folderSelectionPath(folders, null), {
    key: "root",
    ancestorIds: [],
  });
});

test("folder selection paths stop at missing parents and cycles", () => {
  assert.deepEqual(
    folderSelectionPath([{ id: 1, parentId: 99 }], 1).ancestorIds,
    [],
  );
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

test("revealing a selected path preserves other expanded branches", () => {
  const expandedIds = new Set([4]);
  const revealedIds = revealFolderPath(expandedIds, folderSelectionPath(folders, 3));

  assert.deepEqual([...revealedIds], [4, 1, 2]);
  assert.deepEqual([...expandedIds], [4]);
  assert.strictEqual(
    revealFolderPath(revealedIds, folderSelectionPath(folders, 3)),
    revealedIds,
  );
});

test("a handled path stays collapsed until the selected path key changes", () => {
  const selectedPath = folderSelectionPath(folders, 3);
  const revealedState = revealFolderSelection(
    { expandedIds: new Set(), revealedPathKey: "root" },
    selectedPath,
  );
  const collapsedState = {
    ...revealedState,
    expandedIds: toggleFolderExpansion(revealedState.expandedIds, 2),
  };
  const samePath = folderSelectionPath([...folders], 3);

  assert.strictEqual(revealFolderSelection(collapsedState, samePath), collapsedState);
  assert.deepEqual([...collapsedState.expandedIds], [1]);

  const movedFolders = folders.map((folder) =>
    folder.id === 3 ? { ...folder, parentId: 4 } : folder,
  );
  const movedPath = folderSelectionPath(movedFolders, 3);
  const movedState = revealFolderSelection(collapsedState, movedPath);

  assert.notEqual(movedPath.key, collapsedState.revealedPathKey);
  assert.deepEqual([...movedState.expandedIds], [1, 4]);
});

test("an A to B to A selection reveals A again", () => {
  const pathA = folderSelectionPath(folders, 3);
  const revealedA = revealFolderSelection(
    { expandedIds: new Set(), revealedPathKey: "root" },
    pathA,
  );
  const collapsedA = {
    ...revealedA,
    expandedIds: toggleFolderExpansion(revealedA.expandedIds, 2),
  };
  const pathB = folderSelectionPath(folders, 4);
  const revealedB = revealFolderSelection(collapsedA, pathB);
  const revisitedA = revealFolderSelection(revealedB, pathA);

  assert.equal(revealedB.revealedPathKey, pathB.key);
  assert.equal(revisitedA.revealedPathKey, pathA.key);
  assert.deepEqual([...revisitedA.expandedIds], [1, 2]);
});

test("toggling expansion returns a new set without mutating the current state", () => {
  const expandedIds = new Set([1]);

  assert.deepEqual([...toggleFolderExpansion(expandedIds, 1)], []);
  assert.deepEqual([...toggleFolderExpansion(expandedIds, 2)], [1, 2]);
  assert.deepEqual([...expandedIds], [1]);
});
