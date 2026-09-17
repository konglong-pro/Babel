import {
  buildTypstFormulaDocument,
  normalizeWorkerDiagnostics,
  parseSvgDimensions,
  sanitizeTypstSvg,
  stripTypstInteractiveSvgLayers,
} from "./runtime-shared";

import type {
  TypstCompileResult,
  TypstDiagnostic,
  TypstDiagnosticSeverity,
  TypstRuntimeConfig,
  TypstWorkerCompileRequest,
  TypstWorkerCompileResponse,
} from "./core";

import {
  MemoryAccessModel,
  createTypstCompiler,
  createTypstRenderer,
  initOptions,
  loadFonts,
  type TypstCompiler,
  type TypstRenderer,
} from "@myriaddreamin/typst.ts";

interface TypstDiagnosticMessage {
  path: string;
  severity: string;
  range: string;
  message: string;
}

interface WorkerScope {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<TypstWorkerCompileRequest>) => void,
  ): void;
  postMessage(message: TypstWorkerCompileResponse): void;
}

interface Runtime {
  compiler: TypstCompiler;
  renderer: TypstRenderer;
  signature: string;
}

const scope = globalThis as unknown as WorkerScope;
let runtimePromise: Promise<Runtime> | null = null;
let queue = Promise.resolve();

scope.addEventListener("message", (event) => {
  const request = event.data;
  if (request?.type !== "compile") return;
  queue = queue
    .then(async () => {
      const result = await compile(request);
      scope.postMessage({ id: request.id, type: "result", result });
    })
    .catch((error: unknown) => {
      scope.postMessage({
        id: request.id,
        type: "result",
        result: failed(errorMessage(error)),
      });
    });
});

async function compile(request: TypstWorkerCompileRequest): Promise<TypstCompileResult> {
  const runtime = await getRuntime(request.runtime);
  const wrapped = buildTypstFormulaDocument(request.source, request.display, request.color);

  await runtime.compiler.reset();
  runtime.compiler.addSource("/formula.typ", wrapped.document);
  const compiled = await runtime.compiler.compile({
    mainFilePath: "/formula.typ",
    root: "/",
    inputs: {},
    diagnostics: "full",
  });
  const diagnostics = normalizeWorkerDiagnostics(
    normalizeDiagnostics(compiled.diagnostics ?? []),
    wrapped.sourceStart,
  );
  if (compiled.result === undefined || diagnostics.some((item) => item.severity === "error")) {
    return {
      ok: false,
      diagnostics: diagnostics.length > 0
        ? diagnostics
        : [{ severity: "error", message: "Typst did not produce a formula." }],
    };
  }

  const rawSvg = await runtime.renderer.renderSvg({
    format: "vector",
    artifactContent: compiled.result,
    data_selection: { body: true, defs: true, css: true, js: false },
  });
  const svg = sanitizeTypstSvg(
    stripTypstInteractiveSvgLayers(rawSvg),
    request.runtime.maxSvgLength,
  );
  const dimensions = parseSvgDimensions(svg);
  return {
    ok: true,
    svg,
    ...dimensions,
    baselineEm: request.display === "inline" ? 0.16 : 0,
    diagnostics,
  };
}

async function getRuntime(config: TypstWorkerCompileRequest["runtime"]): Promise<Runtime> {
  const signature = JSON.stringify([
    config.compilerWasmUrl,
    config.rendererWasmUrl,
    config.fontUrls,
  ]);
  if (runtimePromise !== null) {
    const current = await runtimePromise;
    if (current.signature !== signature) {
      throw new Error("Typst runtime configuration changed without restarting its worker.");
    }
    return current;
  }

  runtimePromise = initializeRuntime(config, signature).catch((error: unknown) => {
    runtimePromise = null;
    throw error;
  });
  return runtimePromise;
}

async function initializeRuntime(
  config: Pick<
    TypstRuntimeConfig,
    "compilerWasmUrl" | "rendererWasmUrl" | "fontUrls"
  >,
  signature: string,
): Promise<Runtime> {
  const compiler = createTypstCompiler();
  const renderer = createTypstRenderer();
  await compiler.init({
    getModule: () => config.compilerWasmUrl,
    beforeBuild: [
      // This compiler world contains only the in-memory /formula.typ source.
      // No package registry or host filesystem adapter is installed.
      initOptions.withAccessModel(new MemoryAccessModel()),
      loadFonts([...config.fontUrls], { assets: false }),
    ],
  });
  await renderer.init({ getModule: () => config.rendererWasmUrl });
  return { compiler, renderer, signature };
}

function normalizeDiagnostics(
  diagnostics: readonly TypstDiagnosticMessage[],
): readonly TypstDiagnostic[] {
  return diagnostics.map((diagnostic) => {
    const range = parseRange(diagnostic.range);
    return {
      severity: severity(diagnostic.severity),
      message: diagnostic.message,
      path: diagnostic.path || undefined,
      ...range,
    };
  });
}

function parseRange(range: string): Pick<
  TypstDiagnostic,
  "line" | "column" | "endLine" | "endColumn"
> {
  const match = /^(\d+):(\d+)(?:-(\d+):(\d+))?$/u.exec(range.trim());
  if (match === null) return {};
  return {
    line: Number.parseInt(match[1], 10),
    column: Number.parseInt(match[2], 10),
    endLine: match[3] === undefined ? undefined : Number.parseInt(match[3], 10),
    endColumn: match[4] === undefined ? undefined : Number.parseInt(match[4], 10),
  };
}

function severity(value: string): TypstDiagnosticSeverity {
  if (value.toLowerCase() === "warning") return "warning";
  if (value.toLowerCase() === "info" || value.toLowerCase() === "hint") return "info";
  return "error";
}

function failed(message: string): TypstCompileResult {
  return { ok: false, diagnostics: [{ severity: "error", message }] };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "Typst formula compilation failed.";
}
