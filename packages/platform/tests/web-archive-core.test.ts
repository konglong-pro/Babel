import assert from "node:assert/strict";
import test from "node:test";

import {
  WEB_ARCHIVE_MAX_ASSET_BYTES,
  WEB_ARCHIVE_MAX_BYTES,
  WEB_ARCHIVE_MAX_MARKDOWN_BYTES,
  WEB_ARCHIVE_MAX_NODES,
  decodeWebArchiveAsset,
  parseWebArchive,
  renderWebArchiveSnapshot,
  validateWebArchive,
  type WebSnapshotNode,
} from "../src/imports/web-archive-core";
import { archiveFixture, archivePng } from "./web-archive-fixture";

test("validates portable raster archives and renders escaped static layout without fetching", context => {
  const fetch = context.mock.method(globalThis, "fetch", async () => { throw new Error("Archives must remain offline"); });
  const fixture = archiveFixture();
  const archive = parseWebArchive(new TextEncoder().encode(JSON.stringify(fixture)));
  assert.deepEqual(archive, fixture);
  assert.notEqual(archive.snapshot.tree, fixture.snapshot.tree);
  assert.deepEqual([...decodeWebArchiveAsset(archive.assets[0])], [...Buffer.from(archivePng, "base64")]);
  const html = renderWebArchiveSnapshot(archive);
  assert.match(html, /^<!doctype html>/u);
  assert.match(html, /Wave &lt;caption&gt; &amp; explanation/u);
  assert.match(html, /alt="Wave &quot;diagram&quot;"/u);
  assert.ok(html.includes(`src="data:image/png;base64,${archivePng}"`));
  assert.match(html, /grid-template-columns:minmax\(0px, 1fr\)/u);
  assert.match(html, /&quot;Arial&quot;, sans-serif/u);
  assert.doesNotMatch(html, /babel-asset:|https?:|<script|<iframe|<style|<link/u);
  assert.equal(fetch.mock.callCount(), 0);
});

test("rejects original HTML, active elements, event attributes, external URLs and CSS loading/injection", () => {
  for (const tag of ["script", "style", "iframe", "object", "embed", "svg", "math", "canvas", "form", "input", "meta", "link", "template", "base", "video"]) {
    const archive = archiveFixture(); archive.snapshot.tree = { tag, children: [] };
    assert.throws(() => validateWebArchive(archive), { code: "INVALID_WEB_ARCHIVE" }, tag);
  }
  for (const node of [
    { tag: "div", attrs: { onclick: "alert(1)" } },
    { tag: "div", attrs: { style: "color:red" } },
    { tag: "div", attrs: { srcdoc: "<script>alert(1)</script>" } },
    { tag: "img", attrs: { src: "https://example.test/image.png" } },
    { tag: "img", attrs: { src: `data:image/png;base64,${archivePng}` } },
    { tag: "img", attrs: { src: "babel-asset://missing" } },
    { tag: "img", attrs: { src: "babel-asset://wave", srcset: "https://example.test/2.png 2x" } },
    { tag: "a", attrs: { href: "https://example.test/" } },
    { tag: "a", attrs: { href: "javascript:alert(1)" } },
    { tag: "div", style: { "background-image": "none" } },
    { tag: "div", style: { "--payload": "red" } },
    { tag: "div", style: { "font-family": "x".repeat(1_001) } },
    ...["url(https://example.test)", "uRl ('x')", "expression(alert(1))", "red;display:none", "red/*comment*/", "red\\3b color:red", '</div><script>alert(1)</script>', "red\n"].map(value => ({ tag: "div", style: { color: value } })),
  ]) {
    const archive = archiveFixture(); archive.snapshot.tree = node as WebSnapshotNode;
    assert.throws(() => validateWebArchive(archive), { code: "INVALID_WEB_ARCHIVE" }, JSON.stringify(node));
  }
  const raw = { ...archiveFixture(), html: "<script>alert(1)</script>" };
  assert.throws(() => validateWebArchive(raw), { code: "INVALID_WEB_ARCHIVE" });
  const mutated = archiveFixture(); mutated.snapshot.tree.attrs = { onload: "alert(1)" };
  assert.throws(() => renderWebArchiveSnapshot(mutated), { code: "INVALID_WEB_ARCHIVE" });
});

