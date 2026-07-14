import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  commandAllowedFromEditable,
  ShortcutProvider,
} from "../src/shortcuts/react";

test("editing focus preserves text editing commands", () => {
  for (const command of ["new", "edit", "delete"] as const) {
    assert.equal(commandAllowedFromEditable(command, true), false);
  }
  for (const command of [
    "save",
    "confirm",
    "cancel",
    "search",
    "commandPalette",
  ] as const) {
    assert.equal(commandAllowedFromEditable(command, true), true);
  }
  assert.equal(commandAllowedFromEditable("delete", false), true);
});

test("shortcut provider renders an accessible built-in command palette", () => {
  const markup = renderToStaticMarkup(
    createElement(
      ShortcutProvider,
      null,
      createElement("main", null, "Notebook"),
    ),
  );

  assert.match(markup, /<main>Notebook<\/main>/);
  assert.match(markup, /<dialog[^>]+aria-labelledby=/);
  assert.match(markup, />Command Palette</);
  assert.match(markup, />Search commands</);
  assert.match(markup, /aria-label="Commands"/);
  assert.equal((markup.match(/<kbd>/g) ?? []).length, 8);
});
