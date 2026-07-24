import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  PageDeckPage,
  PageSessionProvider,
  PageTabs,
} from "@babel-apps/platform/pages/react";

test("page tabs and kept-alive panels expose the active session accessibly", () => {
  const markup = renderToStaticMarkup(
    createElement(
      PageSessionProvider,
      {
        initialPages: [
          { key: "note:1", kind: "Note", title: "First", href: "/notes?note=1" },
          {
            key: "note:2",
            kind: "Note",
            title: "Second",
            href: "/notes?note=2",
            dirty: true,
          },
        ],
        initialActiveKey: "note:2",
      },
      createElement(PageTabs),
      createElement(PageDeckPage, { pageKey: "note:1" }, "First content"),
      createElement(PageDeckPage, { pageKey: "note:2" }, "Second content"),
    ),
  );

  assert.match(markup, /role="tablist"/);
  assert.match(markup, /aria-selected="true"[^>]*>[\s\S]*Second/);
  assert.match(markup, /aria-label="Unsaved changes"/);
  assert.match(markup, /data-page-key="note:1"[^>]*hidden=""/);
  assert.match(markup, /data-page-key="note:2"[^>]*data-active=""/);
});
