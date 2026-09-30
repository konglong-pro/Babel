import assert from "node:assert/strict";
import test from "node:test";

import {
  captureReaderUnderlineAnchor,
  resolveReaderUnderlineAnchor,
} from "@babel-apps/markdown/react";
import { resolveReaderUnderlineRemovalId } from "../src/reader-annotation-anchor";
import { subscribeDetachedReaderAnnotationShortcuts } from "../src/reader-annotations";

function detachedReaderFixture(desktop = false) {
  const view = Object.assign(new EventTarget(), { __BABEL_DESKTOP__: desktop }) as unknown as Window & {
    __BABEL_DESKTOP__: boolean;
  };
  const document = { defaultView: view, activeElement: null as Element | null };
  const root = { ownerDocument: document } as unknown as HTMLElement;
  const sourceWindow = new EventTarget() as unknown as Window;
  const keydown = (key: string, modifiers: Record<string, unknown> = {}) => {
    const event = Object.assign(new Event("keydown", { cancelable: true }), {
      key, ctrlKey: true, ...modifiers,
    });
    view.dispatchEvent(event);
    return event.defaultPrevented;
  };
  return { view, document, root, sourceWindow, keydown };
}

test("detached reader commands use the popup document once across multiple annotation fields", () => {
  const fixture = detachedReaderFixture();
  const calls: string[] = [];
  const bindings = { underlineSelection: "Ctrl+Shift+U", removeUnderline: "Ctrl+Alt+U" };
  const execute = (command: string, document: Document) => {
    assert.equal(document, fixture.root.ownerDocument);
    calls.push(command);
    return true;
  };
  const stopFirst = subscribeDetachedReaderAnnotationShortcuts(fixture.root, fixture.sourceWindow, bindings, execute);
  const stopSecond = subscribeDetachedReaderAnnotationShortcuts(fixture.root, fixture.sourceWindow, bindings, execute);
  assert.equal(fixture.keydown("u", { shiftKey: true }), true);
  assert.equal(fixture.keydown("u", { altKey: true }), true);
  assert.equal(fixture.keydown("k"), false, "the portal must not create a second command palette");
  assert.deepEqual(calls, ["underlineSelection", "removeUnderline"]);
  stopFirst();
  stopSecond();
  assert.equal(fixture.keydown("u", { shiftKey: true }), false);
});

test("inline reader leaves keyboard dispatch to its existing provider", () => {
  const fixture = detachedReaderFixture();
  const stop = subscribeDetachedReaderAnnotationShortcuts(fixture.root, fixture.view,
    { underlineSelection: "Ctrl+Shift+U", removeUnderline: "Ctrl+Alt+U" },
    () => { assert.fail("the source window already has a shortcut provider"); });
  assert.equal(fixture.keydown("u", { shiftKey: true }), false);
  stop();
});

test("detached reader subscriptions follow updated and unbound shortcut settings", () => {
  const fixture = detachedReaderFixture();
  const calls: string[] = [];
  const execute = (command: string) => { calls.push(command); return true; };
  const stopOld = subscribeDetachedReaderAnnotationShortcuts(fixture.root, fixture.sourceWindow,
    { underlineSelection: "Ctrl+Shift+U", removeUnderline: "Ctrl+Alt+U" }, execute);
  assert.equal(fixture.keydown("u", { shiftKey: true }), true);
  stopOld();
  const stopNew = subscribeDetachedReaderAnnotationShortcuts(fixture.root, fixture.sourceWindow,
    { underlineSelection: "Ctrl+Alt+H", removeUnderline: null }, execute);
  assert.equal(fixture.keydown("u", { shiftKey: true }), false);
  assert.equal(fixture.keydown("u", { altKey: true }), false);
  assert.equal(fixture.keydown("h", { altKey: true }), true);
  assert.deepEqual(calls, ["underlineSelection", "underlineSelection"]);
  stopNew();
});

test("detached reader preserves input and IME and requires the popup's desktop marker", () => {
  const fixture = detachedReaderFixture();
  let calls = 0;
  const stop = subscribeDetachedReaderAnnotationShortcuts(fixture.root, fixture.sourceWindow,
    { underlineSelection: "Ctrl+W", removeUnderline: "Ctrl+Alt+U" },
    () => { calls += 1; return false; });
  assert.equal(fixture.keydown("w"), false);
  fixture.view.__BABEL_DESKTOP__ = true;
  assert.equal(fixture.keydown("w"), true, "desktop keys suppress fallback even when no adapter is available");
  assert.equal(fixture.keydown("w", { repeat: true }), true);
  for (const state of [
    { isComposing: true }, { keyCode: 229 },
    { getModifierState: (key: string) => key === "AltGraph" },
  ]) assert.equal(fixture.keydown("w", state), false);
  const input = { matches: () => false, closest: () => null } as unknown as Element;
  fixture.document.activeElement = { closest: () => input } as unknown as Element;
  assert.equal(fixture.keydown("w"), false);
  assert.equal(fixture.keydown("u", { altKey: true }), false);
  assert.equal(calls, 1);
  stop();
});

