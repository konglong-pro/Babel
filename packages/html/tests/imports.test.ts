import assert from "node:assert/strict";
import test from "node:test";
import { HTML_MAX_BUNDLE_BYTES, HTML_MAX_BUNDLE_FILES, HTML_MAX_DOCUMENT_BYTES } from "@babel-apps/platform/html/core";
import { htmlTitle, prepareHtmlImport } from "../src/imports";

function file(name: string, path = name, content = "<h1>Example</h1>"): File {
  const result = new File([content], name);
  Object.defineProperty(result, "webkitRelativePath", { value: path });
  return result;
}

test("directory imports preserve local resources once and list HTML entries in natural order", () => {
  const html = file("chapter10.htm", "Books/chapter10.htm");
  const css = file("style.css", "Books/resources/style.css", "body{color:red}");
  const js = file("app.js", "Books/resources/app.js", "console.log('offline')");
  const nested = file("chapter2.HTML", "Books/nested/chapter2.HTML");
  const selection = prepareHtmlImport([html, css, js, nested], true);
  assert.equal(selection.error, "");
  assert.equal(selection.folder, "Books");
  assert.deepEqual(selection.files.map(({ path }) => path), ["Books/chapter10.htm", "Books/resources/style.css", "Books/resources/app.js", "Books/nested/chapter2.HTML"]);
  assert.deepEqual(selection.entries.map(({ path, folderPath }) => [path, folderPath]), [
    ["Books/chapter10.htm", ["Books"]], ["Books/nested/chapter2.HTML", ["Books", "nested"]],
  ]);
  assert.equal(selection.files[0].file, html);
  assert.equal(selection.files[0].file.name, "chapter10.htm");
  assert.equal(new Set(selection.files.map(({ field }) => field)).size, 4);
});

test("single HTML imports use the basename and validate document bytes and type", () => {
  const selection = prepareHtmlImport([file("page.html", "Folder/page.html")], false);
  assert.equal(selection.files[0].path, "page.html");
  assert.deepEqual(selection.entries[0].folderPath, []);
  assert.equal(selection.error, "");
  assert.ok(prepareHtmlImport([file("readme.txt")], false).error.includes("No .html"));
  assert.ok(prepareHtmlImport([file("empty.htm", "empty.htm", "")], false).entries[0].error.includes("nonempty"));
  const oversized = file("oversized.html");
  Object.defineProperty(oversized, "size", { value: HTML_MAX_DOCUMENT_BYTES + 1 });
  const batch = prepareHtmlImport([oversized, file("valid.html")], true);
  assert.equal(batch.error, "");
  assert.ok(batch.entries.find(entry => entry.path === "oversized.html")?.error.includes("64 MiB"));
  assert.equal(batch.entries.find(entry => entry.path === "valid.html")?.error, "");
  assert.equal(htmlTitle(".html"), "Untitled HTML");
  assert.equal(htmlTitle(`${"a".repeat(300)}.html`).length, 240);
});

test("unsafe or duplicate bundle paths and excessive resource limits fail before upload", () => {
  assert.ok(prepareHtmlImport([file("page.html", "Books/../page.html")], true).error);
  assert.ok(prepareHtmlImport([file("page.html", "Books/page.html"), file("page.html", "Books/page.html")], true).error.includes("same resource path"));
  assert.ok(prepareHtmlImport([file("page.html", "Books/page.html"), file("PAGE.HTML", "Books/PAGE.HTML")], true).error.includes("same resource path"));
  const large = file("page.html");
  Object.defineProperty(large, "size", { value: HTML_MAX_BUNDLE_BYTES + 1 });
  assert.ok(prepareHtmlImport([large], false).error.includes("512 MiB"));
  const many = Array.from({ length: HTML_MAX_BUNDLE_FILES + 1 }, (_, index) => file(index ? `${index}.json` : "index.html"));
  assert.ok(prepareHtmlImport(many, true).error.includes("5,000"));
  assert.ok(prepareHtmlImport([file("page.html", `${"level/".repeat(33)}page.html`)], true).entries[0].error.includes("32 levels"));
});
