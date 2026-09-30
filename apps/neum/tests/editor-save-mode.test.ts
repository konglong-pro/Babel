import assert from "node:assert/strict";
import test from "node:test";

import { entryModeAfterSave } from "@/lib/editor-save-mode";

test("saving an existing entry keeps its editor open", () => {
  assert.equal(entryModeAfterSave(42), "edit");
});

test("the first save of a draft keeps the existing create completion flow", () => {
  assert.equal(entryModeAfterSave(null), "view");
});
