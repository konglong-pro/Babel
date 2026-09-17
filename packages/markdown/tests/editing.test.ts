import assert from "node:assert/strict";
import test from "node:test";

import {
  continueFenceOnEnter,
  continueListOnEnter,
  editFromMarkdownKey,
  editFromMarkdownPaste,
  indentListItem,
  linkFromPastedUrl,
  minimalTextReplacement,
  outdentListItem,
  toggleTaskCheckbox,
  toggleTaskListSelection,
  wrapInlineSelection,
  type InlineMarker,
} from "@babel-apps/markdown/editing";

test("describes the smallest contiguous replacement for a native edit", () => {
  assert.deepEqual(minimalTextReplacement("alpha omega", "alpha brave omega"), {
    from: 6,
    to: 6,
    insert: "brave ",
  });
  assert.equal(minimalTextReplacement("unchanged", "unchanged"), null);
});

test("applies the standard bold shortcut to the active selection", () => {
  assert.deepEqual(editFromMarkdownKey("important", 0, 9, {
    key: "b",
    ctrlKey: true,
  }), {
    text: "**important**",
    selectionStart: 2,
    selectionEnd: 11,
  });
});

test("applies the standard italic shortcut with the platform modifier", () => {
  const expected = {
    text: "*emphasis*",
    selectionStart: 1,
    selectionEnd: 9,
  };
  assert.deepEqual(editFromMarkdownKey("emphasis", 0, 8, {
    key: "i",
    ctrlKey: true,
  }), expected);
  assert.deepEqual(editFromMarkdownKey("emphasis", 0, 8, {
    key: "i",
    metaKey: true,
  }), expected);
});

test("routes Enter through fenced-block continuation before generic input", () => {
  assert.deepEqual(editFromMarkdownKey("```ts", 5, 5, { key: "Enter" }), {
    text: "```ts\n\n```",
    selectionStart: 6,
    selectionEnd: 6,
  });
});

test("routes Tab and Shift+Tab through list indentation", () => {
  const indented = editFromMarkdownKey("- item", 0, 6, { key: "Tab" });
  assert.deepEqual(indented, {
    text: "  - item",
    selectionStart: 2,
    selectionEnd: 8,
  });
  assert.deepEqual(editFromMarkdownKey(
    indented!.text,
    indented!.selectionStart,
    indented!.selectionEnd,
    { key: "Tab", shiftKey: true },
  ), {
    text: "- item",
    selectionStart: 0,
    selectionEnd: 6,
  });
});

test("continues unordered, ordered, task, and quoted list markers", () => {
  assert.deepEqual(continueListOnEnter("- item", 6, 6), {
    text: "- item\n- ", selectionStart: 9, selectionEnd: 9,
  });
  assert.deepEqual(continueListOnEnter("9. item", 7, 7), {
    text: "9. item\n10. ", selectionStart: 12, selectionEnd: 12,
  });
  assert.deepEqual(continueListOnEnter("  * [x] done", 12, 12), {
    text: "  * [x] done\n  * [ ] ", selectionStart: 21, selectionEnd: 21,
  });
  assert.deepEqual(continueListOnEnter("> - quoted", 10, 10), {
    text: "> - quoted\n> - ", selectionStart: 15, selectionEnd: 15,
  });
});

test("uses CRLF and clears only the innermost empty marker", () => {
  assert.deepEqual(continueListOnEnter("- first\r\n- second", 7, 7), {
    text: "- first\r\n- \r\n- second", selectionStart: 11, selectionEnd: 11,
  });
  assert.deepEqual(continueListOnEnter("> - ", 4, 4), {
    text: "> ", selectionStart: 2, selectionEnd: 2,
  });
  assert.deepEqual(continueListOnEnter("- ", 2, 2), {
    text: "", selectionStart: 0, selectionEnd: 0,
  });
});

test("indents and outdents multi-line list selections", () => {
  const text = "- one\n> - two";
  const indented = indentListItem(text, 0, text.length);
  assert.deepEqual(indented, {
    text: "  - one\n>   - two",
    selectionStart: 2,
    selectionEnd: text.length + 4,
  });
  assert.deepEqual(
    outdentListItem(indented!.text, indented!.selectionStart, indented!.selectionEnd),
    { text, selectionStart: 0, selectionEnd: text.length },
  );
  assert.equal(indentListItem("plain", 0, 5), null);
  assert.equal(outdentListItem("- top", 0, 5), null);
});

