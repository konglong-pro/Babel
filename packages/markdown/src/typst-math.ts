import {
  createRemarkFormulaMath,
  prepareFormulaMath,
  type FormulaOccurrence,
  type PreparedFormulaMath,
} from "./formula-math";

export type TypstMathOccurrence = Omit<FormulaOccurrence, "engine">;
export type PreparedTypstMath = PreparedFormulaMath;

/** @deprecated Use `prepareFormulaMath` for dual Typst and LaTeX support. */
export function prepareTypstMath(markdown: string): PreparedTypstMath {
  return prepareFormulaMath(markdown, { typst: true, latex: false });
}

/** @deprecated Use `createRemarkFormulaMath` for dual-engine formula nodes. */
export const createRemarkTypstMath = createRemarkFormulaMath;
