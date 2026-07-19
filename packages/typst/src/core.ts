export const TYPST_TS_VERSION = "0.7.0";
/** Typst language engine embedded by typst.ts 0.7.0. */
export const TYPST_LANGUAGE_VERSION = "0.14.2";
export const TYPST_FONT_ASSET_VERSION = "0.13.1";

export type TypstFormulaDisplay = "inline" | "block";
export type TypstDiagnosticSeverity = "error" | "warning" | "info";

export interface TypstSourceLocation {
  line: number;
  column: number;
}

export interface TypstDiagnostic {
  severity: TypstDiagnosticSeverity;
  message: string;
  path?: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  sourceLine?: number;
  sourceColumn?: number;
}

export interface TypstCompileRequest {
  source: string;
  display?: TypstFormulaDisplay;
  color?: string;
  sourceLine?: number;
  sourceColumn?: number;
}

export interface TypstCompileSuccess {
  ok: true;
  svg: string;
  width?: number;
  height?: number;
  /** A conservative CSS-em offset for aligning the SVG with surrounding text. */
  baselineEm: number;
  diagnostics: readonly TypstDiagnostic[];
}

export interface TypstCompileFailure {
  ok: false;
  diagnostics: readonly TypstDiagnostic[];
}

export type TypstCompileResult = TypstCompileSuccess | TypstCompileFailure;

export interface TypstRuntimeConfig {
  compilerWasmUrl: string;
  rendererWasmUrl: string;
  fontUrls: readonly string[];
  timeoutMs: number;
  maxSourceLength: number;
  maxSvgLength: number;
  maxCacheEntries: number;
  maxCacheBytes: number;
}

export const defaultTypstRuntimeConfig: Readonly<TypstRuntimeConfig> = Object.freeze({
  compilerWasmUrl: "/_typst/typst_ts_web_compiler_bg.wasm",
  rendererWasmUrl: "/_typst/typst_ts_renderer_bg.wasm",
  fontUrls: Object.freeze([
    "/_typst/fonts/NewCM10-Regular.otf",
    "/_typst/fonts/NewCM10-Italic.otf",
    "/_typst/fonts/NewCM10-Bold.otf",
    "/_typst/fonts/NewCM10-BoldItalic.otf",
    "/_typst/fonts/NewCMMath-Regular.otf",
    "/_typst/fonts/NewCMMath-Book.otf",
    "/_typst/fonts/NewCMMath-Bold.otf",
  ]),
  timeoutMs: 12_000,
  maxSourceLength: 16_384,
  maxSvgLength: 1_500_000,
  maxCacheEntries: 192,
  maxCacheBytes: 8_000_000,
});

export interface TypstFormulaDocument {
  document: string;
  sourceStart: TypstSourceLocation;
}

export function buildTypstFormulaDocument(
  source: string,
  display: TypstFormulaDisplay = "inline",
  color = "#111827",
): TypstFormulaDocument {
  const normalizedColor = normalizeColor(color);
  const fontSize = display === "block" ? "14pt" : "12pt";
  const beforeSource = display === "block" ? "#box($ " : "#box($";
  const afterSource = display === "block" ? " $)" : "$)";
  const lines = [
    "#set page(width: auto, height: auto, margin: 1pt, fill: none)",
    `#set text(size: ${fontSize}, fill: rgb(\"${normalizedColor}\"))`,
    `${beforeSource}${source}${afterSource}`,
  ];
  return {
    document: lines.join("\n"),
    sourceStart: { line: 3, column: beforeSource.length + 1 },
  };
}

export function sanitizeTypstSvg(svg: string, maxLength = defaultTypstRuntimeConfig.maxSvgLength): string {
  const trimmed = svg.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) {
    throw new Error(trimmed.length === 0 ? "Typst returned an empty SVG." : "Typst SVG exceeds the output limit.");
  }
  const document = trimmed
    .replace(/<\?xml[^>]*\?>/giu, "")
    .replace(/<!doctype[^>]*>/giu, "")
    .trim();
  if (!/^<svg(?:\s|>)/iu.test(document)) {
    throw new Error("Typst returned an invalid SVG document.");
  }
  if (/<\/?(?:script|foreignObject|iframe|object|embed|audio|video|link|meta)(?:\s|>)/iu.test(document)) {
    throw new Error("Typst SVG contains a forbidden element.");
  }
  if (/\son[a-z][\w:-]*\s*=/iu.test(document)) {
    throw new Error("Typst SVG contains an event handler.");
  }
  if (hasExternalSvgReference(document)) {
    throw new Error("Typst SVG contains an external or executable link.");
  }
  if (hasExternalSvgUrl(document) || /@import\b/iu.test(document)) {
    throw new Error("Typst SVG contains an external or executable resource.");
  }
  return document;
}