test("wraps and toggles inline selections and empty cursors", () => {
  for (const marker of ["**", "*", "`", "~~"] satisfies InlineMarker[]) {
    const wrapped = wrapInlineSelection("word", 0, 4, marker);
    assert.deepEqual(wrapped, {
      text: `${marker}word${marker}`,
      selectionStart: marker.length,
      selectionEnd: marker.length + 4,
    });
    assert.deepEqual(
      wrapInlineSelection(wrapped!.text, wrapped!.selectionStart, wrapped!.selectionEnd, marker),
      { text: "word", selectionStart: 0, selectionEnd: 4 },
    );
  }

  const empty = wrapInlineSelection("ab", 1, 1, "**");
  assert.deepEqual(empty, { text: "a****b", selectionStart: 3, selectionEnd: 3 });
  assert.deepEqual(wrapInlineSelection(empty!.text, 3, 3, "**"), {
    text: "ab", selectionStart: 1, selectionEnd: 1,
  });
});

test("treats strong asterisk delimiters as distinct from italic delimiters", () => {
  const combined = wrapInlineSelection("**word**", 2, 6, "*");
  assert.deepEqual(combined, {
    text: "***word***",
    selectionStart: 3,
    selectionEnd: 7,
  });
  assert.deepEqual(
    wrapInlineSelection(combined!.text, combined!.selectionStart, combined!.selectionEnd, "*"),
    { text: "**word**", selectionStart: 2, selectionEnd: 6 },
  );
  assert.equal(wrapInlineSelection("**word**", 0, 8, "*")?.text, "***word***");
});

test("adds and removes task markers across selected lines", () => {
  const text = "plain\n> quoted";
  const tasks = toggleTaskListSelection(text, 0, text.length);
  assert.deepEqual(tasks, {
    text: "- [ ] plain\n> - [ ] quoted",
    selectionStart: 6,
    selectionEnd: text.length + 12,
  });
  assert.deepEqual(
    toggleTaskListSelection(tasks!.text, tasks!.selectionStart, tasks!.selectionEnd),
    { text, selectionStart: 0, selectionEnd: text.length },
  );
  assert.equal(toggleTaskListSelection("- listed", 0, 8)?.text, "- [ ] listed");
});

test("turns a pasted HTTP URL into a link only with selected text", () => {
  assert.deepEqual(linkFromPastedUrl("visit me", 0, 5, "https://example.com/a"), {
    text: "[visit](https://example.com/a) me",
    selectionStart: 30,
    selectionEnd: 30,
  });
  assert.equal(linkFromPastedUrl("visit", 0, 5, "javascript:alert(1)"), null);
  assert.equal(linkFromPastedUrl("visit", 2, 2, "https://example.com"), null);
});

test("inserts pasted Markdown without losing fenced-code line breaks", () => {
  const pasted = [
    "```scss",
    "KEYWORD(int)",
    "",
    "IDENTIFIER(x)",
    "",
    "OPERATOR(=)",
    "```",
  ].join("\r\n");
  const expected = pasted.replace(/\r\n/gu, "\n");

  assert.deepEqual(editFromMarkdownPaste("replace", 0, 7, pasted), {
    text: expected,
    selectionStart: expected.length,
    selectionEnd: expected.length,
  });
});

test("opens and exits an empty fenced block", () => {
  const opened = continueFenceOnEnter("```ts", 5, 5);
  assert.deepEqual(opened, {
    text: "```ts\n\n```",
    selectionStart: 6,
    selectionEnd: 6,
  });
  assert.deepEqual(continueFenceOnEnter(opened!.text, 6, 6), {
    text: "```ts\n\n```\n",
    selectionStart: 11,
    selectionEnd: 11,
  });
});

