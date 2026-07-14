import assert from "node:assert/strict";
import test from "node:test";

import {
  extractWikilinks,
  maskCodeRegions,
  maskFencedCodeRegions,
  normalizeTitleKey,
  preprocessWikilinks,
} from "@babel-apps/markdown/core";

test("normalizes title keys deterministically", () => {
  assert.equal(normalizeTitleKey("  Mixed\tCASE\r\n标题  "), "mixed case 标题");
  assert.equal(normalizeTitleKey(" CAFÉ "), "café");
  assert.equal(normalizeTitleKey("\t \r\n"), "");
});

test("marks fenced and inline code without changing source offsets", () => {
  const markdown = [
    "visible [[one]]",
    "`inline [[two]]`",
    "```md",
    "fenced [[three]]",
    "```",
    "visible [[four]]",
  ].join("\r\n");
  const mask = maskCodeRegions(markdown);

  assert.equal(mask.length, markdown.length);
  assert.equal(mask[markdown.indexOf("[[one]]")], 0);
  assert.equal(mask[markdown.indexOf("[[two]]")], 1);
  assert.equal(mask[markdown.indexOf("[[three]]")], 1);
  assert.equal(mask[markdown.indexOf("[[four]]")], 0);
  const fenceMask = maskFencedCodeRegions(markdown);
  assert.equal(fenceMask[markdown.indexOf("[[two]]")], 0);
  assert.equal(fenceMask[markdown.indexOf("[[three]]")], 1);
});

test("marks tilde fences inside Markdown containers", () => {
  const markdown = [
    "> - ~~~md",
    ">   # hidden",
    ">   - hidden item",
    ">   ~~~",
    "# visible",
  ].join("\n");
  const mask = maskFencedCodeRegions(markdown);

  assert.equal(mask[markdown.indexOf("# hidden")], 1);
  assert.equal(mask[markdown.indexOf("- hidden item")], 1);
  assert.equal(mask[markdown.indexOf("# visible")], 0);
});

test("an unmatched backtick does not hide later links", () => {
  assert.deepEqual(extractWikilinks("unmatched ` then [[Visible]]"), [
    { titleRaw: "Visible", titleKey: "visible", alias: null },
  ]);
});

test("recognizes multiline code spans and fenced code inside Markdown containers", () => {
  const markdown = [
    "``before ` [[inline]]",
    "after`` [[outside-one]]",
    "> ```md",
    "> [[quoted]]",
    "> ```",
    "- ````",
    "  [[listed]]",
    "  ```",
    "  [[still-listed]]",
    "  ````",
    "[[outside-two]]",
  ].join("\n");

  assert.deepEqual(extractWikilinks(markdown), [
    { titleRaw: "outside-one", titleKey: "outside-one", alias: null },
    { titleRaw: "outside-two", titleKey: "outside-two", alias: null },
  ]);

  assert.deepEqual(
    extractWikilinks("- > ``code [[hidden]]\n  > continued`` [[visible]]"),
    [{ titleRaw: "visible", titleKey: "visible", alias: null }],
  );
  assert.deepEqual(
    extractWikilinks("> - ``code [[hidden]]\n>   continued`` [[visible]]"),
    [{ titleRaw: "visible", titleKey: "visible", alias: null }],
  );
});

test("does not pair inline code delimiters across block boundaries", () => {
  const markdown = [
    "`unclosed paragraph",
    "",
    "[[visible-one]]`",
    "`before fence",
    "```",
    "fenced",
    "```",
    "[[visible-two]]`",
  ].join("\n");

  assert.deepEqual(extractWikilinks(markdown), [
    { titleRaw: "visible-one", titleKey: "visible-one", alias: null },
    { titleRaw: "visible-two", titleKey: "visible-two", alias: null },
  ]);

  assert.deepEqual(extractWikilinks("`paragraph\n# [[heading]]`\n- [[list-item]]"), [
    { titleRaw: "heading", titleKey: "heading", alias: null },
    { titleRaw: "list-item", titleKey: "list-item", alias: null },
  ]);

  assert.deepEqual(extractWikilinks("`open\n<em> [[hidden]]`"), []);
  assert.deepEqual(extractWikilinks("`open\n[label]: /url [[hidden]]`"), []);
});

test("keeps lazy blockquote inline code inside ordered list containers", () => {
  const markdown = "- > `code\n  [[hidden]]`\n- [[visible]]";
  assert.deepEqual(extractWikilinks(markdown), [
    { titleRaw: "visible", titleKey: "visible", alias: null },
  ]);

  const orderedList = "1. `code\n[[hidden]]`\n2. [[visible-ordered]]";
  assert.deepEqual(extractWikilinks(orderedList), [
    { titleRaw: "visible-ordered", titleKey: "visible-ordered", alias: null },
  ]);
});

