import assert from "node:assert/strict";
import test from "node:test";

import { persistedEditorModeAfterSave } from "@/lib/editor-save-mode";

test("saving an existing Vali note or reflection keeps its editor open", () => {
  assert.equal(persistedEditorModeAfterSave(true), "edit");
});

test("the first save of a Vali draft retains the existing completion flow", () => {
  assert.equal(persistedEditorModeAfterSave(false), "view");
});
