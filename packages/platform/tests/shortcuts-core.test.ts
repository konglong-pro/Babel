import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DEFAULT_SHORTCUT_SETTINGS,
  matchesShortcutBinding,
  normalizeShortcutBinding,
  parseShortcutBinding,
  parseShortcutSettings,
  SHORTCUT_COMMANDS,
  SHORTCUT_DEFINITIONS,
  ShortcutValidationError,
} from "../src/shortcuts/core";

test("shortcut definitions and checked-in defaults stay in lockstep", () => {
  const defaultsDocument = JSON.parse(
    readFileSync(new URL("../shortcuts.defaults.json", import.meta.url), "utf8"),
  ) as unknown;

  assert.deepEqual(defaultsDocument, {
    schemaVersion: 1,
    commands: SHORTCUT_DEFINITIONS,
  });
  assert.deepEqual(
    SHORTCUT_DEFINITIONS.map(({ command }) => command),
    SHORTCUT_COMMANDS,
  );
  assert.deepEqual(DEFAULT_SHORTCUT_SETTINGS, {
    schemaVersion: 1,
    bindings: {
      save: "Ctrl+S",
      new: "Ctrl+Alt+N",
      edit: "Ctrl+Alt+E",
      confirm: "Ctrl+Enter",
      cancel: "Escape",
      search: "Ctrl+F",
      delete: "Ctrl+Delete",
      commandPalette: "Ctrl+K",
    },
  });
});

test("shortcut bindings normalize supported keys and modifier order", () => {
  assert.equal(normalizeShortcutBinding(" shift + ctrl + a "), "Ctrl+Shift+A");
  assert.equal(normalizeShortcutBinding("alt+ctrl+f12"), "Ctrl+Alt+F12");
  assert.equal(normalizeShortcutBinding("control+return"), "Ctrl+Enter");
  assert.equal(normalizeShortcutBinding("alt+back"), "Alt+Backspace");
  assert.equal(normalizeShortcutBinding("alt+f5"), "Alt+F5");
  assert.equal(normalizeShortcutBinding("esc"), "Escape");
  assert.deepEqual(parseShortcutBinding("Ctrl+Alt+enter"), {
    binding: "Ctrl+Alt+Enter",
    key: "Enter",
    ctrlKey: true,
    altKey: true,
    shiftKey: false,
  });
});

test("shortcut bindings reject unsafe, uncapturable, and accidental bare keys", () => {
  for (const binding of [
    "A",
    "Enter",
    "Delete",
    "Backspace",
    "F1",
    "Shift+A",
    "Shift+Escape",
    "Alt+F4",
    "Alt+Escape",
    "Alt+Space",
    "Ctrl+Escape",
    "Ctrl+W",
    "Ctrl+Shift+W",
    "Ctrl+T",
    "Ctrl+L",
    "Ctrl+R",
    "Ctrl+Shift+T",
    "F5",
    "Ctrl+F5",
    "F11",
    "F12",
    "Ctrl+Alt+Delete",
    "Ctrl+Shift+Escape",
    "Meta+S",
    "Ctrl+Ctrl+S",
  ]) {
    assert.throws(
      () => parseShortcutBinding(binding),
      ShortcutValidationError,
      `${binding} should be rejected`,
    );
  }
});

test("shortcut settings require the exact schema and command keys", () => {
  const valid = {
    schemaVersion: 1,
    bindings: { ...DEFAULT_SHORTCUT_SETTINGS.bindings },
  };
  assert.deepEqual(parseShortcutSettings(valid), valid);
  assert.equal(
    parseShortcutSettings({
      ...valid,
      bindings: { ...valid.bindings, save: "alt+shift+s" },
    }).bindings.save,
    "Alt+Shift+S",
  );

  assert.throws(() => parseShortcutSettings({ ...valid, extra: true }), ShortcutValidationError);
  assert.throws(
    () =>
      parseShortcutSettings({
        ...valid,
        bindings: Object.fromEntries(
          Object.entries(valid.bindings).filter(([command]) => command !== "edit"),
        ),
      }),
    ShortcutValidationError,
  );
  assert.throws(
    () =>
      parseShortcutSettings({
        ...valid,
        bindings: { ...valid.bindings, edit: valid.bindings.save },
      }),
    ShortcutValidationError,
  );
  assert.throws(() => parseShortcutSettings({ ...valid, schemaVersion: 2 }), ShortcutValidationError);
});

test("keyboard matching is exact and ignores unsafe event states", () => {
  const baseEvent = {
    key: "s",
    ctrlKey: true,
    altKey: false,
    shiftKey: false,
    metaKey: false,
  };
  assert.equal(matchesShortcutBinding(baseEvent, "Ctrl+S"), true);
  assert.equal(matchesShortcutBinding({ ...baseEvent, shiftKey: true }, "Ctrl+S"), false);
  assert.equal(matchesShortcutBinding({ ...baseEvent, ctrlKey: false }, "Ctrl+S"), false);
  assert.equal(matchesShortcutBinding({ key: "Esc" }, "Escape"), true);

  for (const ignoredState of [
    { defaultPrevented: true },
    { repeat: true },
    { isComposing: true },
    { keyCode: 229 },
    { metaKey: true },
  ]) {
    assert.equal(matchesShortcutBinding({ ...baseEvent, ...ignoredState }, "Ctrl+S"), false);
  }
});
