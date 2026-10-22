import assert from "node:assert/strict";
import test from "node:test";

import {
  noteSelectionPath,
  revealNoteSelection,
  toggleNoteExpansion,
  type NoteExpansionState,
} from "@/components/note-tree-state";

const notes = [
  { id: 1, parentId: null },
  { id: 2, parentId: 1 },
  { id: 3, parentId: 2 },
  { id: 4, parentId: null },
] as const;

test("a deep page selection reveals each ancestor", () => {
  const path = noteSelectionPath(notes, 3);
  const state = revealNoteSelection(
    { expandedIds: new Set(), revealedPathKey: "root" },
    path,
  );

  assert.deepEqual(path.ancestorIds, [1, 2]);
  assert.deepEqual([...state.expandedIds], [1, 2]);
});

test("every page can be expanded and collapsed without children", () => {
  const original = new Set<number>();
  const expanded = toggleNoteExpansion(original, 4);

  assert.deepEqual([...original], []);
  assert.deepEqual([...expanded], [4]);
  assert.deepEqual([...toggleNoteExpansion(expanded, 4)], []);
});

test("returning to a selection reveals its collapsed ancestor again", () => {
  const deepPath = noteSelectionPath(notes, 3);
  let state: NoteExpansionState = {
    expandedIds: new Set(),
    revealedPathKey: "root",
  };
  state = revealNoteSelection(state, deepPath);
  state = { ...state, expandedIds: toggleNoteExpansion(state.expandedIds, 2) };
  state = revealNoteSelection(state, noteSelectionPath(notes, 4));
  state = revealNoteSelection(state, deepPath);

  assert.equal(state.expandedIds.has(2), true);
});