/** Removes Typst.ts selection/interaction layers that are not needed by `<img>`. */
export function stripTypstInteractiveSvgLayers(svg: string): string {
  return svg
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/giu, "")
    .replace(/<foreignObject\b[^>]*>[\s\S]*?<\/foreignObject\s*>/giu, "");
}

function hasExternalSvgReference(svg: string): boolean {
  const assignment = /\b(?:href|xlink:href)\s*=\s*/giu;
  for (const match of svg.matchAll(assignment)) {
    const start = (match.index ?? 0) + match[0].length;
    const quote = svg[start];
    if (quote !== "\"" && quote !== "'") return true;
    const end = svg.indexOf(quote, start + 1);
    if (end === -1) return true;
    const value = svg.slice(start + 1, end).trim();
    if (!/^#[\w:.-]+$/u.test(value)) return true;
  }
  return false;
}

function hasExternalSvgUrl(svg: string): boolean {
  for (const match of svg.matchAll(/\burl\(\s*([^)]*?)\s*\)/giu)) {
    const value = match[1].replace(/^["']|["']$/gu, "").trim();
    if (!/^#[\w:.-]+$/u.test(value)) return true;
  }
  return false;
}

export function parseSvgDimensions(svg: string): { width?: number; height?: number } {
  const opening = /^<svg\b[^>]*>/iu.exec(svg)?.[0] ?? "";
  return {
    width: positiveNumberAttribute(opening, "width"),
    height: positiveNumberAttribute(opening, "height"),
  };
}

export interface TypstWorkerCompileRequest {
  id: number;
  type: "compile";
  source: string;
  display: TypstFormulaDisplay;
  color: string;
  runtime: Pick<
    TypstRuntimeConfig,
    "compilerWasmUrl" | "rendererWasmUrl" | "fontUrls" | "maxSvgLength"
  >;
}

export interface TypstWorkerCompileResponse {
  id: number;
  type: "result";
  result: TypstCompileResult;
}

export interface TypstWorkerLike {
  postMessage(message: TypstWorkerCompileRequest): void;
  terminate(): void;
  addEventListener(type: "message", listener: (event: MessageEvent<TypstWorkerCompileResponse>) => void): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<TypstWorkerCompileResponse>) => void): void;
  removeEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
}

export type TypstWorkerFactory = () => TypstWorkerLike;

interface PendingCompile {
  resolve: (result: TypstCompileResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface CacheEntry {
  result: TypstCompileSuccess;
  bytes: number;
}

export interface TypstFormulaCompilerClientOptions {
  config?: Partial<TypstRuntimeConfig>;
  workerFactory?: TypstWorkerFactory;
}

export class TypstFormulaCompilerClient {
  readonly config: TypstRuntimeConfig;
  readonly workerFactory: TypstWorkerFactory;
  private worker: TypstWorkerLike | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingCompile>();
  private readonly inFlight = new Map<string, Promise<TypstCompileResult>>();
  private readonly cache = new Map<string, CacheEntry>();
  private cacheBytes = 0;

  constructor(options: TypstFormulaCompilerClientOptions = {}) {
    this.config = mergeRuntimeConfig(options.config);
    this.workerFactory = options.workerFactory ?? defaultWorkerFactory;
  }

  async compile(request: TypstCompileRequest): Promise<TypstCompileResult> {
    const source = request.source.trim();
    if (source.length === 0) {
      return failure("Typst formula source is empty.", request);
    }
    if (source.length > this.config.maxSourceLength) {
      return failure(`Typst formula exceeds ${this.config.maxSourceLength} characters.`, request);
    }
    const forbiddenCapability = findForbiddenTypstCapability(source);
    if (forbiddenCapability !== undefined) {
      return failure(
        `Typst formula cannot use external I/O capability \`${forbiddenCapability}\`.`,
        request,
      );
    }

    const display = request.display ?? "inline";
    const color = normalizeColor(request.color ?? "#111827");
    const key = JSON.stringify([TYPST_TS_VERSION, display, color, source]);
    const cached = this.takeCached(key);
    if (cached !== undefined) return localizeResult(cached, request);

    let task = this.inFlight.get(key);
    if (task === undefined) {
      task = this.dispatch({ source, display, color });
      this.inFlight.set(key, task);
      void task.finally(() => this.inFlight.delete(key));
    }

    const result = await task;
    if (result.ok) this.storeCached(key, result);
    return localizeResult(result, request);
  }

  dispose(reason = "Typst compiler was disposed."): void {
    const worker = this.worker;
    this.worker = null;
    if (worker !== null) {
      worker.removeEventListener("message", this.onMessage);
      worker.removeEventListener("error", this.onError);
      worker.terminate();
    }
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.resolve(failure(reason));
    }
    this.pending.clear();
    this.inFlight.clear();
  }

  clearCache(): void {
    this.cache.clear();
    this.cacheBytes = 0;
  }

  private dispatch(request: Pick<TypstWorkerCompileRequest, "source" | "display" | "color">): Promise<TypstCompileResult> {
    let worker: TypstWorkerLike;
    try {
      worker = this.ensureWorker();
    } catch (error) {
      return Promise.resolve(failure(errorMessage(error)));
    }

    const id = this.nextId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.dispose(`Typst compilation exceeded ${this.config.timeoutMs}ms.`);
      }, this.config.timeoutMs);
      this.pending.set(id, { resolve, timer });
      worker.postMessage({
        id,
        type: "compile",
        ...request,
        runtime: {
          compilerWasmUrl: this.config.compilerWasmUrl,
          rendererWasmUrl: this.config.rendererWasmUrl,
          fontUrls: this.config.fontUrls,
          maxSvgLength: this.config.maxSvgLength,
        },
      });
    });
  }

  private ensureWorker(): TypstWorkerLike {
    if (this.worker !== null) return this.worker;
    const worker = this.workerFactory();
    worker.addEventListener("message", this.onMessage);
    worker.addEventListener("error", this.onError);
    this.worker = worker;
    return worker;
  }

  private readonly onMessage = (event: MessageEvent<TypstWorkerCompileResponse>) => {
    const message = event.data;
    if (message?.type !== "result") return;
    const pending = this.pending.get(message.id);
    if (pending === undefined) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    pending.resolve(message.result);
  };

  private readonly onError = (event: ErrorEvent) => {
    this.dispose(event.message || "The Typst compiler worker failed.");
  };

  private takeCached(key: string): TypstCompileSuccess | undefined {
    const entry = this.cache.get(key);
    if (entry === undefined) return undefined;
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.result;
  }

  private storeCached(key: string, result: TypstCompileSuccess): void {
    if (result.svg.length > this.config.maxCacheBytes) return;
    const previous = this.cache.get(key);
    if (previous !== undefined) {
      this.cacheBytes -= previous.bytes;
      this.cache.delete(key);
    }
    const entry = { result, bytes: result.svg.length };
    this.cache.set(key, entry);
    this.cacheBytes += entry.bytes;
    while (
      this.cache.size > this.config.maxCacheEntries ||
      this.cacheBytes > this.config.maxCacheBytes
    ) {
      const oldestKey = this.cache.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      const oldest = this.cache.get(oldestKey);
      this.cache.delete(oldestKey);
      this.cacheBytes -= oldest?.bytes ?? 0;
    }
  }
}

