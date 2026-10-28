import assert from "node:assert/strict";
import test from "node:test";
import { htmlResourceWarnings, inspectHtmlResources, resolveHtmlResource } from "../src/resources";

const entry = "GaokaoMath/modules/m02-functions.html";
const references = ["../assets/katex/katex.min.css", "../assets/css/style.css", "../assets/katex/katex.min.js", "../assets/katex/auto-render.min.js", "../assets/js/app.js"];
const files = references.map((reference) => reference.replace("../", "GaokaoMath/"));

test("project folder imports resolve sibling assets while incomplete single/module imports report all dependencies", () => {
  assert.deepEqual(htmlResourceWarnings(references, entry, [entry, ...files]), []);
  for (const path of ["m02-functions.html", "modules/m02-functions.html"]) {
    const warnings = htmlResourceWarnings(references, path, [path]);
    assert.equal(warnings.length, 5);
    for (const reference of references) assert.ok(warnings.includes(`Missing local resource: ${reference}`));
  }
  assert.equal(htmlResourceWarnings([references[0], references[0]], entry, []).length, 1);
});

test("resource checks match browser URL paths with query strings, fragments, encoded Unicode and project roots", () => {
  const available = ["GaokaoMath/assets/Cafe\u0301 chart.svg", "assets/root.css"];
  assert.deepEqual(htmlResourceWarnings(["../assets/Caf%C3%A9%20chart.svg?v=2#plot", "/assets/root.css?v=3"], entry, available), []);
  assert.deepEqual(resolveHtmlResource("../assets/css/style.css?version=1#theme", entry), { kind: "local", path: "GaokaoMath/assets/css/style.css" });
  assert.deepEqual(resolveHtmlResource("data:image/png;base64,AA", entry), { kind: "inline" });
  assert.deepEqual(resolveHtmlResource("#internal", entry), { kind: "inline" });
});

test("outside URLs and traversal remain blocked and are never matched by basename", () => {
  const base = "http://127.0.0.1:3000/api/html/documents/00000000-0000-4000-8000-000000000000/assets/";
  for (const reference of ["https://cdn.example.com/style.css", "//example.com/script.js", "../../../../api/notes", "javascript:alert(1)", `${base}../private.css`]) {
    assert.deepEqual(resolveHtmlResource(reference, entry, base), { kind: "outside" });
  }
  assert.deepEqual(resolveHtmlResource("../assets/%zz.css", entry), { kind: "invalid" });
  assert.match(htmlResourceWarnings(["../assets/css/style.css"], entry, ["style.css"])[0], /^Missing local resource:/u);
  assert.deepEqual(htmlResourceWarnings(["#s1", "data:image/png;base64,AA", "blob:https://example.com/id"], entry, []), []);
});

test("resource inspection covers rendering dependencies without treating navigation links as missing assets", () => {
  const elements = [
    { src: references[2] }, { href: references[0] }, { poster: "../assets/preview.png" },
  ];
  const document = { querySelectorAll(selector: string) {
    assert.ok(selector.includes("script[src]"));
    assert.ok(!selector.includes("a[href]"));
    return elements.map((attributes) => ({ getAttribute(name: string) { return attributes[name as keyof typeof attributes] ?? null; } }));
  } } as unknown as Document;
  assert.deepEqual(inspectHtmlResources(document, entry, files), ["Missing local resource: ../assets/preview.png"]);
});