test("opens tilde fences inside blockquote and list containers", () => {
  const quoted = continueFenceOnEnter("> ~~~ts", 7, 7);
  assert.deepEqual(quoted, {
    text: "> ~~~ts\n> \n> ~~~",
    selectionStart: 10,
    selectionEnd: 10,
  });
  assert.deepEqual(continueFenceOnEnter(quoted!.text, 10, 10), {
    text: "> ~~~ts\n> \n> ~~~\n",
    selectionStart: 17,
    selectionEnd: 17,
  });

  const listed = continueFenceOnEnter("- ~~~ts", 7, 7);
  assert.deepEqual(listed, {
    text: "- ~~~ts\n  \n  ~~~",
    selectionStart: 10,
    selectionEnd: 10,
  });
  assert.deepEqual(continueFenceOnEnter(listed!.text, 10, 10), {
    text: "- ~~~ts\n  \n  ~~~\n",
    selectionStart: 17,
    selectionEnd: 17,
  });

  assert.deepEqual(continueFenceOnEnter("> - ```ts", 9, 9), {
    text: "> - ```ts\n>   \n>   ```",
    selectionStart: 14,
    selectionEnd: 14,
  });
});

test("opens a new root fence after a container fence closes implicitly", () => {
  for (const text of [
    "> ~~~\n> quoted code\noutside\n~~~",
    "- ~~~\n  listed code\noutside\n~~~",
  ]) {
    assert.deepEqual(continueFenceOnEnter(text, text.length, text.length), {
      text: `${text}\n\n~~~`,
      selectionStart: text.length + 1,
      selectionEnd: text.length + 1,
    });
  }

  const stillInsideRootFence = "~~~\n> ~~~";
  assert.equal(
    continueFenceOnEnter(
      stillInsideRootFence,
      stillInsideRootFence.length,
      stillInsideRootFence.length,
    ),
    null,
  );
});

test("opens a new fence in a sibling list item", () => {
  const text = "- ~~~\n  first item code\n- ~~~";
  assert.deepEqual(continueFenceOnEnter(text, text.length, text.length), {
    text: `${text}\n  \n  ~~~`,
    selectionStart: text.length + 3,
    selectionEnd: text.length + 3,
  });
});

test("toggles task checkboxes by one-based source line", () => {
  const text = "- [ ] one\r\n> - [x] two";
  assert.equal(toggleTaskCheckbox(text, 1)?.text, "- [x] one\r\n> - [x] two");
  assert.equal(toggleTaskCheckbox(text, 2)?.text, "- [ ] one\r\n> - [ ] two");
  assert.equal(toggleTaskCheckbox(text, 3), null);
});

test("does not apply editing operations inside fenced code", () => {
  const text = "```md\n- [ ] code\n```";
  const start = text.indexOf("code");
  const lineStart = text.indexOf("- [ ]");
  assert.equal(continueListOnEnter(text, start + 4, start + 4), null);
  assert.equal(indentListItem(text, lineStart, start + 4), null);
  assert.equal(outdentListItem(text, lineStart, start + 4), null);
  assert.equal(wrapInlineSelection(text, start, start + 4, "**"), null);
  assert.equal(linkFromPastedUrl(text, start, start + 4, "https://example.com"), null);
  assert.equal(toggleTaskCheckbox(text, 2), null);
  assert.equal(toggleTaskListSelection(text, lineStart, start + 4), null);
});

test("does not apply editing operations inside tilde fenced code", () => {
  const text = "~~~md\n- [ ] code\n~~~";
  const start = text.indexOf("code");
  const lineStart = text.indexOf("- [ ]");
  assert.equal(continueListOnEnter(text, start + 4, start + 4), null);
  assert.equal(indentListItem(text, lineStart, start + 4), null);
  assert.equal(outdentListItem(text, lineStart, start + 4), null);
  assert.equal(wrapInlineSelection(text, start, start + 4, "**"), null);
  assert.equal(linkFromPastedUrl(text, start, start + 4, "https://example.com"), null);
  assert.equal(toggleTaskCheckbox(text, 2), null);
  assert.equal(toggleTaskListSelection(text, lineStart, start + 4), null);
});

test("editing resumes immediately after a closed fence", () => {
  const text = "```\ncode\n```\n- visible";
  assert.notEqual(continueListOnEnter(text, text.length, text.length), null);
  assert.notEqual(wrapInlineSelection(text, text.length - 7, text.length, "**"), null);
  const adjacent = "```\n```\n```";
  assert.notEqual(continueFenceOnEnter(adjacent, adjacent.length, adjacent.length), null);
});