test("captures the selected rendered text with surrounding context", () => {
  const text = "Intro: blue **is rendered text** in this test.";
  const start = text.indexOf(" blue");
  const anchor = captureReaderUnderlineAnchor(text, start, start + " blue ".length);

  assert.ok(anchor);
  assert.equal(anchor.exact, "blue");
  assert.equal(anchor.start, start + 1);
  assert.equal(anchor.end, start + 5);
  assert.equal(anchor.prefix, "Intro: ");
  assert.equal(anchor.suffix, " **is rendered text** in this te");
  assert.equal(captureReaderUnderlineAnchor(text, start, start + 1), null);
});

test("restores a line after text was inserted before its passage", () => {
  const original = "First paragraph. Important passage. Last paragraph.";
  const start = original.indexOf("Important passage");
  const anchor = captureReaderUnderlineAnchor(original, start, start + "Important passage".length);
  assert.ok(anchor);

  const updated = `New beginning. ${original}`;
  assert.deepEqual(resolveReaderUnderlineAnchor(updated, anchor), {
    start: updated.indexOf("Important passage"),
    end: updated.indexOf("Important passage") + "Important passage".length,
  });
});

test("uses surrounding text to disambiguate a repeated quotation", () => {
  const original = "First theory is sound. Second theory is doubtful.";
  const start = original.indexOf("theory", original.indexOf("Second"));
  const anchor = captureReaderUnderlineAnchor(original, start, start + "theory".length);
  assert.ok(anchor);

  const updated = `Preface. ${original}`;
  assert.deepEqual(resolveReaderUnderlineAnchor(updated, anchor), {
    start: updated.indexOf("theory", updated.indexOf("Second")),
    end: updated.indexOf("theory", updated.indexOf("Second")) + "theory".length,
  });
});

test("does not attach a line to an ambiguous or removed passage", () => {
  const original = "Repeat this. Repeat this.";
  const start = original.indexOf("Repeat");
  const anchor = captureReaderUnderlineAnchor(original, start, start + "Repeat".length);
  assert.ok(anchor);

  assert.equal(resolveReaderUnderlineAnchor("Repeat this. Repeat this.", {
    ...anchor,
    prefix: "",
    suffix: "",
  }), null);
  assert.equal(resolveReaderUnderlineAnchor("Nothing remains.", anchor), null);
});

test("does not move a short quotation to an unrelated surviving occurrence", () => {
  const original = "An early idea was wrong; the later argument was sound.";
  const start = original.indexOf("idea");
  const anchor = captureReaderUnderlineAnchor(original, start, start + "idea".length);
  assert.ok(anchor);

  assert.equal(resolveReaderUnderlineAnchor("The only idea is unrelated.", anchor), null);
});

test("preserves UTF-16 offsets for selections containing emoji", () => {
  const text = "🧭 choose 🧪 carefully";
  const start = text.indexOf("🧪");
  const anchor = captureReaderUnderlineAnchor(text, start, start + "🧪".length);
  assert.ok(anchor);
  assert.equal(anchor.start, 10);
  assert.equal(anchor.end, 12);
  assert.deepEqual(resolveReaderUnderlineAnchor(`Start ${text}`, anchor), {
    start: 16,
    end: 18,
  });
});

test("remove underline targets only the exact selected passage or the active line", () => {
  const original = "First point. Second point.";
  const start = original.indexOf("Second point");
  const anchor = captureReaderUnderlineAnchor(original, start, start + "Second point".length);
  assert.ok(anchor);
  const annotations = [{ id: 7, fieldKey: "body", color: "yellow", anchor, noteIds: [] }];
  const updated = `Preface. ${original}`;
  const movedStart = updated.indexOf("Second point");
  const selected = captureReaderUnderlineAnchor(updated, movedStart, movedStart + "Second point".length);
  assert.ok(selected);

  assert.equal(resolveReaderUnderlineRemovalId(updated, annotations, selected, null), 7);
  assert.equal(resolveReaderUnderlineRemovalId(updated, annotations, {
    ...selected,
    end: selected.end - 1,
  }, 7), null);
  assert.equal(resolveReaderUnderlineRemovalId(updated, annotations, null, 7), 7);
  assert.equal(resolveReaderUnderlineRemovalId("Nothing remains.", annotations, selected, 7), null);
});
