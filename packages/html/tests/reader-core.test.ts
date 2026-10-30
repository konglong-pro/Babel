import assert from "node:assert/strict";
import test from "node:test";
import { decodeHtmlBytes } from "../src/reader-core";

test("HTML decoding honors BOM and browser-saved charset declarations", () => {
  assert.equal(decodeHtmlBytes(new TextEncoder().encode("<h1>Chemistry</h1>")), "<h1>Chemistry</h1>");
  assert.equal(decodeHtmlBytes(Uint8Array.from([0xff, 0xfe, 65, 0, 66, 0])), "AB");
  assert.equal(decodeHtmlBytes(Uint8Array.from([0xfe, 0xff, 0, 65, 0, 66])), "AB");
  const latin = Buffer.concat([Buffer.from('<meta charset="windows-1252"><p>caf'), Buffer.from([0xe9]), Buffer.from("</p>")]);
  assert.ok(decodeHtmlBytes(latin).includes("café"));
  assert.ok(decodeHtmlBytes(Buffer.from('<meta charset="unsupported-label"><h1>Safe fallback</h1>')).includes("Safe fallback"));
});
