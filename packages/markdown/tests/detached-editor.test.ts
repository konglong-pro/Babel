import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  DetachedEditorWindow,
  detachedEditorWindowFeatures,
  detachedEditorWindowName,
} from "@babel-apps/markdown/detached-editor";

test("normalizes stable detached editor window names", () => {
  assert.equal(
    detachedEditorWindowName("  ReTex / knowledge:42  "),
    "babel-editor-ReTex-knowledge-42",
  );
  assert.equal(detachedEditorWindowName("***"), "babel-editor-document");
});

test("aligns detached editor geometry with the source detail panel", () => {
  assert.equal(
    detachedEditorWindowFeatures(
      { left: 520, top: 52, width: 1240, height: 948 },
      {
        screenX: 100,
        screenY: 40,
        innerWidth: 1760,
        innerHeight: 1000,
        outerWidth: 1776,
        outerHeight: 1088,
      },
    ),
    "popup=yes,left=628,top=180,width=1240,height=948,resizable=yes,scrollbars=yes",
  );
});

test("renders a reopen control without rendering editor content inline", () => {
  const html = renderToStaticMarkup(createElement(
    DetachedEditorWindow,
    {
      title: "Functions - Content editor",
      windowKey: "retex-knowledge-42",
      label: "Content",
    },
    createElement("p", null, "Detached editor content"),
  ));

  assert.match(html, /class="babel-detached-editor-launcher"/u);
  assert.match(html, /aria-label="Content editor"/u);
  assert.match(html, />Open Content<\/button>/u);
  assert.doesNotMatch(html, /Detached editor content/u);
});
