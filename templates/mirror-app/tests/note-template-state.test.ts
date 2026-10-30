import assert from "node:assert/strict";
import test from "node:test";

import { shouldConfirmTemplateContentReplacement } from "@/components/note-template-state";

test("template application only prompts before replacing authored content or images", () => {
  assert.equal(shouldConfirmTemplateContentReplacement("", "# Start", false), false);
  assert.equal(
    shouldConfirmTemplateContentReplacement("My draft", "# Start", false),
    true,
  );
  assert.equal(
    shouldConfirmTemplateContentReplacement("# Start", "# Start", false),
    false,
  );
  assert.equal(shouldConfirmTemplateContentReplacement("", "# Start", true), true);
});
