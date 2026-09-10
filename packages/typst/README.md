# `@babel-apps/typst`

Shared, browser-only Typst formula compilation for Babel applications.

- `@babel-apps/typst/core` exposes the compiler client, result types, source
  wrapper, SVG sanitizer, cache configuration, and singleton compile API.
- `@babel-apps/typst/react` exposes `TypstFormula`, which renders compiler SVG
  through an isolated Blob-backed image and preserves the source as alt text.
- `@babel-apps/typst/reference` exposes the versioned math reference used by
  application help panels.

The compiler and renderer run lazily in one Web Worker. Typst.ts, its compiler,
and its renderer are pinned to `0.7.0` (Typst language `0.14.2`); the bundled
New Computer Modern font assets are pinned to Typst assets `v0.13.1`.

There is no CDN fallback. A host must copy the package's WASM and font files to
its static directory before building or serving it:

```powershell
npm.cmd run assets:sync -w @babel-apps/typst -- <app-public-directory>
```

The default URLs are under `/_typst/`. `configureTypstFormulaCompiler` can use a
different relative or root-relative directory, but rejects absolute and
protocol-relative asset URLs so compilation remains same-origin and offline.
Formula compilation uses a memory-only world and rejects Typst file, package,
plugin, and external resource capabilities. That source check is deliberately
conservative: capability names are rejected even when they appear in a string
or comment, favoring an offline guarantee over those uncommon formula literals.