let singletonOptions: TypstFormulaCompilerClientOptions = {};
let singleton: TypstFormulaCompilerClient | null = null;

export function configureTypstFormulaCompiler(options: TypstFormulaCompilerClientOptions): void {
  singleton?.dispose("Typst compiler configuration changed.");
  singleton = null;
  singletonOptions = options;
}

export function compileTypstFormula(request: TypstCompileRequest): Promise<TypstCompileResult> {
  singleton ??= new TypstFormulaCompilerClient(singletonOptions);
  return singleton.compile(request);
}

export function resetTypstFormulaCompiler(): void {
  singleton?.dispose();
  singleton = null;
}

export function normalizeWorkerDiagnostics(
  diagnostics: readonly TypstDiagnostic[],
  sourceStart: TypstSourceLocation,
): readonly TypstDiagnostic[] {
  return diagnostics.map((diagnostic) => {
    if (diagnostic.line === undefined) return diagnostic;
    const relativeLine = diagnostic.line - sourceStart.line + 1;
    if (relativeLine < 1) return diagnostic;
    const relativeColumn = relativeLine === 1 && diagnostic.column !== undefined
      ? Math.max(1, diagnostic.column - sourceStart.column + 1)
      : diagnostic.column;
    return {
      ...diagnostic,
      line: relativeLine,
      column: relativeColumn,
      endLine: diagnostic.endLine === undefined
        ? undefined
        : Math.max(1, diagnostic.endLine - sourceStart.line + 1),
      endColumn: diagnostic.endColumn,
    };
  });
}

