import {
  KATEX_VERSION,
  type KatexFormulaDisplay,
} from "./core";

export { KATEX_VERSION };
export const KATEX_REFERENCE_VERSION = `katex-${KATEX_VERSION}`;

export interface KatexMathReferenceRow {
  id: string;
  category: string;
  syntax: string;
  description: string;
  /** Raw LaTeX math content without surrounding delimiters. */
  example: string;
  display?: KatexFormulaDisplay;
  notes?: string;
}

export interface KatexMathReferenceGroup {
  id: string;
  title: string;
  description: string;
  rows: readonly KatexMathReferenceRow[];
}

export const katexMathReferenceGroups = [
  {
    id: "latex-delimiters",
    title: "Delimiters and grouping",
    description: "Traditional single-dollar LaTeX is recognized for compatibility; prefer explicit LaTeX delimiters for unambiguous new content.",
    rows: [
      row("latex-inline", "Delimiters", "\\(x + y\\)", "Inline LaTeX formula", "x + y"),
      row("latex-block-brackets", "Delimiters", "\\[x + y\\]", "Block LaTeX formula", "x + y", { display: "block" }),
      row("latex-block-dollars", "Delimiters", "$$x + y$$", "Block LaTeX formula", "x + y", { display: "block" }),
      row("latex-group", "Grouping", "{a + b}", "Group a subexpression", "{(a + b)}^2"),
    ],
  },
  {
    id: "latex-structure",
    title: "Powers, fractions, and roots",
    description: "Use braces for multi-character attachments and arguments.",
    rows: [
      row("latex-subscript", "Attachments", "x_i", "Subscript", "x_i"),
      row("latex-superscript", "Attachments", "x^2", "Superscript", "x^2"),
      row("latex-both", "Attachments", "x_i^2", "Subscript and superscript", "x_i^2"),
      row("latex-fraction", "Fractions", "\\frac{a}{b}", "Built-up fraction", "\\frac{a+b}{c+d}"),
      row("latex-root", "Roots", "\\sqrt{x}", "Square root", "\\sqrt{x^2+y^2}"),
      row("latex-nth-root", "Roots", "\\sqrt[n]{x}", "Nth root", "\\sqrt[3]{x}"),
    ],
  },
  {
    id: "latex-calculus",
    title: "Operators and calculus",
    description: "Large operators place limits according to inline or block math style.",
    rows: [
      row("latex-sum", "Operators", "\\sum_{i=1}^{n}", "Summation with limits", "\\sum_{i=1}^{n} i^2", { display: "block" }),
      row("latex-product", "Operators", "\\prod_{i=1}^{n}", "Product with limits", "\\prod_{i=1}^{n} i"),
      row("latex-integral", "Calculus", "\\int_0^1", "Definite integral", "\\int_0^1 x^2\\,dx", { display: "block" }),
      row("latex-limit", "Calculus", "\\lim_{x\\to\\infty}", "Limit", "\\lim_{x\\to\\infty} \\frac{1}{x}"),
      row("latex-partial", "Calculus", "\\partial", "Partial derivative", "\\frac{\\partial f}{\\partial x}"),
    ],
  },
  {
    id: "latex-symbols",
    title: "Symbols and relations",
    description: "KaTeX supports common Greek letters, sets, arrows, and relation symbols.",
    rows: [
      row("latex-greek", "Greek", "\\alpha, \\beta, \\Gamma", "Greek letters", "\\alpha + \\beta = \\Gamma"),
      row("latex-sets", "Sets", "\\mathbb{R}", "Blackboard-bold sets", "x \\in \\mathbb{R}"),
      row("latex-relations", "Relations", "\\leq, \\neq, \\approx", "Relation symbols", "a \\leq b \\neq c"),
      row("latex-arrows", "Arrows", "\\to, \\Rightarrow", "Arrows", "A \\Rightarrow B \\to C"),
    ],
  },
  {
    id: "latex-layout",
    title: "Brackets and layouts",
    description: "Scale delimiters and arrange multi-line structures with supported environments.",
    rows: [
      row("latex-scaled-brackets", "Brackets", "\\left(\\frac{a}{b}\\right)", "Automatically scaled brackets", "\\left(\\frac{a}{b}\\right)"),
      row("latex-matrix", "Matrices", "\\begin{bmatrix}…\\end{bmatrix}", "Bracketed matrix", "\\begin{bmatrix}a&b\\\\c&d\\end{bmatrix}", { display: "block" }),
      row("latex-cases", "Layouts", "\\begin{cases}…\\end{cases}", "Piecewise expression", "f(x)=\\begin{cases}x^2&x\\ge0\\\\-x&x<0\\end{cases}", { display: "block" }),
      row("latex-aligned", "Layouts", "\\begin{aligned}…\\end{aligned}", "Aligned equations", "\\begin{aligned}a&=b+c\\\\d&=e+f\\end{aligned}", { display: "block" }),
    ],
  },
  {
    id: "latex-text-style",
    title: "Text, accents, and spacing",
    description: "Mix short text labels with notation and control accents or spacing explicitly.",
    rows: [
      row("latex-text", "Text", "\\text{for all }x", "Text inside math", "x^2 \\ge 0 \\text{ for all } x"),
      row("latex-accents", "Accents", "\\hat{x}, \\vec{v}", "Accented symbols", "\\hat{x}+\\vec{v}+\\overline{AB}"),
      row("latex-spacing", "Spacing", "\\, \\; \\quad", "Math spacing", "a\\,b\\;c\\quad d"),
      row("latex-operator", "Operators", "\\operatorname{rank}", "Named operator", "\\operatorname{rank}(A)"),
    ],
  },
] as const satisfies readonly KatexMathReferenceGroup[];

export const katexMathReferenceRows: readonly KatexMathReferenceRow[] =
  katexMathReferenceGroups.flatMap((group) => group.rows);

function row(
  id: string,
  category: string,
  syntax: string,
  description: string,
  example: string,
  options: Pick<KatexMathReferenceRow, "display" | "notes"> = {},
): KatexMathReferenceRow {
  return { id, category, syntax, description, example, ...options };
}
