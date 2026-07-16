"use client";

import React, {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import {
  compileTypstFormula,
  type TypstCompileResult,
  type TypstDiagnostic,
  type TypstFormulaDisplay,
} from "./core";

export interface TypstFormulaProps {
  source: string;
  display?: TypstFormulaDisplay;
  color?: string;
  className?: string;
  sourceLine?: number;
  sourceColumn?: number;
  ariaLabel?: string;
  loadingFallback?: ReactNode;
  errorFallback?: (diagnostics: readonly TypstDiagnostic[]) => ReactNode;
  onDiagnostics?: (diagnostics: readonly TypstDiagnostic[]) => void;
}

interface ReadyImage {
  result: Extract<TypstCompileResult, { ok: true }>;
  source: string;
  display: TypstFormulaDisplay;
  classes: string;
  wrapperStyle: CSSProperties;
  ariaLabel?: string;
}

export function TypstFormula({
  source,
  display = "inline",
  color,
  className,
  sourceLine,
  sourceColumn,
  ariaLabel,
  loadingFallback,
  errorFallback,
  onDiagnostics,
}: TypstFormulaProps) {
  const requestKey = JSON.stringify([source, display, color, sourceLine, sourceColumn]);
  const [settled, setSettled] = useState<{
    key: string;
    result: TypstCompileResult;
  } | null>(null);
  const result = settled?.key === requestKey ? settled.result : null;

  useEffect(() => {
    let active = true;
    void compileTypstFormula({ source, display, color, sourceLine, sourceColumn })
      .then((nextResult) => {
        if (!active) return;
        setSettled({ key: requestKey, result: nextResult });
        onDiagnostics?.(nextResult.diagnostics);
      });
    return () => {
      active = false;
    };
  }, [color, display, onDiagnostics, requestKey, source, sourceColumn, sourceLine]);

  const classes = [
    className,
    "typst-formula",
    display === "block" ? "typst-formula-block" : "typst-formula-inline",
    result?.ok === false ? "typst-formula-error" : null,
  ].filter(Boolean).join(" ");
  const diagnosticText = useMemo(() => {
    return result?.diagnostics.map(formatDiagnostic).join("\n") ?? "";
  }, [result]);

  const wrapperStyle: CSSProperties = display === "block"
    ? { display: "block", maxWidth: "100%", overflowX: "auto", textAlign: "center" }
    : { display: "inline-flex", maxWidth: "100%", verticalAlign: "baseline" };

  if (result?.ok === true) {
    return (
      <ReadyTypstImage
        key={requestKey}
        result={result}
        source={source}
        display={display}
        classes={classes}
        wrapperStyle={wrapperStyle}
        ariaLabel={ariaLabel}
      />
    );
  }

  if (result?.ok === false) {
    return (
      <span
        className={classes}
        style={wrapperStyle}
        data-typst-display={display}
        data-typst-error="true"
        role="img"
        aria-label={ariaLabel ?? `Invalid Typst formula: ${source}`}
        title={diagnosticText}
      >
        {errorFallback?.(result.diagnostics) ?? <code>{source}</code>}
      </span>
    );
  }

  return (
    <span
      className={classes}
      style={wrapperStyle}
      data-typst-display={display}
      aria-busy="true"
      aria-label={ariaLabel ?? `Compiling Typst formula: ${source}`}
    >
      {loadingFallback ?? <code>{source}</code>}
    </span>
  );
}

function ReadyTypstImage({
  result,
  source,
  display,
  classes,
  wrapperStyle,
  ariaLabel,
}: ReadyImage) {
  const [url] = useState(() => URL.createObjectURL(
    new Blob([result.svg], { type: "image/svg+xml" }),
  ));
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const imageStyle: CSSProperties = {
    display: "inline-block",
    maxWidth: "100%",
    height: "auto",
    verticalAlign: display === "inline" ? `${-result.baselineEm}em` : undefined,
  };
  return (
    <span className={classes} style={wrapperStyle} data-typst-display={display}>
      <img
        src={url}
        alt={ariaLabel ?? `Typst formula: ${source}`}
        width={result.width}
        height={result.height}
        style={imageStyle}
      />
    </span>
  );
}

function formatDiagnostic(diagnostic: TypstDiagnostic): string {
  const location = diagnostic.sourceLine === undefined
    ? ""
    : diagnostic.sourceColumn === undefined
      ? `Line ${diagnostic.sourceLine}: `
      : `Line ${diagnostic.sourceLine}, column ${diagnostic.sourceColumn}: `;
  return `${location}${diagnostic.message}`;
}
