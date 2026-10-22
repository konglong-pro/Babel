import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  commandAllowedFromEditable,
  executeShortcutCommand,
  handleReadShortcutKeyDown,
  handleShortcutKeyDown,
  subscribeShortcutSettings,
  ShortcutProvider,
} from "../src/shortcuts/react";
import { DEFAULT_SHORTCUT_SETTINGS, type ShortcutSettings } from "../src/shortcuts/core";

test("window commands require their desktop capability and work in detached documents", () => {
  const messages: string[] = [];
  const view = { __BABEL_DESKTOP__: true, __BABEL_DESKTOP_WINDOW_COMMANDS__: false,
    chrome: { webview: { postMessage: (message: string) => messages.push(message) } } };
  const document = { defaultView: view } as unknown as Document;
  assert.equal(executeShortcutCommand("minimizeWindow", document), false);
  view.__BABEL_DESKTOP_WINDOW_COMMANDS__ = true;
  for (const command of ["minimizeWindow", "toggleMaximizeWindow", "closeWindow"] as const) {
    assert.equal(executeShortcutCommand(command, document), true);
  }
  assert.deepEqual(messages, ["babel:command:minimizeWindow", "babel:command:toggleMaximizeWindow", "babel:command:closeWindow"]);
  view.__BABEL_DESKTOP__ = false;
  assert.equal(executeShortcutCommand("closeWindow", document), false);
  assert.equal(messages.length, 3);
});

test("desktop shortcuts consume unavailable commands and repeats without browser fallback", () => {
  let executions = 0;
  let prevented = 0;
  const event = {
    key: "w",
    ctrlKey: true,
    preventDefault: () => { prevented += 1; },
    stopPropagation: () => undefined,
  };
  const execute = () => { executions += 1; return false; };
  assert.equal(handleShortcutKeyDown(event, "closeTab", "Ctrl+W", false, false, execute), false);
  assert.deepEqual({ executions, prevented }, { executions: 0, prevented: 0 });
  assert.equal(handleShortcutKeyDown(event, "closeTab", "Ctrl+W", false, true, execute), true);
  assert.equal(handleShortcutKeyDown({ ...event, repeat: true }, "closeTab", "Ctrl+W", false, true, execute), true);
  assert.deepEqual({ executions, prevented }, { executions: 1, prevented: 2 });

  assert.equal(handleShortcutKeyDown({ ...event, key: "s" }, "save", "Ctrl+S", false, false, execute), false);
  assert.equal(handleShortcutKeyDown({ ...event, key: "s" }, "save", "Ctrl+S", false, true, execute), true);
  assert.deepEqual({ executions, prevented }, { executions: 3, prevented: 3 });
});

test("desktop shortcuts preserve editable keys and IME input", () => {
  const unexpected = () => { assert.fail("editing must not execute or consume a command"); };
  const base = {
    ctrlKey: true,
    preventDefault: unexpected,
    stopPropagation: unexpected,
  };
  for (const key of ["a", "c", "v", "x", "y", "z", "Delete", "Backspace", "ArrowLeft", "Home"]) {
    assert.equal(handleShortcutKeyDown({ ...base, key }, "save", `Ctrl+${key}`, true, true, unexpected), false);
  }
  for (const extra of [
    { isComposing: true }, { keyCode: 229 }, { defaultPrevented: true },
    { getModifierState: (key: string) => key === "AltGraph" },
  ]) {
    assert.equal(handleShortcutKeyDown({ ...base, key: "w", ...extra }, "closeTab", "Ctrl+W", false, true, unexpected), false);
  }
  assert.equal(handleShortcutKeyDown({ ...base, key: "n" }, "new", "Ctrl+N", true, true, unexpected), false);
});

test("saved settings refresh immediately and stale or disposed requests cannot overwrite them", async () => {
  const target = new EventTarget();
  const requests: Array<{ signal: AbortSignal; resolve: (response: Response) => void }> = [];
  const received: ShortcutSettings[] = [];
  const fetchSettings: typeof fetch = async (_input, init) => new Promise<Response>((resolve) => {
    requests.push({ signal: init!.signal!, resolve });
  });
  const stop = subscribeShortcutSettings("/api/shortcuts", target, (settings) => received.push(settings), fetchSettings);
  assert.equal(requests.length, 1);
  target.dispatchEvent(new Event("babel:shortcuts-changed"));
  assert.equal(requests.length, 2);
  assert.equal(requests[0].signal.aborted, true);
  const custom = {
    ...DEFAULT_SHORTCUT_SETTINGS,
    bindings: { ...DEFAULT_SHORTCUT_SETTINGS.bindings, closeTab: "Ctrl+W" },
  };
  requests[1].resolve(Response.json(custom));
  await new Promise((resolve) => setImmediate(resolve));
  requests[0].resolve(Response.json(DEFAULT_SHORTCUT_SETTINGS));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(received, [custom]);

  target.dispatchEvent(new Event("babel:shortcuts-changed"));
  requests[2].resolve(new Response("unavailable", { status: 503 }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(received, [custom], "a failed refresh must keep the last valid settings");
  target.dispatchEvent(new Event("babel:shortcuts-changed"));
  stop();
  assert.equal(requests[3].signal.aborted, true);
  requests[3].resolve(Response.json(DEFAULT_SHORTCUT_SETTINGS));
  await new Promise((resolve) => setImmediate(resolve));
  target.dispatchEvent(new Event("babel:shortcuts-changed"));
  assert.equal(requests.length, 4);
  assert.deepEqual(received, [custom]);
});

test("editing focus preserves text editing commands", () => {
  for (const command of ["new", "edit", "delete", "underlineSelection", "removeUnderline"] as const) {
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
  assert.match(markup, />APP mode · APP</);
  assert.match(markup, /data-babel-keyboard-status=""/);
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
