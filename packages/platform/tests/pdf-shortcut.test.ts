import assert from "node:assert/strict";
import test from "node:test";

import { handleShortcutKeyDown } from "../src/shortcuts/react";

test("PDF shortcut opens once from an editor and suppresses browser Print on repeats or while a modal owns focus", () => {
  let executions = 0;
  let consumed = 0;
  const event = {
    key: "p", ctrlKey: true,
    preventDefault: () => { consumed++; },
    stopPropagation: () => undefined,
  };
  assert.equal(handleShortcutKeyDown(event, "pdfLibrary", "Ctrl+P", true, false, () => { executions++; return true; }), true);
  assert.equal(handleShortcutKeyDown({ ...event, repeat: true }, "pdfLibrary", "Ctrl+P", true, false, () => { executions++; return true; }), true);
  assert.equal(handleShortcutKeyDown(event, "pdfLibrary", "Ctrl+P", false, false, () => false), true);
  assert.deepEqual({ executions, consumed }, { executions: 1, consumed: 3 });
});

test("disabled or remapped PDF bindings preserve the old key and input composition", () => {
  const unexpected = () => assert.fail("The former or unsafe key must not invoke a PDF action");
  const event = { key: "p", ctrlKey: true, preventDefault: unexpected, stopPropagation: unexpected };
  for (const binding of [null, "Ctrl+Shift+P"]) {
    assert.equal(handleShortcutKeyDown(event, "pdfLibrary", binding, true, false, unexpected), false);
  }
  for (const extra of [{ isComposing: true }, { keyCode: 229 }, { metaKey: true }, { defaultPrevented: true },
    { getModifierState: (key: string) => key === "AltGraph" }]) {
    assert.equal(handleShortcutKeyDown({ ...event, ...extra }, "pdfLibrary", "Ctrl+P", true, false, unexpected), false);
  }
});

test("a reassigned PDF shortcut still consumes its configured native action", () => {
  let executions = 0;
  let consumed = 0;
  assert.equal(handleShortcutKeyDown({ key: "p", ctrlKey: true, shiftKey: true,
    preventDefault: () => { consumed++; }, stopPropagation: () => undefined,
  }, "pdfLibrary", "Ctrl+Shift+P", false, false, () => { executions++; return true; }), true);
  assert.deepEqual({ executions, consumed }, { executions: 1, consumed: 1 });
});
