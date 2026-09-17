# `@babel-apps/katex`

Shared, synchronous KaTeX rendering for Babel applications.

- `@babel-apps/katex/core` exposes the bounded `renderKatexFormula` adapter and
  structured diagnostics.
- `@babel-apps/katex/react` exposes the accessible `KatexFormula` component.
- `@babel-apps/katex/reference` exposes the curated LaTeX/KaTeX formula guide.
- `@babel-apps/katex/styles.css` includes the pinned KaTeX font and layout CSS.

Rendering uses KaTeX's HTML and MathML output. Trusted commands are disabled,
expansion and size limits are finite, and macros are isolated per formula.
KaTeX implements a practical subset of LaTeX math rather than a full TeX
runtime.