test("static links stay local and literal markup is text, while snapshot-only source images are retained", () => {
  const archive = archiveFixture();
  archive.markdown = "Text without image references";
  archive.snapshot.tree.children!.push({ tag: "a", attrs: { href: "#caption", title: '"><img src=x onerror=alert(1)>' }, children: ["<script>alert(1)</script>"] });
  const html = renderWebArchiveSnapshot(archive);
  assert.match(html, /href="#caption"/u);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/u);
  assert.match(html, /title="&quot;&gt;&lt;img src=x onerror=alert\(1\)&gt;"/u);
  assert.ok(html.includes(`src="data:image/png;base64,${archivePng}"`));
});

test("direct validation rejects sparse arrays instead of returning an unrenderable tree", () => {
  const children = archiveFixture(); children.snapshot.tree.children = Array(1);
  const assets = archiveFixture(); assets.assets = Array(1);
  const warnings = archiveFixture(); warnings.warnings = Array(1);
  for (const archive of [children, assets, warnings]) {
    assert.throws(() => validateWebArchive(archive), { code: "INVALID_WEB_ARCHIVE" });
  }
});

test("enforces fatal UTF-8, wire/Markdown byte limits, node count, depth and cyclic input", () => {
  assert.throws(() => parseWebArchive(new Uint8Array([255, 254])), /UTF-8/u);
  assert.throws(() => parseWebArchive(new TextEncoder().encode("not JSON")), /JSON/u);
  assert.throws(() => parseWebArchive(new Uint8Array(WEB_ARCHIVE_MAX_BYTES + 1)), /150 MiB/u);
  const markdown = archiveFixture(); markdown.markdown = "字".repeat(Math.ceil(WEB_ARCHIVE_MAX_MARKDOWN_BYTES / 3));
  assert.throws(() => validateWebArchive(markdown), /10 MiB/u);
  const nodes = archiveFixture(); nodes.snapshot.tree = { tag: "div", children: Array(WEB_ARCHIVE_MAX_NODES).fill("x") };
  assert.throws(() => validateWebArchive(nodes), /30,000/u);
  const deep = archiveFixture(); let tree: WebSnapshotNode = { tag: "span" };
  for (let index = 1; index < 80; index++) tree = { tag: "span", children: [tree] };
  deep.snapshot.tree = tree;
  assert.doesNotThrow(() => validateWebArchive(deep));
  const leaf = tree;
  let deepest = leaf;
  while (deepest.children) deepest = deepest.children[0] as WebSnapshotNode;
  deepest.children = ["text would be at depth 81"];
  assert.throws(() => validateWebArchive(deep), /depth 80/u);
  deepest.children = [];
  deep.snapshot.tree = { tag: "div", children: [tree] };
  assert.throws(() => validateWebArchive(deep), /depth 80/u);
  const cycle = archiveFixture(); cycle.snapshot.tree.children = [cycle.snapshot.tree];
  assert.throws(() => validateWebArchive(cycle), /depth 80/u);
  const repeatedText = archiveFixture();
  // Shared strings keep the fixture small while exercising cumulative JSON size.
  repeatedText.snapshot.tree = { tag: "div", children: Array(26).fill("\u0000".repeat(1024 * 1024)) };
  assert.throws(() => validateWebArchive(repeatedText), /150 MiB/u);
});

