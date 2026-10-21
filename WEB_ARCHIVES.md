# David rich archives

David's **Export for Babel** creates a portable `.babel.json` file from a
loaded ChatGPT, Gemini or Claude conversation, or a selected message range.
Use **Import → Import David archive** in a Babel APP, then drag the exported
`.babel.json` file from Downloads onto the import window, or choose the file.
Review the capture, then open a draft. Choose its folder and tags and save
through the usual editor.
Importing or previewing a capture does not save it.

Drop one archive at a time. Invalid replacements leave the already reviewed
capture intact; folders and multiple-file drops are rejected with a message.

The note contains editable Markdown and local image attachments. A separate
**View original layout** link preserves the capture as it appeared at export
time, including image order, captions, tables and static styling. Editing the
note does not change this original capture. Removing the original-layout link
before Save skips storing the snapshot.

## What is preserved

- Text, message roles, headings, lists, tables, code and supported formulas
  remain Markdown that can be edited in Babel.
- Photos are copied into the archive. SVG and canvas illustrations are
  rasterized to PNG; rendered graphics that cannot be read directly can use
  David's active-tab screenshot fallback.
- A controlled HTML tree and selected computed styles preserve the displayed
  message layout. It excludes the website's sidebar and conversation controls.

Export includes currently loaded messages. Load older messages before capture.
Interactive charts and animations keep their displayed state. Third-party
embeds, inaccessible content, streaming responses, and platform layout changes
can limit capture; David reports warnings or a capture error instead of
silently truncating an oversized archive. Review the result before closing the
source page. This is a static archive, so original website behavior and exact
font rendering on a different computer are not guaranteed.

When a screenshot would include text outside a partial selection, David rejects
that capture. Select the whole diagram or message to preserve its appearance
without including unselected content. Formulas without recoverable source remain
local pictures in the editable note.

## Version 1 exchange format

The UTF-8 JSON object has `format: "babel.web-archive"`, `version: 1`, a title,
Markdown, optional source metadata, raster assets, a snapshot and warnings.
Markdown refers to pictures as `assets/<name>`. Snapshot image nodes use
`babel-asset://<id>`; Babel resolves these only to validated embedded assets.
PNG, JPEG, WebP and GIF are supported. Raw SVG, scripts and arbitrary HTML are
not accepted by the snapshot renderer.

| Limit | Maximum |
| --- | --- |
| Archive file | 150 MiB |
| Rendered snapshot HTML | 150 MiB |
| Markdown, including the original-layout link | 10 MiB UTF-8 |
| Images | 50 |
| One decoded image | 10 MiB |
| All decoded images | 100 MiB |
| Snapshot nodes / depth | 30,000 / 80 |

Use a smaller message selection when a limit is exceeded. Babel validates the
file locally before opening a draft and validates it again when storing the
snapshot. Invalid assets, unknown nodes and unsafe style values are rejected.
The note's existing 100 MiB combined Markdown and new-image save limit also
applies; images used only in the original layout do not count toward that note
limit.

## Storage and isolation

Saving uses each APP's existing managed-image flow. Snapshots are immutable
JSON files under that APP's configured private upload directory, within
`documents/web-archives/<content-hash>/archive.json`. Existing data backups
include these files. Notebook database schemas are unchanged.

The snapshot endpoint emits escaped static HTML with raster data URLs. Its
Content Security Policy disables scripts, external network resources, forms
and embedding outside the local origin. Preview runs inside an empty-sandbox
iframe; the saved viewer is also sandboxed by its response policy. Source URLs
are metadata, not resources loaded by the viewer.

Quick Copy, Save Markdown, and ordinary Markdown file imports retain their
existing behavior. Those paths can contain remote image URLs; use rich archives
when the pictures and original layout must remain available offline.
