import assert from "node:assert/strict";
import test from "node:test";

import {
  TYPST_LANGUAGE_VERSION,
  TYPST_TS_VERSION,
  TypstFormulaCompilerClient,
  buildTypstFormulaDocument,
  defaultTypstRuntimeConfig,
  findForbiddenTypstCapability,
  parseSvgDimensions,
  sanitizeTypstSvg,
  stripTypstInteractiveSvgLayers,
  type TypstCompileResult,
  type TypstWorkerCompileRequest,
  type TypstWorkerCompileResponse,
  type TypstWorkerLike,
} from "../src/core";

test("keeps the Typst.ts package and embedded language versions explicit", () => {
  assert.equal(TYPST_TS_VERSION, "0.7.0");
  assert.equal(TYPST_LANGUAGE_VERSION, "0.14.2");
});

test("uses only local runtime asset paths by default", () => {
  const urls = [
    defaultTypstRuntimeConfig.compilerWasmUrl,
    defaultTypstRuntimeConfig.rendererWasmUrl,
    ...defaultTypstRuntimeConfig.fontUrls,
  ];
  assert.ok(urls.every((url) => url.startsWith("/_typst/")));
  assert.ok(urls.every((url) => !url.includes("://")));
});

test("rejects URLs browsers could resolve away from the same origin", () => {
  for (const compilerWasmUrl of [
    "https://cdn.example/compiler.wasm",
    "//cdn.example/compiler.wasm",
    String.raw`\\cdn.example\compiler.wasm`,
    String.raw`/\cdn.example/compiler.wasm`,
    " /_typst/compiler.wasm",
    "/_typst/compiler.wasm\n",
  ]) {
    assert.throws(
      () => new TypstFormulaCompilerClient({ config: { compilerWasmUrl } }),
      /same-origin path/u,
    );
  }
});

test("wraps formulas in a transparent auto-sized Typst document", () => {
  const inline = buildTypstFormulaDocument("x^2", "inline", "#ABC");
  const block = buildTypstFormulaDocument("sum_(i=1)^n i", "block");

  assert.match(inline.document, /page\(width: auto, height: auto, margin: 0pt, fill: none\)/u);
  assert.match(inline.document, /rgb\("#aabbcc"\)/u);
  assert.match(inline.document, /#box\(\$x\^2\$\)$/u);
  assert.match(block.document, /#box\(\$ sum_\(i=1\)\^n i \$\)$/u);
  assert.deepEqual(inline.sourceStart, { line: 3, column: 7 });
});

test("sanitizes SVG and extracts positive dimensions", () => {
  const svg = sanitizeTypstSvg("<?xml version=\"1.0\"?><svg width=\"20pt\" height=\"8.5pt\"><path d=\"M0 0\"/></svg>");
  assert.equal(svg.startsWith("<svg"), true);
  assert.deepEqual(parseSvgDimensions(svg), { width: 20, height: 8.5 });
  assert.throws(() => sanitizeTypstSvg("<svg><script>alert(1)</script></svg>"), /forbidden/u);
  assert.throws(() => sanitizeTypstSvg("<svg><a href=\"https://example.test\"/></svg>"), /external/u);
  assert.throws(() => sanitizeTypstSvg("<svg><image href=\"data:image/png;base64,AA==\"/></svg>"), /external/u);
  assert.throws(() => sanitizeTypstSvg("<svg><a href=\"&#x68;ttps://example.test\"/></svg>"), /external/u);
  assert.throws(() => sanitizeTypstSvg("<svg onload=\"alert(1)\"/>"), /event handler/u);
  assert.equal(sanitizeTypstSvg('<svg><defs><path id="p"/></defs><use href="#p"/></svg>').includes("#p"), true);
  assert.equal(
    sanitizeTypstSvg(stripTypstInteractiveSvgLayers(
      '<svg><foreignObject><div>selection</div></foreignObject><script>bad()</script><path/></svg>',
    )),
    "<svg><path/></svg>",
  );
});

test("rejects import, read, and image capabilities before worker dispatch", async () => {
  const worker = new FakeWorker();
  const client = new TypstFormulaCompilerClient({ workerFactory: () => worker });

  for (const [source, expected] of [
    ['#import "@preview/example:1.0.0": *', "import"],
    ['#read("/private.txt")', "read"],
    ['#image("/private.png")', "image"],
  ] as const) {
    assert.equal(findForbiddenTypstCapability(source), expected);
    const result = await client.compile({ source });
    assert.equal(result.ok, false);
    assert.match(result.diagnostics[0]?.message ?? "", new RegExp(expected, "u"));
  }
  assert.equal(worker.requests.length, 0);
  client.dispose();
});

test("deduplicates concurrent compilation, caches SVG, and localizes diagnostics", async () => {
  const worker = new FakeWorker();
  const client = new TypstFormulaCompilerClient({ workerFactory: () => worker });

  const [first, second] = await Promise.all([
    client.compile({ source: "x^2", sourceLine: 5, sourceColumn: 7 }),
    client.compile({ source: "x^2", sourceLine: 20, sourceColumn: 3 }),
  ]);
  const third = await client.compile({ source: "x^2" });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(third.ok, true);
  assert.equal(worker.requests.length, 1);
  assert.deepEqual(first.diagnostics[0], {
    severity: "warning",
    message: "demo warning",
    line: 1,
    column: 2,
    sourceLine: 5,
    sourceColumn: 8,
  });
  assert.equal(second.diagnostics[0]?.sourceLine, 20);
  assert.equal(second.diagnostics[0]?.sourceColumn, 4);
  client.dispose();
});

class FakeWorker implements TypstWorkerLike {
  readonly requests: TypstWorkerCompileRequest[] = [];
  private readonly messageListeners = new Set<(
    event: MessageEvent<TypstWorkerCompileResponse>,
  ) => void>();
  private readonly errorListeners = new Set<(event: ErrorEvent) => void>();

  postMessage(message: TypstWorkerCompileRequest): void {
    this.requests.push(message);
    queueMicrotask(() => {
      const result: TypstCompileResult = {
        ok: true,
        svg: '<svg width="10pt" height="5pt"></svg>',
        width: 10,
        height: 5,
        baselineEm: 0.16,
        diagnostics: [{
          severity: "warning",
          message: "demo warning",
          line: 1,
          column: 2,
        }],
      };
      const event = { data: { id: message.id, type: "result", result } } as
        MessageEvent<TypstWorkerCompileResponse>;
      for (const listener of this.messageListeners) listener(event);
    });
  }

  terminate(): void {}

  addEventListener(
    type: "message" | "error",
    listener: ((event: MessageEvent<TypstWorkerCompileResponse>) => void) |
      ((event: ErrorEvent) => void),
  ): void {
    if (type === "message") {
      this.messageListeners.add(listener as (event: MessageEvent<TypstWorkerCompileResponse>) => void);
    } else {
      this.errorListeners.add(listener as (event: ErrorEvent) => void);
    }
  }

  removeEventListener(
    type: "message" | "error",
    listener: ((event: MessageEvent<TypstWorkerCompileResponse>) => void) |
      ((event: ErrorEvent) => void),
  ): void {
    if (type === "message") {
      this.messageListeners.delete(listener as (event: MessageEvent<TypstWorkerCompileResponse>) => void);
    } else {
      this.errorListeners.delete(listener as (event: ErrorEvent) => void);
    }
  }
}
