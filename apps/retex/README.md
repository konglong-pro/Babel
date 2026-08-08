# ReTex

ReTex is Babel's local, single-user mathematics archive for knowledge, selected
exercises, archived solutions, and per-exercise scratch work. It uses Markdown,
native Typst mathematics, LaTeX math rendered by KaTeX, and shared formula
adapters on Next.js with SQLite and Drizzle.

From the Babel root:

```powershell
npm.cmd run dev:retex
npm.cmd run check -w @babel-apps/retex
```

Open `http://127.0.0.1:3000`. Private data lives in `data/retex/sqlite.db` and
the `data/retex/uploads/notes/` directory in the independent private `data/`
repository. The launcher supplies absolute `RETEX_DATABASE_PATH` and
`RETEX_NOTE_UPLOAD_DIRECTORY` values.

Use native Typst syntax with `$f(x)=x^2$` for inline math and `$ f(x)=x^2 $` on
its own line for display math. Use LaTeX/KaTeX syntax with `\(f(x)=x^2\)` for
inline math, or `\[f(x)=x^2\]` and `$$f(x)=x^2$$` for display math. The engines
are selected deterministically: single-dollar formulas default to Typst, while
recognizable LaTeX control sequences such as `\frac` and braced scripts such as
`x_{i+1}`, plus implicit products such as `4ac`, use KaTeX for compatibility
with existing Markdown. Babel does not retry a failed formula in another
engine. KaTeX can recover a stray backslash before an otherwise undefined
single-letter variable, such as `\b^2`; other unknown commands remain errors.
Prefer explicit LaTeX delimiters for new content. KaTeX supports a practical
subset of LaTeX math. Run schema
generation or migration only for an explicit database task and only while
ReTex is stopped. Use the root `npm.cmd run data:backup` workflow for normal
backups; never commit notebook data to the public Babel repository.

Knowledge can import UTF-8 `.md` files and match referenced local PNG, JPEG,
WebP, or GIF files before saving. Exercise problems, answers, and solutions use
the same Markdown editor and managed-image workflow. **Read**, placed above the
active content heading, opens a separate reader window for saved or live
Knowledge, whole Exercises, and Scratch work. The bottom-left English **Markdown Guide** and
**Formula Reference** open across the two navigation columns without covering the
writing column. A Markdown save is limited to 10 MiB of content, 50 new images, 100 MiB
logically, and 160 MiB on the multipart wire. ReTex serializes managed-note
image mutations and reconciles interrupted image transactions during health
checks and before later writes.

## Keyboard navigation

ReTex follows Babel's Ready/Edit keyboard model. `Ctrl+F6` and
`Ctrl+Shift+F6` cycle the visible folder tree, item tree, tab strip, and detail
pane, skipping absent panes and remembering each pane's last focus. Hierarchical
folders and items expose `tree`/`treeitem`; flat search results expose `listbox`.
Up/Down moves, Left/Right collapses or expands, Home/End/PageUp/PageDown moves
through supported lists, and typed letters jump by title. `Enter` selects or
opens the focused item tab; `F2` renames a focused folder or opens a focused item
directly in edit mode. The `tablist` uses Left/Right to move and Enter to
activate.

Reordering uses `Ctrl+Alt+ArrowUp` and `Ctrl+Alt+ArrowDown`. Escape gives the
topmost dialog or overlay priority, then leaves edit mode for the reader and the
reader for the item tree; dirty-edit confirmations still apply. `Ctrl+K`
searches commands, registered actions, and titles, while `Ctrl+Alt+P` searches
titles only. `Ctrl+Alt+H` opens keyboard help. Tab defaults are
`Ctrl+Alt+ArrowRight`, `Ctrl+Alt+ArrowLeft`, and `Ctrl+Alt+W` for next, previous,
and close. Schema v1/v2 bindings are preserved during migration; a conflicting
new command remains `Unbound`. See the
[root keyboard contract](../../README.md#launcher) for the complete schema-v3
command table.
