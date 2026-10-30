import assert from "node:assert/strict";
import test from "node:test";

import {
  CLIPBOARD_MARKDOWN_MAX_BYTES,
  clipboardMarkdownTitle,
  prepareClipboardMarkdownFile,
} from "../src/imports/clipboard-client";

test("clipboard titles skip David role labels and fenced code while keeping useful Unicode text", () => {
  assert.equal(clipboardMarkdownTitle("## User\n\n请解释这段代码。\n\n## Assistant\n\n#### Answer"), "请解释这段代码。");
  assert.equal(clipboardMarkdownTitle("## Assistant\n\n#### **矩阵** 与 [向量](https://example.test)"), "矩阵 与 向量");
  assert.equal(clipboardMarkdownTitle("~~~md\n# Wrong\n~~~\n\n## Right"), "Right");
  assert.equal(clipboardMarkdownTitle("```\n## Assistant\n```\n\n---\n\n## User\n"), "Imported Markdown");
  assert.equal(clipboardMarkdownTitle("\uFEFF# A/B\\C\r\ntext"), "A B C");
  assert.equal(clipboardMarkdownTitle("😀".repeat(200)), "😀".repeat(120));
});

test("clipboard import preserves Markdown bytes and has no hidden metadata or network dependency", async () => {
  const markdown = "## User\r\n\r\n问题\r\n\r\n## Assistant\n\n\\(x^2\\)\n\n\\[\nx+y\n\\]\n\n| A | B |\n| --- | --- |\n| one<br>two | `x` |\n\n![diagram](https://example.test/image.png)\n\n```mermaid\ngraph LR\n A-->B\n```\n\n";
  const file = prepareClipboardMarkdownFile(markdown, "  对话  ");
  assert.equal(file.name, "对话.md");
  assert.equal(file.type, "text/markdown");
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), new TextEncoder().encode(markdown));
});

test("clipboard validation uses UTF-8 bytes and keeps the boundary shared by all notebooks", () => {
  assert.equal(prepareClipboardMarkdownFile("x".repeat(CLIPBOARD_MARKDOWN_MAX_BYTES), "Limit").size, CLIPBOARD_MARKDOWN_MAX_BYTES);
  assert.throws(() => prepareClipboardMarkdownFile("文".repeat(Math.floor(CLIPBOARD_MARKDOWN_MAX_BYTES / 3) + 1), "Too large"), /10 MiB/u);
  assert.throws(() => prepareClipboardMarkdownFile(" \n\t", "Empty"), /Paste some/u);
  for (const title of ["", "../note", "a\\b", "a\nname", "x".repeat(241)]) {
    assert.throws(() => prepareClipboardMarkdownFile("body", title), /title/u);
  }
});
