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

export interface TypstFormulaDocument {
  document: string;
  sourceStart: TypstSourceLocation;
}

export function buildTypstFormulaDocument(
  source: string,
  display: TypstFormulaDisplay = "inline",
  color = "#111827",
): TypstFormulaDocument {
  const normalizedColor = normalizeTypstColor(color);
  const fontSize = display === "block" ? "24pt" : "18pt";
  const beforeSource = display === "block" ? "#box($ " : "#box($";
  const afterSource = display === "block" ? " $)" : "$)";
  const lines = [
    "#set page(width: auto, height: auto, margin: 2pt, fill: none)",
    `#set text(size: ${fontSize}, fill: rgb("${normalizedColor}"))`,
    `${beforeSource}${source}${afterSource}`,
  ];
  return {
    document: lines.join("\n"),
    sourceStart: { line: 3, column: beforeSource.length + 1 },
  };
}

export function sanitizeTypstSvg(svg: string, maxLength: number): string {
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

export function parseSvgDimensions(svg: string): { width?: number; height?: number } {
  const opening = /^<svg\b[^>]*>/iu.exec(svg)?.[0] ?? "";
  return {
    width: positiveNumberAttribute(opening, "width"),
    height: positiveNumberAttribute(opening, "height"),
  };
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

export function normalizeTypstColor(color: string): string {
  const trimmed = color.trim();
  if (/^#[0-9a-f]{6}$/iu.test(trimmed)) return trimmed.toLowerCase();
  if (/^#[0-9a-f]{3}$/iu.test(trimmed)) {
    return `#${trimmed.slice(1).split("").map((part) => `${part}${part}`).join("")}`.toLowerCase();
  }
  return "#111827";
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

function positiveNumberAttribute(svg: string, name: string): number | undefined {
  const match = new RegExp(`\\b${name}=[\"']([0-9]+(?:\\.[0-9]+)?)(pt|px)?[\"']`, "iu").exec(svg);
  if (match === null) return undefined;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return match[2]?.toLowerCase() === "pt" ? value * 4 / 3 : value;
}
