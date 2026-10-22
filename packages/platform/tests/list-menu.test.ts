import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ImportMenu } from "../src/imports/menu-react";
import { listMenuPosition } from "../src/navigation/menu-position";

test("a wide menu can cross its list pane without leaving the viewport", () => {
  // Bio's 330px list pane starts at x250. Large text makes both menus wider
  // than that pane, so the old absolute positioning clipped their left side.
  assert.deepEqual(listMenuPosition({ left: 490, right: 579, top: 160, bottom: 204 },
    { width: 423, height: 300 }, { width: 1440, height: 900 }),
  { left: 156, top: 208, maxHeight: 684 });
  assert.equal(listMenuPosition({ left: 10, right: 90, top: 20, bottom: 60 },
    { width: 300, height: 200 }, { width: 390, height: 844 }).left, 8);
  assert.equal(listMenuPosition({ left: 350, right: 420, top: 20, bottom: 60 },
    { width: 300, height: 200 }, { width: 390, height: 844 }).left, 82);
});

test("bottom-edge menus flip above and short viewports keep options scrollable", () => {
  assert.deepEqual(listMenuPosition({ left: 320, right: 400, top: 720, bottom: 760 },
    { width: 220, height: 220 }, { width: 1440, height: 800 }),
  { left: 180, top: 496, maxHeight: 708 });
  assert.deepEqual(listMenuPosition({ left: 300, right: 380, top: 180, bottom: 220 },
    { width: 220, height: 700 }, { width: 390, height: 300 }),
  { left: 160, top: 8, maxHeight: 168 });
});

test("the import trigger retains native details semantics, a named popover and disabled hints", () => {
  const markup = renderToStaticMarkup(createElement(ImportMenu, {
    disabled: true, describedBy: "folder-hint", unavailableTitle: "Select a folder first",
  }, createElement("button", { type: "button" }, "Import Markdown file")));
  assert.match(markup, /^<details class="babel-import-menu">/u);
  assert.match(markup, /<summary[^>]*aria-disabled="true"[^>]*aria-describedby="folder-hint"[^>]*title="Select a folder first"/u);
  assert.match(markup, /class="babel-import-menu__options babel-list-menu-options" popover="manual" aria-label="Import options"/u);
  assert.match(markup, /<button type="button">Import Markdown file<\/button>/u);
  assert.doesNotMatch(markup, /<details[^>]* open(?: |>|=)/u);
});
