import assert from "node:assert/strict";
import test from "node:test";

import { noteModeAfterSave } from "@/lib/editor-save-mode";

test("saving an existing note keeps its editor open", () => {
  assert.equal(noteModeAfterSave(42), "edit");
});

test("the first save of a draft keeps the existing create completion flow", () => {
  assert.equal(noteModeAfterSave(null), "view");
});
