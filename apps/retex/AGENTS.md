# ReTex instructions

ReTex is the mathematics notebook Module. Preserve its knowledge, exercise,
scratch-work, search, native Typst math, LaTeX/KaTeX math, Markdown, and managed-image behavior.
Its private data is rooted at `data/retex/` from the Babel root and configured
with `RETEX_DATABASE_PATH` and `RETEX_NOTE_UPLOAD_DIRECTORY`.

Exercise problems, answers, and solutions are Markdown fields and share the
managed note-image Adapter. Keep database logical image paths stable when
changing its physical storage. Run `npm.cmd run check -w @babel-apps/retex` for
a full gate. Apply schema migrations only with an explicit data task and while
the app is stopped.

The root `AGENTS.md` owns shared commands and public/private data discipline.
