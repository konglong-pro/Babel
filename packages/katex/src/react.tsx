"use client";

import React, {
  useEffect,
  useMemo,
  type CSSProperties,
  type ReactNode,
} from "react";

import {
  renderKatexFormula,
  type KatexDiagnostic,
  type KatexFormulaDisplay,
} from "./core";

export interface KatexFormulaProps {
  source: string;
  display?: KatexFormulaDisplay;
  className?: string;
  sourceLine?: number;
  sourceColumn?: number;
  ariaLabel?: string;
  errorFallback?: (diagnostics: readonly KatexDiagnostic[]) => ReactNode;
  onDiagnostics?: (diagnostics: readonly KatexDiagnostic[]) => void;
}

export function KatexFormula({
  source,
  display = "inline",
  className,
  sourceLine,
  sourceColumn,
  ariaLabel,
  errorFallback,
  onDiagnostics,
}: KatexFormulaProps) {
  const result = useMemo(() => {
    return renderKatexFormula({ source, display, sourceLine, sourceColumn });
  }, [display, source, sourceColumn, sourceLine]);

  useEffect(() => {
    onDiagnostics?.(result.diagnostics);
  }, [onDiagnostics, result]);

  const classes = [
    className,
    "babel-formula",
    display === "block" ? "babel-formula-block" : "babel-formula-inline",
    "katex-formula",
    display === "block" ? "katex-formula-block" : "katex-formula-inline",
    result.ok ? null : "katex-formula-error",
  ].filter(Boolean).join(" ");
  const wrapperStyle: CSSProperties = display === "block"
    ? { display: "block", maxWidth: "100%", overflowX: "auto", paddingBlock: "0.25em" }
    : { display: "inline-flex", maxWidth: "100%", verticalAlign: "baseline" };

  if (result.ok) {
    return (
      <span
        className={classes}
        style={wrapperStyle}
        data-formula-engine="latex"
        data-katex-display={display}
        aria-label={ariaLabel}
        dangerouslySetInnerHTML={{ __html: result.html }}
      />
    );
  }

  const diagnosticText = result.diagnostics.map(formatDiagnostic).join("\n");
  return (
    <span
      className={classes}
      style={wrapperStyle}
      data-formula-engine="latex"
      data-katex-display={display}
      data-katex-error="true"
      role="img"
      aria-label={ariaLabel ?? `Invalid LaTeX formula: ${source}`}
      title={diagnosticText}
    >
      {errorFallback?.(result.diagnostics) ?? <code>{source}</code>}
    </span>
  );
}

function formatDiagnostic(diagnostic: KatexDiagnostic): string {
  const location = diagnostic.sourceLine === undefined
    ? ""
    : diagnostic.sourceColumn === undefined
      ? `Line ${diagnostic.sourceLine}: `
      : `Line ${diagnostic.sourceLine}, column ${diagnostic.sourceColumn}: `;
  return `${location}${diagnostic.message}`;
}