test("does not pair inline code delimiters across GFM table rows", () => {
  const markdown = [
    "| A |",
    "| - |",
    "| `open |",
    "| [[visible]]` |",
  ].join("\n");
  assert.deepEqual(extractWikilinks(markdown), [
    { titleRaw: "visible", titleKey: "visible", alias: null },
  ]);

  assert.deepEqual(extractWikilinks("| A |\n| - |\n| `[[hidden]]` |"), []);

  const invalidTable = "`open | extra\n| --- |\n[[hidden]]`";
  assert.deepEqual(extractWikilinks(invalidTable), []);

  const mismatchedColumns = [
    "| A | B |",
    "| --- |",
    "| `open |",
    "| [[hidden]]` |",
  ].join("\n");
  assert.deepEqual(extractWikilinks(mismatchedColumns), []);

  const acrossCells = [
    "| A | B |",
    "| - | - |",
    "| `open | [[visible-cell]]` |",
  ].join("\n");
  assert.deepEqual(extractWikilinks(acrossCells), [
    { titleRaw: "visible-cell", titleKey: "visible-cell", alias: null },
  ]);
});

test("recognizes fences nested through list and blockquote containers", () => {
  const markdown = [
    "- > ```md",
    "  > [[hidden]]",
    "  > ```",
    "[[visible]]",
  ].join("\n");

  assert.deepEqual(extractWikilinks(markdown), [
    { titleRaw: "visible", titleKey: "visible", alias: null },
  ]);

  const unclosedNestedFence = "- > ```\n  > code\n\n[[outside-list]]";
  assert.deepEqual(extractWikilinks(unclosedNestedFence), [
    { titleRaw: "outside-list", titleKey: "outside-list", alias: null },
  ]);
});

test("ends container fences before sibling items and ignores deeper fence-like content", () => {
  const siblingItems = [
    "- ```",
    "  [[hidden-one]]",
    "- [[visible]]",
    "- ```",
    "  [[hidden-two]]",
  ].join("\n");
  const deeperContainer = [
    "> ```",
    "> > ```",
    "> [[hidden-three]]",
    "> ```",
    "[[outside]]",
  ].join("\n");

  assert.deepEqual(extractWikilinks(siblingItems), [
    { titleRaw: "visible", titleKey: "visible", alias: null },
  ]);
  assert.deepEqual(extractWikilinks(deeperContainer), [
    { titleRaw: "outside", titleKey: "outside", alias: null },
  ]);

  const listFenceWithBlankLine = [
    "- ```",
    "  code",
    "",
    "  [[hidden-four]]",
    "  ```",
    "[[after-blank]]",
  ].join("\n");
  assert.deepEqual(extractWikilinks(listFenceWithBlankLine), [
    { titleRaw: "after-blank", titleKey: "after-blank", alias: null },
  ]);


  const nestedOrderedList = [
    "1. outer",
    "   1. inner",
    "      ```",
    "      [[hidden-five]]",
    "      ```",
    "   2. [[visible-two]]",
  ].join("\n");
  assert.deepEqual(extractWikilinks(nestedOrderedList), [
    { titleRaw: "visible-two", titleKey: "visible-two", alias: null },
  ]);

  const quotedList = [
    "> 1. inner",
    ">    ```",
    ">    [[hidden-six]]",
    "> 2. [[visible-three]]",
  ].join("\n");
  assert.deepEqual(extractWikilinks(quotedList), [
    { titleRaw: "visible-three", titleKey: "visible-three", alias: null },
  ]);
});

test("does not let a non-one ordered list interrupt a paragraph with a fence", () => {
  const markdown = "paragraph\n2. ```\n   [[visible]]";
  assert.deepEqual(extractWikilinks(markdown), [
    { titleRaw: "visible", titleKey: "visible", alias: null },
  ]);

  const quotedParagraph = "> paragraph\n> 2. ```\n>    [[visible-quoted]]";
  assert.deepEqual(extractWikilinks(quotedParagraph), [
    { titleRaw: "visible-quoted", titleKey: "visible-quoted", alias: null },
  ]);
});

test("extracts Unicode links and splits aliases only once", () => {
  assert.deepEqual(
    extractWikilinks("[[  Café  |咖啡|coffee]] and [[東京]] and [[Same   Title]]"),
    [
      { titleRaw: "  Café  ", titleKey: "café", alias: "咖啡|coffee" },
      { titleRaw: "東京", titleKey: "東京", alias: null },
      { titleRaw: "Same   Title", titleKey: "same title", alias: null },
    ],
  );
});

