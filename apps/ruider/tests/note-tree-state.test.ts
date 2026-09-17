import assert from "node:assert/strict";
import test from "node:test";

import {
  noteSelectionPath,
  revealNoteSelection,
  toggleNoteExpansion,
} from "@/components/note-tree-state";

const notes = [
  { id: 1, parentId: null },
  { id: 2, parentId: 1 },
  { id: 3, parentId: 2 },
  { id: 4, parentId: 3 },
];

test("selecting a deep page reveals every ancestor", () => {
  const path = noteSelectionPath(notes, 4);
  assert.deepEqual(path.ancestorIds, [1, 2, 3]);
  const state = revealNoteSelection(
    { expandedIds: new Set<number>(), revealedPathKey: "" },
    path,
  );
  assert.deepEqual([...state.expandedIds], [1, 2, 3]);
});

test("every page expansion can be toggled, including a current leaf", () => {
  const expanded = toggleNoteExpansion(new Set<number>(), 4);
  assert.deepEqual([...expanded], [4]);
  assert.deepEqual([...toggleNoteExpansion(expanded, 4)], []);
});
