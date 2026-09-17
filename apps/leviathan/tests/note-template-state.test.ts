import assert from "node:assert/strict";
import test from "node:test";

import { shouldConfirmTemplateReplacement } from "@/components/note-template-state";

test("template replacement confirms only when distinct draft content would be lost", () => {
  assert.equal(shouldConfirmTemplateReplacement({
    currentContent: "",
    nextContent: "# Policy brief",
    stagedImageCount: 0,
  }), false);
  assert.equal(shouldConfirmTemplateReplacement({
    currentContent: "# Existing draft",
    nextContent: "# Existing draft",
    stagedImageCount: 0,
  }), false);
  assert.equal(shouldConfirmTemplateReplacement({
    currentContent: "# Existing draft",
    nextContent: "# Policy brief",
    stagedImageCount: 0,
  }), true);
  assert.equal(shouldConfirmTemplateReplacement({
    currentContent: "",
    nextContent: "# Policy brief",
    stagedImageCount: 1,
  }), true);
});
