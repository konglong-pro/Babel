import assert from "node:assert/strict";
import test from "node:test";

import {
  captureReaderUnderlineAnchor,
  resolveReaderUnderlineAnchor,
} from "@babel-apps/markdown/react";
import { resolveReaderUnderlineRemovalId } from "../src/reader-annotation-anchor";

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