function defaultWorkerFactory(): TypstWorkerLike {
  if (typeof Worker === "undefined") {
    throw new Error("Typst formula compilation requires a browser Web Worker.");
  }
  return new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "babel-typst" });
}

function mergeRuntimeConfig(config: Partial<TypstRuntimeConfig> | undefined): TypstRuntimeConfig {
  const merged = {
    ...defaultTypstRuntimeConfig,
    ...config,
    fontUrls: [...(config?.fontUrls ?? defaultTypstRuntimeConfig.fontUrls)],
  };
  for (const url of [merged.compilerWasmUrl, merged.rendererWasmUrl, ...merged.fontUrls]) {
    if (!isLocalAssetUrl(url)) {
      throw new Error(`Typst runtime assets must use a same-origin path: ${url}`);
    }
  }
  return merged;
}

const FORBIDDEN_TYPST_CAPABILITIES = [
  "bibliography",
  "cbor",
  "csv",
  "image",
  "import",
  "include",
  "json",
  "plugin",
  "read",
  "xml",
  "yaml",
] as const;

/**
 * Formula compilation intentionally has no file, package, network, or plugin
 * surface. Reject the corresponding Typst identifiers before the worker sees
 * the source; the worker's memory-only access model is the second boundary.
 */
export function findForbiddenTypstCapability(source: string): string | undefined {
  for (const capability of FORBIDDEN_TYPST_CAPABILITIES) {
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_-])${capability}(?=$|[^\\p{L}\\p{N}_-])`, "iu");
    if (pattern.test(source)) return capability;
  }
  return undefined;
}

function isLocalAssetUrl(url: string): boolean {
  const trimmed = url.trim();
  return trimmed.length > 0 &&
    trimmed === url &&
    !/[\\\u0000-\u001f\u007f]/u.test(trimmed) &&
    !/^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(trimmed);
}

function normalizeColor(color: string): string {
  const trimmed = color.trim();
  if (/^#[0-9a-f]{6}$/iu.test(trimmed)) return trimmed.toLowerCase();
  if (/^#[0-9a-f]{3}$/iu.test(trimmed)) {
    return `#${trimmed.slice(1).split("").map((part) => `${part}${part}`).join("")}`.toLowerCase();
  }
  return "#111827";
}

function positiveNumberAttribute(svg: string, name: string): number | undefined {
  const match = new RegExp(`\\b${name}=[\"']([0-9]+(?:\\.[0-9]+)?)(pt|px)?[\"']`, "iu").exec(svg);
  if (match === null) return undefined;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return match[2]?.toLowerCase() === "pt" ? value * 4 / 3 : value;
}

function failure(message: string, request?: TypstCompileRequest): TypstCompileFailure {
  return {
    ok: false,
    diagnostics: [{
      severity: "error",
      message,
      sourceLine: request?.sourceLine,
      sourceColumn: request?.sourceColumn,
    }],
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "Typst formula compilation failed.";
}

function localizeResult(result: TypstCompileResult, request: TypstCompileRequest): TypstCompileResult {
  if (request.sourceLine === undefined && request.sourceColumn === undefined) return result;
  const diagnostics = result.diagnostics.map((diagnostic) => {
    const formulaLine = diagnostic.line ?? 1;
    const formulaColumn = diagnostic.column ?? 1;
    return {
      ...diagnostic,
      sourceLine: request.sourceLine === undefined
        ? undefined
        : request.sourceLine + formulaLine - 1,
      sourceColumn: request.sourceColumn === undefined
        ? undefined
        : formulaLine === 1
          ? request.sourceColumn + formulaColumn - 1
          : formulaColumn,
    };
  });
  return result.ok ? { ...result, diagnostics } : { ...result, diagnostics };
}
