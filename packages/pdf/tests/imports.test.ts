import assert from "node:assert/strict";
import test from "node:test";
import { PDF_MAX_FILE_BYTES } from "@babel-apps/platform/pdf/core";
import { pdfImportError, preparePdfFolder } from "../src/imports";

function fixture(name: string, relativePath = name): File {
  const file = new File(["%PDF-1.7\n"], name, { type: "application/pdf" });
  Object.defineProperty(file, "webkitRelativePath", { value: relativePath });
  return file;
}

test("folder imports include nested PDFs in stable natural order and skip other files", () => {
  const first = fixture("chapter10.PDF", "Books/nested/chapter10.PDF");
  const second = fixture("chapter2.pdf", "Books/nested/chapter2.pdf");
  const ignored = fixture("notes.txt", "Books/notes.txt");
  const result = preparePdfFolder([first, ignored, second]);
  assert.equal(result.folder, "Books");
  assert.equal(result.skipped, 1);
  assert.deepEqual(result.files.map(({ label, title }) => [label, title]), [
    ["Books/nested/chapter2.pdf", "chapter2"], ["Books/nested/chapter10.PDF", "chapter10"],
  ]);
  assert.equal(result.files[0].file, second);
  assert.equal(result.files[1].file, first);
});

test("validation is per file, including empty and oversized files, without reading file contents", () => {
  assert.equal(pdfImportError({ size: 0 }), "Choose a nonempty PDF file.");
  assert.equal(pdfImportError({ size: PDF_MAX_FILE_BYTES }), "");
  assert.equal(pdfImportError({ size: PDF_MAX_FILE_BYTES + 1 }), "PDF files must not exceed 512 MiB.");
  const empty = new File([], "empty.pdf");
  const large = fixture("large.pdf");
  Object.defineProperty(large, "size", { value: PDF_MAX_FILE_BYTES + 1 });
  assert.deepEqual(preparePdfFolder([empty, large]).files.map(({ error }) => error), [
    "Choose a nonempty PDF file.", "PDF files must not exceed 512 MiB.",
  ]);
});

test("titles preserve the filename, use the title limit and never turn folder paths into upload names", () => {
  const book = fixture("book.pdf", "Books/notes/book.pdf");
  const result = preparePdfFolder([book, fixture(`${"a".repeat(250)}.pdf`), fixture(".pdf")]);
  const entry = result.files.find(({ title }) => title === "book")!;
  assert.equal(entry.label, "Books/notes/book.pdf");
  assert.equal(entry.file.name, "book.pdf");
  assert.ok(result.files.some(({ title }) => title.length === 240));
  assert.ok(result.files.some(({ title }) => title === "Untitled PDF"));
  assert.deepEqual(preparePdfFolder([]).files, []);
});
