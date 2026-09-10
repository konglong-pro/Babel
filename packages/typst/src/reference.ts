import {
  TYPST_LANGUAGE_VERSION,
  type TypstFormulaDisplay,
} from "./core";

/** Typst language engine embedded by Typst.ts 0.7.0 (npm gitHead 61cd6bdf). */
export { TYPST_LANGUAGE_VERSION };
export const TYPST_REFERENCE_VERSION = `typst-${TYPST_LANGUAGE_VERSION}`;

export interface TypstMathReferenceRow {
  id: string;
  category: string;
  syntax: string;
  description: string;
  /** Raw Typst math content without surrounding dollar delimiters. */
  example: string;
  display?: TypstFormulaDisplay;
  notes?: string;
}

export interface TypstMathReferenceGroup {
  id: string;
  title: string;
  description: string;
  rows: readonly TypstMathReferenceRow[];
}

export const typstMathReferenceGroups = [
  {
    id: "delimiters",
    title: "Delimiters and equations",
    description: "Enter math with Typst dollar delimiters. Spaces just inside a standalone pair select block layout.",
    rows: [
      row("inline-equation", "Delimiters", "$x + y$", "Inline equation", "x + y"),
      row("block-equation", "Delimiters", "$ x + y $", "Standalone block equation", "x + y", { display: "block" }),
      row("literal-dollar", "Delimiters", "\\$", "Literal dollar sign in Markdown prose", "dollar"),
      row("grouping", "Delimiters", "(a + b)", "Group a subexpression", "(a + b)^2"),
      row("code-in-math", "Delimiters", "#expr", "Evaluate a Typst expression in math", "#range(1, 4).sum()"),
    ],
  },
  {
    id: "attachments",
    title: "Attachments, powers, and limits",
    description: "Attach subscripts, superscripts, primes, and limits directly to atoms or grouped expressions.",
    rows: [
      row("subscript", "Attachments", "x_1", "Subscript", "x_1"),
      row("superscript", "Attachments", "x^2", "Superscript", "x^2"),
      row("both-attachments", "Attachments", "x_1^2", "Subscript and superscript", "x_1^2"),
      row("grouped-attachment", "Attachments", "x_(i + 1)", "Attach a grouped expression", "x_(i + 1)^n"),
      row("prime", "Attachments", "f'", "Prime mark", "f''(x)"),
      row("limits", "Attachments", "lim_(x -> oo)", "Limit with an attachment", "lim_(x -> oo) 1/x"),
      row("sum-limits", "Attachments", "sum_(i=1)^n", "Limits on a large operator", "sum_(i=1)^n i^2", { display: "block" }),
    ],
  },
  {
    id: "fractions-roots",
    title: "Fractions, roots, and binomials",
    description: "Use slash shorthand or explicit math functions for built-up expressions.",
    rows: [
      row("slash-fraction", "Fractions", "a/b", "Automatic fraction", "a/b"),
      row("fraction-function", "Fractions", "frac(a, b)", "Explicit fraction", "frac(a + b, c + d)"),
      row("square-root", "Roots", "sqrt(x)", "Square root", "sqrt(x^2 + y^2)"),
      row("nth-root", "Roots", "root(n, x)", "Nth root", "root(3, x)"),
      row("binomial", "Binomials", "binom(n, k)", "Binomial coefficient", "binom(n, k)"),
    ],
  },
  {
    id: "large-operators",
    title: "Large operators and calculus",
    description: "Built-in operator symbols grow and place attachments according to math style.",
    rows: [
      row("summation", "Operators", "sum", "Summation", "sum_(k=0)^n k"),
      row("product", "Operators", "product", "Product", "product_(k=1)^n k"),
      row("integral", "Calculus", "integral", "Integral", "integral_0^1 x^2 dif x", { display: "block" }),
      row("contour-integral", "Calculus", "integral.cont", "Contour integral", "integral.cont_C f(z) dif z"),
      row("differential", "Calculus", "dif x", "Upright differential", "dif y / dif x"),
      row("partial", "Calculus", "partial", "Partial derivative symbol", "partial f / partial x"),
      row("infinity", "Calculus", "oo", "Infinity", "x -> oo"),
      row("min-max", "Operators", "min, max", "Named operators", "max_(x in RR) f(x)"),
    ],
  },
  {
    id: "functions-operators",
    title: "Functions and custom operators",
    description: "Known function names are upright; use op for a custom textual operator.",
    rows: [
      row("trigonometry", "Functions", "sin x", "Trigonometric functions", "sin^2 x + cos^2 x = 1"),
      row("logarithm", "Functions", "log_b x", "Logarithm with base", "log_2 8 = 3"),
      row("exponential", "Functions", "exp(x)", "Exponential function", "exp(i pi) + 1 = 0"),
      row("custom-operator", "Functions", "op(\"rank\")", "Custom upright operator", "op(\"rank\")(A)"),
      row("operator-limits", "Functions", "op(\"arg max\", limits: #true)", "Custom operator with limits", "op(\"arg max\", limits: #true)_x f(x)", { display: "block" }),
    ],
  },
  {
    id: "brackets",
    title: "Brackets and scalable delimiters",
    description: "Typst scales paired delimiters automatically and offers floor, ceiling, and norm shorthands.",
    rows: [
      row("parentheses", "Brackets", "(x)", "Parentheses", "(a/b)"),
      row("square-brackets", "Brackets", "[x]", "Square brackets", "[a, b]"),
      row("braces", "Brackets", "{x}", "Braces", "{x in RR | x > 0}"),
      row("left-right", "Brackets", "lr(...)", "Force scalable paired delimiters", "lr((a + b)/c)"),
      row("floor", "Brackets", "floor(x)", "Floor", "floor(x/2)"),
      row("ceiling", "Brackets", "ceil(x)", "Ceiling", "ceil(x/2)"),
      row("absolute", "Brackets", "abs(x)", "Absolute value", "abs(x - 1)"),
      row("norm", "Brackets", "norm(x)", "Norm", "norm(bold(x))_2"),
    ],
  },
  {
    id: "vectors-matrices",
    title: "Vectors, matrices, and cases",
    description: "Separate vector entries with commas and matrix rows with semicolons.",
    rows: [
      row("vector", "Structures", "vec(a, b, c)", "Column vector", "vec(x, y, z)", { display: "block" }),
      row("matrix", "Structures", "mat(a, b; c, d)", "Matrix", "mat(1, 2; 3, 4)", { display: "block" }),
      row("augmented-matrix", "Structures", "mat(delim: \"[\", ...)", "Matrix with chosen delimiters", "mat(delim: \"[\", 1, 0; 0, 1)", { display: "block" }),
      row("cases", "Structures", "cases(...)", "Piecewise expression", "f(x) := cases(x & \"if\" x >= 0, -x & \"otherwise\")", { display: "block" }),
      row("nested-structure", "Structures", "mat(vec(...), ...)", "Nested mathematical structure", "mat(vec(1, 0), vec(0, 1))", { display: "block" }),
    ],
  },
  {
    id: "alignment-spacing",
    title: "Alignment and spacing",
    description: "Alignment points use ampersands. Named spacing symbols give explicit mathematical spacing.",
    rows: [
      row("alignment-point", "Alignment", "&=", "Align at an operator in block math", "a + b & = c", { display: "block" }),
      row("thin-space", "Spacing", "thin", "Thin mathematical space", "a thin b"),
      row("medium-space", "Spacing", "med", "Medium mathematical space", "a med b"),
      row("thick-space", "Spacing", "thick", "Thick mathematical space", "a thick b"),
      row("quad-space", "Spacing", "quad", "One-em space", "a quad b"),
      row("hide-space", "Spacing", "#h(0pt)", "Insert an exact Typst spacing expression", "a #h(1em) b"),
    ],
  },
  {
    id: "accents-decoration",
    title: "Accents and decoration",
    description: "Decorate expressions with accents, braces, labels, or cancellation marks.",
    rows: [
      row("vector-accent", "Accents", "arrow(x)", "Arrow accent", "arrow(x)"),
      row("hat-accent", "Accents", "hat(x)", "Hat accent", "hat(theta)"),
      row("tilde-accent", "Accents", "tilde(x)", "Tilde accent", "tilde(x)"),
      row("bar-accent", "Accents", "macron(x)", "Bar accent", "macron(x)"),
      row("dot-accent", "Accents", "dot(x)", "Dot accent", "dot(x) + dot.double(y)"),
      row("overbrace", "Decoration", "overbrace(expr, label)", "Brace and label above", "overbrace(1 + 2 + dots + n, n)", { display: "block" }),
      row("underbrace", "Decoration", "underbrace(expr, label)", "Brace and label below", "underbrace(a + dots + a, n \" terms\")", { display: "block" }),
      row("overset", "Decoration", "attach(base, t: top)", "Place content above", "attach(=, t: \"def\")"),
      row("underset", "Decoration", "attach(base, b: bottom)", "Place content below", "attach(arrow.r, b: n -> oo)"),
      row("cancel", "Decoration", "cancel(expr)", "Cancel an expression", "cancel(x) + y"),
    ],
  },
  {
    id: "text-style",
    title: "Text, fonts, and math style",
    description: "Quoted text remains text inside math. Style functions control weight, alphabet, size, and display class.",
    rows: [
      row("quoted-text", "Text", "\"text\"", "Insert upright text", "x = 1 quad \"when\" quad y = 0"),
      row("bold", "Style", "bold(x)", "Bold mathematical content", "bold(A) bold(x) = bold(b)"),
      row("italic", "Style", "italic(x)", "Italic content", "italic(A B C)"),
      row("upright", "Style", "upright(x)", "Upright content", "upright(dif) x"),
      row("blackboard", "Style", "bb(x)", "Blackboard-bold alphabet", "NN subset ZZ subset QQ subset RR subset CC"),
      row("calligraphic", "Style", "cal(x)", "Calligraphic alphabet", "cal(F)(x)"),
      row("fraktur", "Style", "frak(x)", "Fraktur alphabet", "frak(g)"),
      row("monospace", "Style", "mono(x)", "Monospaced alphabet", "mono(\"code\")"),
      row("script-size", "Style", "script(expr)", "Force script math size", "script(x + y)"),
      row("display-size", "Style", "display(expr)", "Force display math size", "display(sum_(i=1)^n i)"),
    ],
  },
  {
    id: "greek",
    title: "Greek letters",
    description: "Greek letters are named symbols. Capitalization and `.alt` select capital or alternate forms.",
    rows: [
      row("greek-lower", "Greek", "alpha beta gamma", "Lowercase Greek letters", "alpha + beta = gamma"),
      row("greek-upper", "Greek", "Alpha Beta Gamma", "Uppercase Greek letters", "Delta x = Sigma_i x_i"),
      row("greek-variants", "Greek", "phi.alt, epsilon.alt", "Alternate glyph variants", "phi + phi.alt + epsilon + epsilon.alt"),
      row("greek-common", "Greek", "theta lambda mu pi rho sigma omega", "Common lowercase symbols", "theta lambda mu pi rho sigma omega"),
      row("greek-capitals", "Greek", "Gamma Delta Theta Lambda Xi Pi Sigma Phi Psi Omega", "Common uppercase symbols", "Gamma Delta Theta Lambda Xi Pi Sigma Phi Psi Omega"),
    ],
  },
  {
    id: "relations-arrows",
    title: "Relations and arrows",
    description: "Named symbols cover comparisons, equivalence, approximation, precedence, and directional arrows.",
    rows: [
      row("comparison", "Relations", "< <= = >= >", "Basic comparisons", "a < b <= c = d >= e > f"),
      row("not-equal", "Relations", "!=", "Not equal", "x != y"),
      row("approx", "Relations", "approx", "Approximately equal", "pi approx 3.14159"),
      row("equivalence", "Relations", "equiv", "Equivalent", "a equiv b"),
      row("proportional", "Relations", "prop", "Proportional to", "y prop x^2"),
      row("right-arrow", "Arrows", "arrow.r", "Right arrow", "A arrow.r B"),
      row("left-right-arrow", "Arrows", "arrow.l.r", "Left-right arrow", "A arrow.l.r B"),
      row("double-arrow", "Arrows", "arrow.r.double", "Double right arrow", "P arrow.r.double Q"),
      row("mapsto", "Arrows", "arrow.r.bar", "Maps-to arrow", "x arrow.r.bar f(x)"),
      row("long-arrow", "Arrows", "arrow.r.long", "Long right arrow", "A arrow.r.long B"),
    ],
  },
  {
    id: "sets-logic",
    title: "Sets and logic",
    description: "Set, quantifier, and logical symbols use readable Typst names and can be negated with `not` variants.",
    rows: [
      row("number-sets", "Sets", "NN ZZ QQ RR CC", "Standard number sets", "NN subset ZZ subset QQ subset RR subset CC"),
      row("membership", "Sets", "in, in.not", "Membership and non-membership", "x in A comma y in.not A"),
      row("subset", "Sets", "subset, subset.eq", "Subset and subset-or-equal", "A subset B subset.eq C"),
      row("union-intersection", "Sets", "union, inter", "Union and intersection", "A union B comma A inter B"),
      row("empty-set", "Sets", "emptyset", "Empty set", "A inter B = emptyset"),
      row("forall-exists", "Logic", "forall, exists", "Universal and existential quantifiers", "forall x in RR comma exists y in RR"),
      row("logical-and-or", "Logic", "and, or, not", "Logical connectives", "not P or (P and Q)"),
      row("therefore-because", "Logic", "therefore, because", "Therefore and because", "P therefore Q"),
      row("turnstile", "Logic", "tack.r", "Entailment turnstile", "Gamma tack.r phi"),
    ],
  },
  {
    id: "misc-symbols",
    title: "Common symbols and shorthand",
    description: "Frequently used arithmetic, geometric, punctuation, and sequence symbols.",
    rows: [
      row("multiplication", "Arithmetic", "times, dot.c", "Multiplication symbols", "a times b = a dot.c b"),
      row("division", "Arithmetic", "div", "Division symbol", "a div b"),
      row("plus-minus", "Arithmetic", "plus.minus, minus.plus", "Plus/minus variants", "x = plus.minus sqrt(y)"),
      row("composition", "Arithmetic", "compose", "Function composition", "f compose g"),
      row("dots", "Sequences", "dots, dots.c, dots.v, dots.down", "Horizontal, centered, vertical, and diagonal dots", "a_1, a_2, dots.c, a_n"),
      row("angle", "Geometry", "angle", "Angle symbol", "angle A B C"),
      row("parallel", "Geometry", "parallel", "Parallel relation", "A B parallel C D"),
      row("perpendicular", "Geometry", "perp", "Perpendicular relation", "A B perp C D"),
      row("degree", "Geometry", "degree", "Degree symbol", "90 degree"),
      row("comma-semicolon", "Punctuation", "comma, semi", "Explicit mathematical punctuation", "x comma y semi z"),
    ],
  },
] as const satisfies readonly TypstMathReferenceGroup[];

export const typstMathReferenceRows: readonly TypstMathReferenceRow[] =
  typstMathReferenceGroups.flatMap((group) => group.rows);

function row(
  id: string,
  category: string,
  syntax: string,
  description: string,
  example: string,
  options: Pick<TypstMathReferenceRow, "display" | "notes"> = {},
): TypstMathReferenceRow {
  return { id, category, syntax, description, example, ...options };
}
