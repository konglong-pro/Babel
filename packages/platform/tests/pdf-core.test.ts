import assert from "node:assert/strict";
import test from "node:test";

import {
  isPdfAnnotation,
  isPdfAnnotations,
  isPdfProgress,
  isPdfRect,
  PDF_DEFAULT_PROGRESS,
  PDF_MAX_ANNOTATIONS,
  type PdfAnnotation,
} from "../src/pdf/core";

const annotation: PdfAnnotation = {
  id: "selection-1", type: "highlight", page: 2,
  rects: [{ x: 0.1, y: 0.2, width: 0.4, height: 0.03 }],
  text: "苯的结构", comment: "复习芳香性", color: "#fff176", createdAt: "2026-10-19T01:00:00.000Z",
};

test("PDF progress accepts supported viewing states and rejects invalid or unknown fields", () => {
  assert.equal(isPdfProgress(PDF_DEFAULT_PROGRESS), true);
  for (const rotation of [0, 90, 180, 270]) assert.equal(isPdfProgress({ page: 1000, scale: 0.5, rotation }), true);
  for (const progress of [null, [], {}, { ...PDF_DEFAULT_PROGRESS, page: 0 }, { ...PDF_DEFAULT_PROGRESS, page: 1.5 },
    { ...PDF_DEFAULT_PROGRESS, scale: Number.NaN }, { ...PDF_DEFAULT_PROGRESS, scale: Infinity },
    { ...PDF_DEFAULT_PROGRESS, scale: 0.09 }, { ...PDF_DEFAULT_PROGRESS, scale: 8.1 },
    { ...PDF_DEFAULT_PROGRESS, rotation: 45 }, { ...PDF_DEFAULT_PROGRESS, extra: "field" }]) {
    assert.equal(isPdfProgress(progress), false);
  }
});

test("PDF rectangle geometry remains within an unrotated normalized page", () => {
  assert.equal(isPdfRect({ x: 0, y: 0, width: 1, height: 1 }), true);
  assert.equal(isPdfRect(annotation.rects[0]), true);
  for (const rect of [null, {}, { x: -1, y: 0, width: 1, height: 1 }, { x: 0, y: 0, width: 0, height: 1 },
    { x: 0.9, y: 0.1, width: 0.2, height: 0.1 }, { x: 0, y: 0, width: 1, height: Infinity }]) assert.equal(isPdfRect(rect), false);
});

test("PDF annotations validate identifiers, geometry, colors and bounded text; duplicates cannot overwrite", () => {
  assert.equal(isPdfAnnotation(annotation), true);
  assert.equal(isPdfAnnotations([annotation]), true);
  assert.equal(isPdfAnnotations([]), true);
  for (const value of [{ ...annotation, id: "../escape" }, { ...annotation, type: "script" },
    { ...annotation, page: 0 }, { ...annotation, rects: [] }, { ...annotation, rects: [{ x: 2, y: 0, width: 1, height: 1 }] },
    { ...annotation, color: "url(https://example.test)" }, { ...annotation, text: "x".repeat(20_001) },
    { ...annotation, comment: "x".repeat(4_001) }, { ...annotation, createdAt: "invalid" }, { ...annotation, other: true }]) {
    assert.equal(isPdfAnnotation(value), false);
  }
  assert.equal(isPdfAnnotations([annotation, annotation]), false);
  assert.equal(isPdfAnnotations(Array.from({ length: PDF_MAX_ANNOTATIONS + 1 }, (_, i) => ({ ...annotation, id: String(i) }))), false);
});