test("rejects invalid raster magic, noncanonical base64, duplicate/path assets and per-asset overflow", () => {
  for (const dataBase64 of ["", archivePng + "=", " " + archivePng, "AB==", Buffer.from("<svg onload='alert(1)'/>").toString("base64")]) {
    const archive = archiveFixture(); archive.assets[0].dataBase64 = dataBase64;
    assert.throws(() => validateWebArchive(archive), { code: "INVALID_WEB_ARCHIVE" });
  }
  const mismatch = archiveFixture(); mismatch.assets[0].mimeType = "image/jpeg"; mismatch.assets[0].name = "wave.jpg";
  assert.throws(() => validateWebArchive(mismatch), /raster type/u);
  for (const name of ["../wave.png", "a\\wave.png", "wave.svg", "x".repeat(121) + ".png"]) {
    const archive = archiveFixture(); archive.assets[0].name = name;
    assert.throws(() => validateWebArchive(archive), { code: "INVALID_WEB_ARCHIVE" });
  }
  const unicode = archiveFixture(); unicode.assets[0].name = "波形.png";
  assert.doesNotThrow(() => validateWebArchive(unicode));
  const duplicates = archiveFixture(); duplicates.assets.push({ ...duplicates.assets[0] });
  assert.throws(() => validateWebArchive(duplicates), /unique/u);
  const count = archiveFixture(); count.assets = Array(51).fill(count.assets[0]);
  assert.throws(() => validateWebArchive(count), /50 assets/u);
  const huge = archiveFixture(); huge.assets[0].dataBase64 = Buffer.alloc(WEB_ARCHIVE_MAX_ASSET_BYTES + 1).toString("base64");
  assert.throws(() => validateWebArchive(huge), /10 MiB/u);
});

test("accepts actual PNG, JPEG, WebP and GIF rasters while rejecting mismatched declarations", () => {
  // One-pixel synthetic fixtures generated locally; no image tooling is needed at runtime.
  const rasters = [
    ["png", "image/png", archivePng],
    ["jpg", "image/jpeg", "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJ4B4L//2Q=="],
    ["webp", "image/webp", "UklGRjAAAABXRUJQVlA4ICQAAABQAQCdASoBAAEAAUAmJQBOgCgAAP7i4LkdhDdhy64ubIbwAAA="],
    ["gif", "image/gif", "R0lGODlhAQABAIAAAExpcWR4jCH5BAUAAAAALAAAAAABAAEAAAICTAEAOw=="],
  ] as const;
  for (const [extension, mimeType, dataBase64] of rasters) {
    const archive = archiveFixture();
    archive.assets = [{ id: "wave", name: `wave.${extension}`, mimeType, dataBase64 }];
    assert.doesNotThrow(() => validateWebArchive(archive), mimeType);
    assert.ok(renderWebArchiveSnapshot(archive).includes(`src="data:${mimeType};base64,${dataBase64}"`));
    archive.assets[0].mimeType = mimeType === "image/png" ? "image/gif" : "image/png";
    archive.assets[0].name = mimeType === "image/png" ? "wave.gif" : "wave.png";
    assert.throws(() => validateWebArchive(archive), /raster type/u);
  }
});

test("bounds repeated raster expansion in rendered HTML before creating a large output string", () => {
  const archive = archiveFixture();
  const raster = Buffer.alloc(1024 * 1024);
  Buffer.from(archivePng, "base64").copy(raster);
  archive.assets[0].dataBase64 = raster.toString("base64");
  archive.snapshot.tree = { tag: "div", children: Array.from({ length: 120 }, () => ({ tag: "img", attrs: { src: "babel-asset://wave" } })) };
  assert.ok(JSON.stringify(archive).length < 2 * 1024 * 1024, "the wire payload alone cannot detect repeated data URLs");
  assert.throws(() => validateWebArchive(archive), /rendered snapshot exceeds 150 MiB/u);
  assert.throws(() => parseWebArchive(new TextEncoder().encode(JSON.stringify(archive))), /rendered snapshot exceeds 150 MiB/u);
  assert.throws(() => renderWebArchiveSnapshot(archive), /rendered snapshot exceeds 150 MiB/u);
});

test("enforces the aggregate 100 MiB decoded raster budget even when wire size still fits", () => {
  const archive = archiveFixture();
  const raster = Buffer.alloc(WEB_ARCHIVE_MAX_ASSET_BYTES);
  Buffer.from(archivePng, "base64").copy(raster);
  const dataBase64 = raster.toString("base64");
  archive.assets = Array.from({ length: 11 }, (_, index) => ({ id: `image-${index}`, name: `image-${index}.png`, mimeType: "image/png" as const, dataBase64 }));
  archive.snapshot.tree = { tag: "p", children: ["Source assets need not appear in Markdown or the snapshot."] };
  assert.throws(() => validateWebArchive(archive), /100 MiB/u);
});
