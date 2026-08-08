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
    schemaVersion: 3,
    commands: SHORTCUT_DEFINITIONS,
  });
  assert.deepEqual(
    SHORTCUT_DEFINITIONS.map(({ command }) => command),
    SHORTCUT_COMMANDS,
  );
  assert.deepEqual(DEFAULT_SHORTCUT_SETTINGS, {
    schemaVersion: 3,
    bindings: {
      save: "Ctrl+S",
      new: "Ctrl+Alt+N",
      edit: "Ctrl+Alt+E",
      read: "Ctrl+R",
      confirm: "Ctrl+Enter",
      cancel: "Escape",
      search: "Ctrl+F",
      delete: "Ctrl+Delete",
      commandPalette: "Ctrl+K",
      focusNextPane: "Ctrl+F6",
      focusPreviousPane: "Ctrl+Shift+F6",
      nextTab: "Ctrl+Alt+ArrowRight",
      previousTab: "Ctrl+Alt+ArrowLeft",
      closeTab: "Ctrl+Alt+W",
      quickOpen: "Ctrl+Alt+P",
      help: "Ctrl+Alt+H",
    },
  });
});

test("shortcut bindings normalize supported keys and modifier order", () => {
  assert.equal(normalizeShortcutBinding(" shift + ctrl + a "), "Ctrl+Shift+A");
  assert.equal(normalizeShortcutBinding("alt+ctrl+f12"), "Ctrl+Alt+F12");
  assert.equal(normalizeShortcutBinding("control+return"), "Ctrl+Enter");
  assert.equal(normalizeShortcutBinding("alt+back"), "Alt+Backspace");
  assert.equal(normalizeShortcutBinding("alt+f5"), "Alt+F5");
  assert.equal(normalizeShortcutBinding("ctrl+r"), "Ctrl+R");
  assert.equal(normalizeShortcutBinding("ctrl+alt+right"), "Ctrl+Alt+ArrowRight");
  assert.equal(normalizeShortcutBinding("ctrl+pageup"), "Ctrl+PageUp");
  assert.equal(normalizeShortcutBinding("F1"), "F1");
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
    "F2",
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
    "Ctrl+Shift+T",
    "F5",
    "Ctrl+F5",
    "F6",
    "Shift+F6",
    "F11",
    "F12",
    "Ctrl+Alt+Delete",
    "Ctrl+Alt+ArrowUp",
    "Ctrl+Alt+ArrowDown",
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

test("shortcut settings require exact current keys and accept unbound v3 commands", () => {
  const valid = {
    schemaVersion: 3,
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
  assert.deepEqual(
    parseShortcutSettings({
      ...valid,
      bindings: { ...valid.bindings, quickOpen: null, help: null },
    }).bindings,
    { ...valid.bindings, quickOpen: null, help: null },
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
  assert.throws(
    () =>
      parseShortcutSettings({
        ...valid,
        bindings: { ...valid.bindings, save: "Escape", cancel: "Ctrl+Alt+C" },
      }),
    ShortcutValidationError,
  );
  assert.throws(() => parseShortcutSettings({ ...valid, schemaVersion: 4 }), ShortcutValidationError);
});

test("v1 and v2 migrations preserve old bindings and leave conflicting new commands unbound", () => {

  const legacy = {
    schemaVersion: 1,
    bindings: {
      save: "Ctrl+Alt+S",
      new: "Ctrl+Alt+N",
      edit: "Ctrl+Alt+E",
      confirm: "Ctrl+Enter",
      cancel: "Escape",
      search: "Ctrl+F",
      delete: "Ctrl+Delete",
      commandPalette: "Ctrl+K",
    },
  };
  assert.deepEqual(parseShortcutSettings(legacy), {
    schemaVersion: 3,
    bindings: {
      save: "Ctrl+Alt+S",
      new: "Ctrl+Alt+N",
      edit: "Ctrl+Alt+E",
      read: "Ctrl+R",
      confirm: "Ctrl+Enter",
      cancel: "Escape",
      search: "Ctrl+F",
      delete: "Ctrl+Delete",
      commandPalette: "Ctrl+K",
      focusNextPane: "Ctrl+F6",
      focusPreviousPane: "Ctrl+Shift+F6",
      nextTab: "Ctrl+Alt+ArrowRight",
      previousTab: "Ctrl+Alt+ArrowLeft",
      closeTab: "Ctrl+Alt+W",
      quickOpen: "Ctrl+Alt+P",
      help: "Ctrl+Alt+H",
    },
  });

  const versionTwo = {
    schemaVersion: 2,
    bindings: {
      save: "Ctrl+Alt+S",
      new: "Ctrl+Alt+N",
      edit: "Ctrl+Alt+E",
      read: "Ctrl+R",
      confirm: "Ctrl+Enter",
      cancel: "Escape",
      search: "Ctrl+Alt+ArrowRight",
      delete: "Ctrl+Delete",
      commandPalette: "Ctrl+Alt+P",
    },
  };
  assert.deepEqual(parseShortcutSettings(versionTwo), {
    schemaVersion: 3,
    bindings: {
      ...versionTwo.bindings,
      focusNextPane: "Ctrl+F6",
      focusPreviousPane: "Ctrl+Shift+F6",
      nextTab: null,
      previousTab: "Ctrl+Alt+ArrowLeft",
      closeTab: "Ctrl+Alt+W",
      quickOpen: null,
      help: "Ctrl+Alt+H",
    },
  });

  const versionOneConflict = {
    ...legacy,
    bindings: { ...legacy.bindings, save: "Ctrl+R" },
  };
  assert.equal(parseShortcutSettings(versionOneConflict).bindings.save, "Ctrl+R");
  assert.equal(parseShortcutSettings(versionOneConflict).bindings.read, null);

  const legacyEscapeOwner = {
    ...legacy,
    bindings: { ...legacy.bindings, save: "Escape", cancel: "Ctrl+Alt+C" },
  };
  const migratedEscapeOwner = parseShortcutSettings(legacyEscapeOwner);
  assert.equal(migratedEscapeOwner.bindings.save, null);
  assert.equal(migratedEscapeOwner.bindings.cancel, "Ctrl+Alt+C");
  assert.equal(migratedEscapeOwner.bindings.focusNextPane, "Ctrl+F6");

  const legacyFixedReorderOwner = {
    ...legacy,
    bindings: { ...legacy.bindings, save: "Alt+Ctrl+Up" },
  };
  const migratedLegacyFixedReorderOwner = parseShortcutSettings(legacyFixedReorderOwner);
  assert.equal(migratedLegacyFixedReorderOwner.bindings.save, null);
  assert.equal(migratedLegacyFixedReorderOwner.bindings.new, "Ctrl+Alt+N");
  assert.equal(migratedLegacyFixedReorderOwner.bindings.cancel, "Escape");

  const versionTwoFixedReorderOwner = {
    ...versionTwo,
    bindings: { ...versionTwo.bindings, read: "Control+Alt+Down" },
  };
  const migratedVersionTwoFixedReorderOwner = parseShortcutSettings(
    versionTwoFixedReorderOwner,
  );
  assert.equal(migratedVersionTwoFixedReorderOwner.bindings.read, null);
  assert.equal(migratedVersionTwoFixedReorderOwner.bindings.save, "Ctrl+Alt+S");
  assert.equal(migratedVersionTwoFixedReorderOwner.bindings.cancel, "Escape");

  assert.throws(
    () =>
      parseShortcutSettings({
        ...legacy,
        bindings: { ...legacy.bindings, read: "Ctrl+R" },
      }),
    ShortcutValidationError,
  );
  assert.throws(
    () =>
      parseShortcutSettings({
        ...versionTwo,
        bindings: { ...versionTwo.bindings, quickOpen: "Ctrl+Alt+P" },
      }),
    ShortcutValidationError,
  );
  assert.throws(
    () =>
      parseShortcutSettings({
        ...versionTwo,
        bindings: { ...versionTwo.bindings, read: null },
      }),
    ShortcutValidationError,
  );
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
  assert.equal(matchesShortcutBinding({ ...baseEvent, key: "r" }, "Ctrl+R"), true);
  assert.equal(matchesShortcutBinding({ key: "Esc" }, "Escape"), true);
  assert.equal(matchesShortcutBinding(baseEvent, null), false);

  for (const ignoredState of [
    { defaultPrevented: true },
    { repeat: true },
    { isComposing: true },
    { keyCode: 229 },
    { getModifierState: (key: string) => key === "AltGraph" },
    { metaKey: true },
  ]) {
    assert.equal(matchesShortcutBinding({ ...baseEvent, ...ignoredState }, "Ctrl+S"), false);
  }
});
