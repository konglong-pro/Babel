# Matter instructions

Matter is the physics notebook Module. Preserve its knowledge, exercise,
scratch-work, search, native Typst math, LaTeX/KaTeX math, Markdown, and managed-image behavior.
Its private data is rooted at `data/matter/` from the Babel root and configured
with `MATTER_DATABASE_PATH` and `MATTER_NOTE_UPLOAD_DIRECTORY`.

Exercise problems, answers, and solutions are Markdown fields and share the
managed note-image Adapter. Keep database logical image paths stable when
changing its physical storage. Run `npm.cmd run check -w @babel-apps/matter` for
a full gate. Apply schema migrations only with an explicit data task and while
the app is stopped.

The root `AGENTS.md` owns shared commands and public/private data discipline.
