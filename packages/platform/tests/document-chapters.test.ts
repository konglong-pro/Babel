import assert from "node:assert/strict";
import test from "node:test";

import { omitMarkdownImages, preflightMarkdownFolder } from "../src/imports/core";
import { splitDocumentChapters, validDocumentChapters } from "../src/imports/document-core";
import { convertDocumentFile, prepareDocumentChapterFiles } from "../src/imports/document-client";
import { validateConversionResult } from "../src/imports/document-server";

test("converted images with parent paths, nested alt text and reference syntax are omitted without touching code", () => {
  const code = '`![code](../images/example.png)`\n\n```md\n![fenced](../images/example.png)\n```\n';
  const markdown = 'Before ![plot [31] \\]](../images/p031_01.png "Caption") after\n' +
    '![multiline](\n<../images/plot.png>\n)\n![full][image]\n![shortcut]\n![collapsed][]\n' +
    '[image]: ../images/one.png\n[shortcut]: ../images/two.png\n[collapsed]: ../images/three.png\n' +
    '<img src="../images/html.png">\n' + code + '\n[Chapter](chapter.xhtml)';
  const omitted = omitMarkdownImages(markdown);
  assert.ok(omitted.startsWith("Before  after\n"));
  assert.ok(omitted.includes(code));
  assert.ok(omitted.includes("[Chapter](chapter.xhtml)"));
  for (const fragment of ["p031_01", "![multiline]", "![full]", "![shortcut]", "![collapsed]", '<img src=']) {
    assert.ok(!omitted.includes(fragment), fragment);
  }
});

test("automatic chapter detection retains introductory text and ignores subheadings and code", () => {
  const markdown = '# The book\n\nIntroduction.\n\n## Chapter 1: Start\n\nText.\n### Detail\nMore text.\n' +
    '```md\n## Chapter 99: Example\n```\n\n## Chapter 2: Finish\n\nEnd.\n';
  const chapters = splitDocumentChapters(markdown, "The book");
  assert.deepEqual(chapters.map(chapter => chapter.title), ["The book — Introduction", "Chapter 1: Start", "Chapter 2: Finish"]);
  assert.ok(chapters[1].markdown.includes("Chapter 99"));
  assert.equal(chapters.map(chapter => chapter.markdown).join(""), markdown);
});

test("heading detection supports Chinese chapters, setext headings, CRLF, C# and a chosen heading level", () => {
  const chinese = '简介\r\n\r\n# 第一章 入门\r\n正文\r\n## 小节\r\n细节\r\n# 第二章 完成\r\n结束';
  assert.deepEqual(splitDocumentChapters(chinese, "书").map(chapter => chapter.title), ["书 — Introduction", "第一章 入门", "第二章 完成"]);
  assert.equal(splitDocumentChapters(chinese, "书").map(chapter => chapter.markdown).join(""), chinese);
  assert.deepEqual(splitDocumentChapters('Start\n===\nText\nFinish\n===\nEnd', "Book").map(chapter => chapter.title), ["Start", "Finish"]);
  assert.deepEqual(splitDocumentChapters('## C#\nText\n## Python ###\nEnd', "Book").map(chapter => chapter.title), ["C#", "Python"]);
  const selected = splitDocumentChapters('# Book\n## One\n### A\nText\n### B\nMore', "Book", 3);
  assert.deepEqual(selected.map(chapter => chapter.title), ["Book — Introduction", "A", "B"]);
  assert.equal(splitDocumentChapters("Plain text without headings", "Book").length, 1);
});

test("virtual chapter files keep order and reviewed titles while mapping directly to the current folder", async () => {
  const files = prepareDocumentChapterFiles([
    { title: "Zebra", markdown: "# Zebra\nFirst chapter." },
    { title: "Alpha", markdown: "# Alpha\nSecond chapter." },
  ], "Imported book");
  const preflight = await preflightMarkdownFolder(files);
  assert.equal(preflight.rootName, "Imported book");
  assert.deepEqual(preflight.notes.map(note => [note.sourcePath, note.sourceDirectory, note.defaultTitle]), [
    ["0001.md", "", "Zebra"], ["0002.md", "", "Alpha"],
  ]);
  assert.equal(preflight.notes[0].contentMd, "# Zebra\nFirst chapter.");
  assert.equal(preflight.issues.filter(issue => issue.blocking).length, 0);
  assert.equal(preflight.uploads.length, 2);
});

test("chapter preparation rejects empty selections, titles, content and oversized notes before staging", () => {
  assert.throws(() => prepareDocumentChapterFiles([]), /Choose between/u);
  assert.throws(() => prepareDocumentChapterFiles(Array.from({ length: 1001 }, () => ({ title: "Title", markdown: "Text" }))), /1,000/u);
  for (const title of ["", "../unsafe", "Bad\\title", "Line\nbreak", "a".repeat(241)]) {
    assert.throws(() => prepareDocumentChapterFiles([{ title, markdown: "Text" }]), /valid title/u);
  }
  assert.throws(() => prepareDocumentChapterFiles([{ title: "Title", markdown: " \n" }]), /empty/u);
  assert.throws(() => prepareDocumentChapterFiles([{ title: "Title", markdown: "字".repeat(4 * 1024 * 1024) }]), /10 MiB/u);
});

test("server validates chapter metadata and safely filters image references in both previews", () => {
  const conversion = {
    markdown: '# Book\n![plot [31]](../images/p031_01.png)\nText', title: "Book", warnings: [], sdkVersion: "fixture",
    chapters: [{ title: "Chapter 1", markdown: '![plot [31]](../images/p031_01.png)\nText' }], chapterSource: "epub-toc",
  };
  const validated = validateConversionResult(conversion);
  assert.equal(validated.markdown, "# Book\n\nText");
  assert.equal(validated.chapters![0].markdown, "\nText");
  assert.ok(validated.warnings.some(warning => warning.includes("Images")));
  for (const chapters of [[], [null], [{ title: "T", markdown: " " }], [{ title: 5, markdown: "Text" }],
    Array.from({ length: 1001 }, () => ({ title: "T", markdown: "Text" }))]) {
    assert.equal(validDocumentChapters(chapters), false);
    assert.throws(() => validateConversionResult({ ...conversion, chapters }), { code: "INVALID_CONVERSION" });
  }
  assert.throws(() => validateConversionResult({ ...conversion, chapterSource: "remote" }), { code: "INVALID_CONVERSION" });
});

test("browser conversion rejects malformed chapter metadata and accepts validated EPUB sections", async (context) => {
  const result = { markdown: "Text", title: "Book", warnings: [], sdkVersion: "fixture", chapters: [{ title: "One", markdown: "Text" }], chapterSource: "epub-toc" };
  const fetchMock = context.mock.method(globalThis, "fetch", async () => Response.json(result));
  const file = new File(["source"], "book.epub");
  assert.deepEqual(await convertDocumentFile(file), result);
  for (const change of [{ chapters: [] }, { chapters: [null] }, { chapterSource: "remote" }]) {
    fetchMock.mock.mockImplementation(async () => Response.json({ ...result, ...change }));
    await assert.rejects(convertDocumentFile(file), /invalid book sections/u);
  }
});
