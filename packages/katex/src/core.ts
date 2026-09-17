import katex, { type KatexOptions } from "katex";

export const KATEX_VERSION = "0.16.22";

export type KatexFormulaDisplay = "inline" | "block";
export type KatexDiagnosticSeverity = "error" | "warning";

export interface KatexDiagnostic {
  severity: KatexDiagnosticSeverity;
  message: string;
  sourceLine?: number;
  sourceColumn?: number;
}

export interface KatexRenderRequest {
  source: string;
  display?: KatexFormulaDisplay;
  sourceLine?: number;
  sourceColumn?: number;
}

export interface KatexRenderSuccess {
  ok: true;
  html: string;
  diagnostics: readonly KatexDiagnostic[];
}

export interface KatexRenderFailure {
  ok: false;
  diagnostics: readonly KatexDiagnostic[];
}

export type KatexRenderResult = KatexRenderSuccess | KatexRenderFailure;

export interface KatexRuntimeConfig {
  maxSourceLength: number;
  maxOutputLength: number;
  maxExpand: number;
  maxSize: number;
}

export const defaultKatexRuntimeConfig: Readonly<KatexRuntimeConfig> = Object.freeze({
  maxSourceLength: 16_384,
  maxOutputLength: 1_500_000,
  maxExpand: 1_000,
  maxSize: 20,
});

const MAX_SINGLE_LETTER_RECOVERIES = 8;
const UNDEFINED_SINGLE_LETTER_CONTROL =
  /Undefined control sequence:\s*(\\([A-Za-z]))(?:\s|$)/u;

export function renderKatexFormula(
  request: KatexRenderRequest,
  config: Readonly<KatexRuntimeConfig> = defaultKatexRuntimeConfig,
): KatexRenderResult {
  const source = request.source.trim();
  if (source.length === 0) {
    return failure("LaTeX formula source is empty.", request);
  }
  if (source.length > config.maxSourceLength) {
    return failure(
      `LaTeX formula exceeds ${config.maxSourceLength} characters.`,
      request,
    );
  }

  const diagnostics: KatexDiagnostic[] = [];
  let renderSource = source;
  for (let attempt = 0; attempt <= MAX_SINGLE_LETTER_RECOVERIES; attempt += 1) {
    try {
      const html = katex.renderToString(
        renderSource,
        createKatexOptions(request, config, diagnostics),
      );
      if (html.length === 0 || html.length > config.maxOutputLength) {
        return failure(
          html.length === 0
            ? "KaTeX returned empty output."
            : "KaTeX output exceeds the configured limit.",
          request,
        );
      }
      return { ok: true, html, diagnostics };
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "KaTeX could not render this formula.";
      const recovery = attempt < MAX_SINGLE_LETTER_RECOVERIES
        ? recoverUndefinedSingleLetterVariable(renderSource, message)
        : null;
      if (recovery === null) return failure(message, request);
      renderSource = recovery.source;
      diagnostics.push(localizeDiagnostic(
        "warning",
        `Treated undefined ${recovery.command} as the variable ${recovery.variable}.`,
        request,
      ));
    }
  }

  return failure("KaTeX could not render this formula.", request);
}

function createKatexOptions(
  request: KatexRenderRequest,
  config: Readonly<KatexRuntimeConfig>,
  diagnostics: KatexDiagnostic[],
): KatexOptions {
  return {
    displayMode: (request.display ?? "inline") === "block",
    output: "htmlAndMathml",
    throwOnError: true,
    trust: false,
    strict: (_errorCode, errorMessage) => {
      diagnostics.push(localizeDiagnostic("warning", errorMessage, request));
      return "ignore";
    },
    maxExpand: config.maxExpand,
    maxSize: config.maxSize,
    globalGroup: false,
    // KaTeX mutates this map for local definitions, so isolate every attempt.
    macros: {},
  };
}

function recoverUndefinedSingleLetterVariable(
  source: string,
  message: string,
): { source: string; command: string; variable: string } | null {
  const match = message.match(UNDEFINED_SINGLE_LETTER_CONTROL);
  const command = match?.[1];
  const variable = match?.[2];
  if (command === undefined || variable === undefined) return null;

  const commandPattern = new RegExp(
    `${escapeRegExp(command)}(?![A-Za-z])`,
    "u",
  );
  const commandIndex = source.search(commandPattern);
  if (commandIndex === -1) return null;
  const following = source[commandIndex + command.length];
  if (
    following !== undefined &&
    !/[\\\s_^+\-*/=<>),}\].;:]/u.test(following)
  ) {
    return null;
  }

  return {
    source: source.slice(0, commandIndex) +
      variable +
      source.slice(commandIndex + command.length),
    command,
    variable,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function failure(
  message: string,
  request: Pick<KatexRenderRequest, "sourceLine" | "sourceColumn">,
): KatexRenderFailure {
  return {
    ok: false,
    diagnostics: [localizeDiagnostic("error", message, request)],
  };
}

function localizeDiagnostic(
  severity: KatexDiagnosticSeverity,
  message: string,
  request: Pick<KatexRenderRequest, "sourceLine" | "sourceColumn">,
): KatexDiagnostic {
  return {
    severity,
    message,
    sourceLine: request.sourceLine,
    sourceColumn: request.sourceColumn,
  };
}
