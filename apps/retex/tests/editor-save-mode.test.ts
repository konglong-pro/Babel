import assert from "node:assert/strict";
import test from "node:test";

import { archiveModeAfterSave } from "@/lib/editor-save-mode";

test("saving an existing archive item keeps its editor open", () => {
  assert.equal(archiveModeAfterSave(42), "edit");
});

test("the first save of a draft keeps the existing create completion flow", () => {
  assert.equal(archiveModeAfterSave(null), "view");
});
