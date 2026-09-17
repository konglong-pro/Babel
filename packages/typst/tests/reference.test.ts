import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  MemoryAccessModel,
  createTypstCompiler,
  createTypstRenderer,
  initOptions,
  loadFonts,
  type TypstCompiler,
} from "@myriaddreamin/typst.ts";

import {
  buildTypstFormulaDocument,
  sanitizeTypstSvg,
  stripTypstInteractiveSvgLayers,
} from "../src/core";
import {
  TYPST_LANGUAGE_VERSION,
  TYPST_REFERENCE_VERSION,
  typstMathReferenceGroups,
  typstMathReferenceRows,
} from "../src/reference";

const FONT_NAMES = [
  "NewCM10-Regular.otf",
  "NewCM10-Italic.otf",
  "NewCM10-Bold.otf",
  "NewCM10-BoldItalic.otf",
  "NewCMMath-Regular.otf",
  "NewCMMath-Book.otf",
  "NewCMMath-Bold.otf",
] as const;

test("publishes a structured, versioned reference without duplicate IDs", () => {
  assert.equal(TYPST_LANGUAGE_VERSION, "0.14.2");
  assert.equal(TYPST_REFERENCE_VERSION, "typst-0.14.2");
  assert.ok(typstMathReferenceGroups.length >= 10);
  assert.ok(typstMathReferenceRows.length >= 100);
  assert.equal(new Set(typstMathReferenceGroups.map(({ id }) => id)).size, typstMathReferenceGroups.length);
  assert.equal(new Set(typstMathReferenceRows.map(({ id }) => id)).size, typstMathReferenceRows.length);
  assert.ok(typstMathReferenceRows.every(({ example }) => example.trim() === example));
  assert.ok(typstMathReferenceRows.every(({ example }) => !example.startsWith("$") && !example.endsWith("$")));
});

test("every reference example compiles with the pinned real Typst engine", async () => {
  const compiler = await createCompiler();
  const failures: string[] = [];

  for (const row of typstMathReferenceRows) {
    const wrapped = buildTypstFormulaDocument(row.example, row.display ?? "inline");
    await compiler.reset();
    compiler.addSource("/formula.typ", wrapped.document);
    const result = await compiler.compile({
      mainFilePath: "/formula.typ",
      root: "/",
      inputs: {},
      diagnostics: "full",
    });
    if (result.result === undefined) {
      const diagnostics = (result.diagnostics ?? [])
        .map((diagnostic) => `${diagnostic.range} ${diagnostic.message}`)
        .join("; ");
      failures.push(`${row.id}: ${diagnostics || "no artifact"}`);
    }
  }

  assert.deepEqual(failures, []);
});

test("the real memory-only compiler cannot import, read, or load images", async () => {
  const compiler = await createCompiler();
  for (const source of [
    '#import "@preview/example:1.0.0": *',
    '#read("/private.txt")',
    '#image("/private.png")',
  ]) {
    await compiler.reset();
    compiler.addSource("/formula.typ", source);
    const result = await compiler.compile({
      mainFilePath: "/formula.typ",
      root: "/",
      inputs: {},
      diagnostics: "full",
    });
    assert.equal(result.result, undefined, `unexpectedly compiled external capability: ${source}`);
    assert.ok((result.diagnostics?.length ?? 0) > 0);
  }
});

test("the pinned real renderer produces SVG accepted by the safety boundary", async () => {
  const compiler = await createCompiler();
  const wrapped = buildTypstFormulaDocument("sum_(i=1)^n i", "block");
  await compiler.reset();
  compiler.addSource("/formula.typ", wrapped.document);
  const compiled = await compiler.compile({
    mainFilePath: "/formula.typ",
    root: "/",
    inputs: {},
    diagnostics: "full",
  });
  assert.ok(compiled.result !== undefined);

  const renderer = createTypstRenderer();
  const rendererWasm = await readFile(fileURLToPath(
    import.meta.resolve("@myriaddreamin/typst-ts-renderer/wasm"),
  ));
  await renderer.init({ getModule: () => rendererWasm });
  const svg = sanitizeTypstSvg(stripTypstInteractiveSvgLayers(
    await renderer.renderSvg({
      format: "vector",
      artifactContent: compiled.result,
      data_selection: { body: true, defs: true, css: true, js: false },
    }),
  ));
  assert.match(svg, /^<svg\b/u);
  assert.match(svg, /<path\b/u);
});

let compilerPromise: Promise<TypstCompiler> | undefined;

function createCompiler(): Promise<TypstCompiler> {
  compilerPromise ??= initializeCompiler();
  return compilerPromise;
}

async function initializeCompiler(): Promise<TypstCompiler> {
  const compiler = createTypstCompiler();
  const wasmPath = fileURLToPath(import.meta.resolve("@myriaddreamin/typst-ts-web-compiler/wasm"));
  const wasm = await readFile(wasmPath);
  const fonts = await Promise.all(FONT_NAMES.map((name) => {
    return readFile(new URL(`../assets/fonts/${name}`, import.meta.url));
  }));
  await compiler.init({
    getModule: () => wasm,
    beforeBuild: [
      initOptions.withAccessModel(new MemoryAccessModel()),
      loadFonts(fonts, { assets: false }),
    ],
  });
  return compiler;
}
