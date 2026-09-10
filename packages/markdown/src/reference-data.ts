export interface MarkdownWritingGuideRow {
  id: string;
  category: string;
  syntax: string;
  usage: string;
}

export interface MarkdownWritingGuideGroup {
  id: string;
  title: string;
  rows: readonly MarkdownWritingGuideRow[];
}

export const markdownWritingGuideGroups = [
  {
    id: "headings",
    title: "Headings",
    rows: [
      row("heading-1", "Heading", "# Heading", "Create a level 1 heading."),
      row("heading-2", "Heading", "## Heading", "Create a level 2 heading."),
      row("heading-3", "Heading", "### Heading", "Create a level 3 heading."),
    ],
  },
  {
    id: "text",
    title: "Text",
    rows: [
      row("paragraph", "Paragraph", "Blank line", "Start a new paragraph."),
      row("line-break", "Line break", "End the line with \\", "Insert a line break without starting a new paragraph."),
      row("bold", "Bold", "**text**", "Add strong emphasis."),
      row("italic", "Italic", "*text*", "Add light emphasis."),
      row("strikethrough", "Strikethrough", "~~text~~", "Mark removed or outdated text."),
      row("escape", "Escape", "\\*literal text\\*", "Display Markdown punctuation literally."),
    ],
  },
  {
    id: "lists",
    title: "Lists",
    rows: [
      row("unordered-list", "Unordered list", "- Item", "Create a bulleted list."),
      row("ordered-list", "Ordered list", "1. Item", "Create a numbered list."),
      row("nested-list", "Nested list", "  - Item", "Indent an item to create a sub-list."),
      row("open-task", "Task list", "- [ ] Task", "Create an unfinished task."),
      row("completed-task", "Task list", "- [x] Task", "Create a completed task."),
    ],
  },
  {
    id: "blocks",
    title: "Blocks",
    rows: [
      row("blockquote", "Blockquote", "> Quote", "Display quoted or referenced text."),
      row("horizontal-rule", "Horizontal rule", "---", "Separate sections."),
    ],
  },
  {
    id: "links",
    title: "Links",
    rows: [
      row("external-link", "External link", "[Label](https://example.com)", "Link text to a web page."),
      row("automatic-link", "Automatic link", "<https://example.com>", "Display a web address as a link."),
      row("wikilink", "Wikilink", "[[Note Title]]", "Link to another Babel note."),
      row("wikilink-alias", "Wikilink alias", "[[Note Title|Label]]", "Link to a note with different display text."),
    ],
  },
  {
    id: "media",
    title: "Media",
    rows: [
      row("image", "Image", "![Alt text](image-url)", "Display an image with accessible alternative text."),
      row("managed-image", "Managed image", "Paste, drop, or Add image", "Upload an image and insert its Babel-managed Markdown."),
    ],
  },
  {
    id: "tables",
    title: "Tables",
    rows: [
      row(
        "table",
        "Table",
        "| A | B |\n| --- | --- |\n| 1 | 2 |",
        "Create a GitHub-Flavored Markdown table.",
      ),
      row(
        "table-alignment",
        "Table alignment",
        "| :--- | :---: | ---: |",
        "Align columns left, center, and right.",
      ),
    ],
  },
  {
    id: "code",
    title: "Code",
    rows: [
      row("inline-code", "Inline code", "`code`", "Display a command, variable, or short code fragment."),
      row("code-block", "Code block", "```js\ncode\n```", "Display a fenced code block with an optional language."),
    ],
  },
  {
    id: "math",
    title: "Formula Math",
    rows: [
      row("typst-inline-math", "Typst inline", "$x^2 + y^2$", "Display native Typst math inside a paragraph."),
      row("typst-block-math", "Typst block", "$ x^2 + y^2 $", "Display native Typst math as a standalone block when spaced delimiters occupy the whole line."),
      row("latex-compatible-dollar", "LaTeX inline", "$\\frac{a}{b}$", "Render recognizable traditional single-dollar LaTeX with KaTeX for compatibility."),
      row("latex-inline-math", "LaTeX inline", "\\(x^2 + y^2\\)", "Display inline LaTeX math with KaTeX."),
      row("latex-block-math", "LaTeX block", "\\[x^2 + y^2\\]", "Display block LaTeX math with KaTeX."),
      row("latex-dollar-block", "LaTeX block", "$$x^2 + y^2$$", "Display block LaTeX math with familiar double-dollar delimiters."),
      row("literal-dollar", "Dollar sign", "\\$100", "Display a literal dollar sign."),
    ],
  },
] as const satisfies readonly MarkdownWritingGuideGroup[];

export const markdownWritingGuideRows: readonly MarkdownWritingGuideRow[] =
  markdownWritingGuideGroups.flatMap((group) => group.rows);

function row(
  id: string,
  category: string,
  syntax: string,
  usage: string,
): MarkdownWritingGuideRow {
  return { id, category, syntax, usage };
}
