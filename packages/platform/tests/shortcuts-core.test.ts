import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DEFAULT_SHORTCUT_SETTINGS,
  getDefaultShortcutSettings,
  LAUNCHER_SHORTCUT_DEFINITIONS,
  isDesktopOnlyShortcutBinding,
  isShortcutBindingAvailable,
  matchesShortcutBinding,
  normalizeShortcutBinding,
  parseShortcutBinding,
  parseShortcutSettings,
  resolveShortcutBindings,
  SHORTCUT_COMMANDS,
  SHORTCUT_DEFINITIONS,
  ShortcutValidationError,
} from "../src/shortcuts/core";

test("shortcut definitions and checked-in defaults stay in lockstep", () => {
  const defaultsDocument = JSON.parse(
    readFileSync(new URL("../shortcuts.defaults.json", import.meta.url), "utf8"),
  ) as unknown;

  assert.deepEqual(defaultsDocument, {
    schemaVersion: 5,
    commands: SHORTCUT_DEFINITIONS,
    launcherCommands: LAUNCHER_SHORTCUT_DEFINITIONS,
    layers: DEFAULT_SHORTCUT_SETTINGS.layers,
  });
  assert.deepEqual(
    SHORTCUT_DEFINITIONS.map(({ command }) => command),
    SHORTCUT_COMMANDS,
  );
  assert.deepEqual(DEFAULT_SHORTCUT_SETTINGS, {
    schemaVersion: 5,
    layers: {
      app: {},
      edit: {},
      read: {},
      launcher: {
        previousApp: "ArrowUp", nextApp: "ArrowDown", openApp: "Enter", stopApp: "Delete",
        hideLauncher: "Escape", focusNextPane: "Tab", focusPreviousPane: "Shift+Tab",
      },
    },
    bindings: {
      save: "Ctrl+S",
      new: "Ctrl+Alt+N",
      edit: "Ctrl+Alt+E",
      read: "Ctrl+R",
      confirm: "Ctrl+Enter",
      cancel: "Escape",
      search: "Ctrl+F",
      delete: "Ctrl+Delete",
      underlineSelection: "Ctrl+Shift+U",
      removeUnderline: "Ctrl+Alt+U",
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

test("browser-reserved bindings retain their values and require the desktop host", () => {
  for (const binding of [
    "Ctrl+W", "Ctrl+Shift+W", "Ctrl+T", "Ctrl+Shift+T", "Ctrl+L",
    "Ctrl+N", "Ctrl+Shift+N", "Ctrl+Tab", "Ctrl+Shift+Tab",
    "F5", "Ctrl+F5", "F6", "F11", "F12",
  ]) {
    assert.equal(normalizeShortcutBinding(binding.toLowerCase()), binding);
    assert.equal(isDesktopOnlyShortcutBinding(binding), true);
    assert.equal(isShortcutBindingAvailable(binding, false), false);
    assert.equal(isShortcutBindingAvailable(binding, true), true);
    const settings = parseShortcutSettings({
      ...DEFAULT_SHORTCUT_SETTINGS,
      bindings: { ...DEFAULT_SHORTCUT_SETTINGS.bindings, closeTab: binding },
    });
    assert.equal(settings.bindings.closeTab, binding);
    assert.equal(settings.bindings.save, "Ctrl+S");
  }
  assert.equal(isDesktopOnlyShortcutBinding("Ctrl+S"), false);
  assert.equal(isShortcutBindingAvailable("Ctrl+S", false), true);
  assert.equal(isShortcutBindingAvailable(null, true), false);
});

test("shortcut bindings reject OS, fixed navigation, and accidental bare keys", () => {
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
    "Shift+F6",
    "Tab",
    "Shift+Tab",
    "Alt+Tab",
    "Alt+Shift+Tab",
    "Ctrl+Alt+Tab",
    "Ctrl+Alt+Shift+Tab",
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

test("shortcut settings require exact current keys and accept unbound commands", () => {
  const valid = {
    ...getDefaultShortcutSettings(),
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
  assert.throws(() => parseShortcutSettings({ ...valid, schemaVersion: 6 }), ShortcutValidationError);
});

test("v1, v2, and v3 migrations preserve old bindings and leave conflicting new commands unbound", () => {

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
    schemaVersion: 5,
    layers: DEFAULT_SHORTCUT_SETTINGS.layers,
    bindings: {
      save: "Ctrl+Alt+S",
      new: "Ctrl+Alt+N",
      edit: "Ctrl+Alt+E",
      read: "Ctrl+R",
      confirm: "Ctrl+Enter",
      cancel: "Escape",
      search: "Ctrl+F",
      delete: "Ctrl+Delete",
      underlineSelection: "Ctrl+Shift+U",
      removeUnderline: "Ctrl+Alt+U",
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
    schemaVersion: 5,
    layers: DEFAULT_SHORTCUT_SETTINGS.layers,
    bindings: {
      ...versionTwo.bindings,
      underlineSelection: "Ctrl+Shift+U",
      removeUnderline: "Ctrl+Alt+U",
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

  const versionThree = {
    schemaVersion: 3,
    bindings: Object.fromEntries(Object.entries(DEFAULT_SHORTCUT_SETTINGS.bindings).filter(
      ([command]) => command !== "underlineSelection" && command !== "removeUnderline",
    )),
  };
  const migratedVersionThree = parseShortcutSettings(versionThree);
  assert.equal(migratedVersionThree.schemaVersion, 5);
  assert.equal(migratedVersionThree.bindings.underlineSelection, "Ctrl+Shift+U");
  assert.equal(migratedVersionThree.bindings.removeUnderline, "Ctrl+Alt+U");
  const versionThreeConflict = {
    ...versionThree,
    bindings: { ...versionThree.bindings, save: "Ctrl+Shift+U", help: null },
  };
  const migratedConflict = parseShortcutSettings(versionThreeConflict);
  assert.equal(migratedConflict.bindings.save, "Ctrl+Shift+U");
  assert.equal(migratedConflict.bindings.help, null);
  assert.equal(migratedConflict.bindings.underlineSelection, null);
  assert.equal(migratedConflict.bindings.removeUnderline, "Ctrl+Alt+U");

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

test("v4 migration preserves every binding and starts new layers with inheritance", () => {
  const bindings = { ...DEFAULT_SHORTCUT_SETTINGS.bindings, save: "Ctrl+Shift+S", help: null };
  const migrated = parseShortcutSettings({ schemaVersion: 4, bindings });
  assert.equal(migrated.schemaVersion, 5);
  assert.deepEqual(migrated.bindings, bindings);
  assert.deepEqual(migrated.layers, DEFAULT_SHORTCUT_SETTINGS.layers);
  assert.deepEqual(resolveShortcutBindings(migrated, "app"), bindings);
  assert.deepEqual(resolveShortcutBindings(migrated, "edit"), bindings);
  assert.deepEqual(resolveShortcutBindings(migrated, "read"), bindings);
});

test("mode layers inherit, disable, and shadow lower commands without changing source settings", () => {
  const settings = parseShortcutSettings({
    ...DEFAULT_SHORTCUT_SETTINGS,
    layers: {
      ...DEFAULT_SHORTCUT_SETTINGS.layers,
      app: { new: "N", read: "Ctrl+S", edit: "E", help: null },
      edit: { save: "N", edit: undefined },
      read: { underlineSelection: "N", read: null },
    },
  });
  const app = resolveShortcutBindings(settings, "app");
  assert.equal(app.new, "N");
  assert.equal(app.save, null);
  assert.equal(app.read, "Ctrl+S");
  assert.equal(app.help, null);
  const edit = resolveShortcutBindings(settings, "edit");
  assert.equal(edit.new, null);
  assert.equal(edit.save, "N");
  assert.equal(edit.edit, "E");
  const read = resolveShortcutBindings(settings, "read");
  assert.equal(read.underlineSelection, "N");
  assert.equal(read.new, null);
  assert.equal(read.read, null);
  assert.equal(read.save, null);
  assert.equal(settings.bindings.save, "Ctrl+S");
  assert.equal(settings.layers.app.new, "N");
  assert.deepEqual(settings.layers.edit, { save: "N" });

  const swap = parseShortcutSettings({
    ...DEFAULT_SHORTCUT_SETTINGS,
    layers: { ...DEFAULT_SHORTCUT_SETTINGS.layers, app: { save: "Ctrl+F", search: "Ctrl+S" } },
  });
  assert.equal(resolveShortcutBindings(swap, "app").save, "Ctrl+F");
  assert.equal(resolveShortcutBindings(swap, "app").search, "Ctrl+S");
});

test("mode layer validation allows contextual bare keys while retaining native focus and OS reservations", () => {
  for (const binding of ["h", "Shift+h", "3", "Shift+3", "Delete", "ArrowDown"]) {
    assert.equal(parseShortcutBinding(binding, true).binding, normalizeShortcutBinding(binding, true));
    const settings = parseShortcutSettings({
      ...DEFAULT_SHORTCUT_SETTINGS,
      layers: { ...DEFAULT_SHORTCUT_SETTINGS.layers, read: { underlineSelection: binding } },
    });
    assert.equal(settings.layers.read.underlineSelection, normalizeShortcutBinding(binding, true));
  }
  for (const binding of ["Tab", "Shift+Tab", "Enter", "Shift+Enter", "Escape", "F2", "Alt+Tab", "Ctrl+Alt+Delete"]) {
    assert.throws(() => parseShortcutSettings({
      ...DEFAULT_SHORTCUT_SETTINGS,
      layers: { ...DEFAULT_SHORTCUT_SETTINGS.layers, read: { underlineSelection: binding } },
    }), ShortcutValidationError, binding);
  }
  for (const read of [{ new: "N", underlineSelection: "n" }, { unknown: "N" }, { help: 3 }]) {
    assert.throws(() => parseShortcutSettings({
      ...DEFAULT_SHORTCUT_SETTINGS,
      layers: { ...DEFAULT_SHORTCUT_SETTINGS.layers, read },
    }), ShortcutValidationError);
  }
  for (const layers of [{}, { ...DEFAULT_SHORTCUT_SETTINGS.layers, extra: {} }, { ...DEFAULT_SHORTCUT_SETTINGS.layers, read: null }]) {
    assert.throws(() => parseShortcutSettings({ ...DEFAULT_SHORTCUT_SETTINGS, layers }), ShortcutValidationError);
  }
});

test("launcher bindings are independent and validate all commands with unique assignments", () => {
  const launcher = { ...DEFAULT_SHORTCUT_SETTINGS.layers.launcher, previousApp: "K", nextApp: "J", stopApp: null };
  const settings = parseShortcutSettings({
    ...DEFAULT_SHORTCUT_SETTINGS,
    layers: { ...DEFAULT_SHORTCUT_SETTINGS.layers, launcher },
  });
  assert.deepEqual(settings.layers.launcher, launcher);
  assert.deepEqual(resolveShortcutBindings(settings, "app"), DEFAULT_SHORTCUT_SETTINGS.bindings);
  for (const invalid of [
    { ...launcher, previousApp: "J" },
    { ...launcher, previousApp: "Escape", hideLauncher: "Ctrl+Q" },
    { ...launcher, openApp: "Alt+F4" },
    { ...launcher, openApp: undefined },
    { ...launcher, extra: "A" },
    {},
  ]) {
    assert.throws(() => parseShortcutSettings({
      ...DEFAULT_SHORTCUT_SETTINGS,
      layers: { ...DEFAULT_SHORTCUT_SETTINGS.layers, launcher: invalid },
    }), ShortcutValidationError);
  }
});

test("keyboard matching supports mode keys and shifted number keys", () => {
  assert.equal(matchesShortcutBinding({ key: "h" }, "H"), true);
  assert.equal(matchesShortcutBinding({ key: "H", shiftKey: true }, "Shift+H"), true);
  assert.equal(matchesShortcutBinding({ key: "H", shiftKey: true }, "H"), false);
  assert.equal(matchesShortcutBinding({ key: "#", code: "Digit3", shiftKey: true }, "Shift+3"), true);
  assert.equal(matchesShortcutBinding({ key: "#", code: "Digit3", shiftKey: true }, "3"), false);
  assert.equal(isShortcutBindingAvailable("H", false), true);
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