test("supports balanced brackets inside a title and alias", () => {
  assert.deepEqual(extractWikilinks("[[Title [draft]|Read [this]]]"), [
    {
      titleRaw: "Title [draft]",
      titleKey: "title [draft]",
      alias: "Read [this]",
    },
  ]);
  assert.equal(
    preprocessWikilinks("[[Title [draft]|Read [this]]]"),
    "[Read \\[this\\]](babel-note://title%20%5Bdraft%5D)",
  );
});

test("uses a visible label for an empty alias and safely encodes Markdown punctuation", () => {
  assert.deepEqual(extractWikilinks("[[A)B|]]"), [
    { titleRaw: "A)B", titleKey: "a)b", alias: "" },
  ]);
  assert.equal(preprocessWikilinks("[[A)B|]]"), "[A)B](babel-note://a%29b)");
});

test("ignores empty, multiline, fenced, inline-code, and Obsidian embed forms", () => {
  const markdown = [
    "[[]] [[   ]] [[line",
    "break]] `[[inline]]` ![[embed.png]]",
    "```",
    "[[fenced]]",
    "```",
    "[[visible]]",
  ].join("\r\n");

  assert.deepEqual(extractWikilinks(markdown), [
    { titleRaw: "visible", titleKey: "visible", alias: null },
  ]);
  assert.equal(
    preprocessWikilinks(markdown),
    markdown.replace("[[visible]]", "[visible](babel-note://visible)"),
  );
});

test("preprocessing preserves upload tokens and supports typed targets", () => {
  const markdown = "![Draft](esperanto-upload://token-1)\r\n[[Knowledge Note|Read it]]";

  assert.equal(
    preprocessWikilinks(markdown, { targetKind: "knowledge" }),
    "![Draft](esperanto-upload://token-1)\r\n[Read it](babel-note://knowledge/knowledge%20note)",
  );
  assert.equal(
    preprocessWikilinks("[[Known]] [[Unknown]]", {
      targetKind: ({ titleKey }) => titleKey === "known" ? "exercise" : null,
    }),
    "[Known](babel-note://exercise/known) [Unknown](babel-note://unknown)",
  );

  const occurrences: Array<{ title: string; start: number; end: number }> = [];
  const withOffsets = preprocessWikilinks("x [[One]] y [[Two|2]]", {
    onWikilink: (wikilink, occurrence) => {
      occurrences.push({
        title: wikilink.titleRaw,
        start: occurrence.start,
        end: occurrence.end,
      });
    },
  });
  assert.deepEqual(
    occurrences.map(({ title, start, end }) => ({
      title,
      rewritten: withOffsets.slice(start, end),
    })),
    [
      { title: "One", rewritten: "[One](babel-note://one)" },
      { title: "Two", rewritten: "[2](babel-note://two)" },
    ],
  );
});

test("preserves escaped links and is safe to preprocess repeatedly", () => {
  const markdown = String.raw`\[[Literal]] [[A [[nested]] title]]`;
  const once = preprocessWikilinks(markdown);

  assert.equal(once, String.raw`\[[Literal]] [A \[\[nested\]\] title](babel-note://a%20%5B%5Bnested%5D%5D%20title)`);
  assert.equal(preprocessWikilinks(once), once);
});

test("recovers from malformed openers without repeatedly rescanning the document", () => {
  const malformedLine = "[[".repeat(20_000);
  assert.deepEqual(extractWikilinks(`${malformedLine}\n[[Recovered]]`), [
    { titleRaw: "Recovered", titleKey: "recovered", alias: null },
  ]);
  assert.deepEqual(extractWikilinks("Press [[, then link [[Target]] and [[Second]]"), [
    { titleRaw: "Target", titleKey: "target", alias: null },
    { titleRaw: "Second", titleKey: "second", alias: null },
  ]);

  const escapedNestedOpeners = "[[bad \\[[x]] ".repeat(4_000);
  assert.deepEqual(extractWikilinks(escapedNestedOpeners), []);

  const validNestedOpeners = "[[bad [[x]] ".repeat(4_000);
  const recoveredNested = extractWikilinks(validNestedOpeners);
  assert.equal(recoveredNested.length, 4_000);
  assert.deepEqual(recoveredNested[0], { titleRaw: "x", titleKey: "x", alias: null });
  assert.deepEqual(recoveredNested.at(-1), { titleRaw: "x", titleKey: "x", alias: null });

  const emptyNestedOpeners = "[[bad [[]] ".repeat(4_000);
  assert.deepEqual(extractWikilinks(emptyNestedOpeners), []);
});

test("handles many unmatched backtick runs without hiding the next block", () => {
  const unmatchedRuns = Array.from({ length: 500 }, (_, index) => "`".repeat(index + 1));
  const markdown = `${unmatchedRuns.join(" x ")}\n\n[[Visible]]`;

  assert.deepEqual(extractWikilinks(markdown), [
    { titleRaw: "Visible", titleKey: "visible", alias: null },
  ]);
});
