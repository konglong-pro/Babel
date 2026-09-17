import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  commandAllowedFromEditable,
  handleReadShortcutKeyDown,
  ShortcutProvider,
} from "../src/shortcuts/react";

test("editing focus preserves text editing commands", () => {
  for (const command of ["new", "edit", "delete"] as const) {
    assert.equal(commandAllowedFromEditable(command, true), false);
  }
  for (const command of [
    "save",
    "read",
    "confirm",
    "cancel",
    "search",
    "commandPalette",
    "focusNextPane",
    "focusPreviousPane",
    "nextTab",
    "previousTab",
    "closeTab",
    "quickOpen",
    "help",
  ] as const) {
    assert.equal(commandAllowedFromEditable(command, true), true);
  }
  assert.equal(commandAllowedFromEditable("delete", false), true);
});

test("the Read shortcut consumes native reload without repeating its action", () => {
  let executions = 0;
  let prevented = 0;
  let stopped = 0;
  const event = {
    key: "r",
    ctrlKey: true,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    repeat: false,
    preventDefault: () => {
      prevented += 1;
    },
    stopPropagation: () => {
      stopped += 1;
    },
  };

  assert.equal(
    handleReadShortcutKeyDown(event, "Ctrl+R", true, () => {
      executions += 1;
      return false;
    }),
    true,
  );
  assert.deepEqual({ executions, prevented, stopped }, { executions: 1, prevented: 1, stopped: 1 });

  assert.equal(
    handleReadShortcutKeyDown(
      { ...event, repeat: true },
      "Ctrl+R",
      true,
      () => {
        executions += 1;
        return true;
      },
    ),
    true,
  );
  assert.deepEqual({ executions, prevented, stopped }, { executions: 1, prevented: 2, stopped: 2 });
});

test("the Read shortcut does not consume unrelated or unsafe key events", () => {
  let executions = 0;
  let prevented = 0;
  const makeEvent = (overrides: Record<string, unknown> = {}) => ({
    key: "s",
    ctrlKey: true,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    repeat: false,
    preventDefault: () => {
      prevented += 1;
    },
    stopPropagation: () => undefined,
    ...overrides,
  });

  for (const event of [
    makeEvent(),
    makeEvent({ repeat: true }),
    makeEvent({ key: "r", metaKey: true }),
    makeEvent({ key: "r", isComposing: true }),
    makeEvent({ key: "r", getModifierState: (key: string) => key === "AltGraph" }),
    makeEvent({ key: "r", defaultPrevented: true }),
  ]) {
    assert.equal(
      handleReadShortcutKeyDown(event, "Ctrl+R", true, () => {
        executions += 1;
        return true;
      }),
      false,
    );
  }
  assert.deepEqual({ executions, prevented }, { executions: 0, prevented: 0 });
});

test("an unbound Read command does not consume its former default", () => {
  let prevented = 0;
  const handled = handleReadShortcutKeyDown(
    {
      key: "r",
      ctrlKey: true,
      preventDefault: () => {
        prevented += 1;
      },
      stopPropagation: () => undefined,
    },
    null,
    false,
    () => true,
  );
  assert.equal(handled, false);
  assert.equal(prevented, 0);
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
  assert.match(markup, />Search commands and titles</);
  assert.match(markup, /role="combobox"/);
  assert.match(markup, /role="listbox"/);
  assert.match(markup, /<li role="presentation"><button[^>]+role="option"/);
  assert.match(markup, /aria-label="Commands, actions, and titles"/);
  assert.match(markup, />Keyboard Help</);
  assert.match(markup, />Ready mode</);
  assert.match(markup, />Quick Open</);
});

test("palette actions and item sources follow the active cached workspace", () => {
  const source = readFileSync(new URL("../src/shortcuts/react.tsx", import.meta.url), "utf8");

  assert.equal(
    (source.match(/const processActive = useWorkspaceProcessActive\(\)/g) ?? []).length,
    2,
  );
  assert.match(source, /context === null \|\| !processActive/);
  assert.match(
    source,
    /registeredSource\.scope !== "global" && !processActive/,
  );
  assert.match(source, /searchItems\?: \(/);
  assert.match(source, /controller\.abort\(\)/);
  assert.match(source, /seenItems\.has\(dedupeKey\)/);
  assert.match(source, /Searching titles…/);
});
