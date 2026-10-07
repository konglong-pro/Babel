import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DEFAULT_SHORTCUT_SETTINGS,
  DESKTOP_SHORTCUT_COMMANDS,
  getDefaultShortcutSettings,
  LAUNCHER_SHORTCUT_DEFINITIONS,
  LEGACY_SHORTCUT_COMMANDS,
  isDesktopOnlyShortcutBinding,
  isShortcutBindingAvailable,
  matchesShortcutBinding,
  normalizeShortcutBinding,
  parseShortcutBinding,
  parseShortcutSequence,
  parseShortcutSettings,
  resolveShortcutBindings,
  shortcutBindingsConflict,
  SHORTCUT_COMMANDS,
  SHORTCUT_DEFINITIONS,
  ShortcutValidationError,
  WINDOW_SHORTCUT_COMMANDS,
} from "../src/shortcuts/core";

const legacyBindings = () => Object.fromEntries(LEGACY_SHORTCUT_COMMANDS.map(command =>
  [command, DEFAULT_SHORTCUT_SETTINGS.bindings[command]]));
const additionalBindings = Object.fromEntries(Object.entries(DEFAULT_SHORTCUT_SETTINGS.bindings)
  .filter(([command]) => !LEGACY_SHORTCUT_COMMANDS.includes(command as typeof LEGACY_SHORTCUT_COMMANDS[number])));
const legacyLauncherBindings = () => Object.fromEntries(Object.entries(DEFAULT_SHORTCUT_SETTINGS.layers.launcher)
  .filter(([command]) => !WINDOW_SHORTCUT_COMMANDS.includes(command as typeof WINDOW_SHORTCUT_COMMANDS[number])));

test("shortcut definitions and checked-in defaults stay in lockstep", () => {
  const defaultsDocument = JSON.parse(
    readFileSync(new URL("../shortcuts.defaults.json", import.meta.url), "utf8"),
  ) as unknown;

  assert.deepEqual(defaultsDocument, {
    schemaVersion: 8,
    commands: SHORTCUT_DEFINITIONS,
    launcherCommands: LAUNCHER_SHORTCUT_DEFINITIONS,
    layers: DEFAULT_SHORTCUT_SETTINGS.layers,
  });
  assert.deepEqual(
    SHORTCUT_DEFINITIONS.map(({ command }) => command),
    SHORTCUT_COMMANDS,
  );
  assert.deepEqual(DEFAULT_SHORTCUT_SETTINGS, {
    schemaVersion: 8,
    layers: {
      app: { focusFolders: "G F", focusDocuments: "G L", focusContent: "G C" },
      edit: { saveAndRead: "Ctrl+Enter", focusFolders: null, focusDocuments: null, focusContent: null },
      read: {},
      launcher: {
        previousApp: "ArrowUp", nextApp: "ArrowDown", openApp: "Enter", stopApp: "Delete",
        hideLauncher: "Escape", focusNextPane: "Tab", focusPreviousPane: "Shift+Tab",
        minimizeWindow: "Ctrl+Alt+M", toggleMaximizeWindow: "Ctrl+Alt+F11", closeWindow: "Ctrl+Alt+Q",
      },
    },
    bindings: {
      ...additionalBindings,
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
      closeTab: "Ctrl+W",
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
      bindings: { ...Object.fromEntries(Object.entries(DEFAULT_SHORTCUT_SETTINGS.bindings)
        .map(([command, value]) => [command, value === binding ? null : value])), closeTab: binding },
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
  assert.throws(() => parseShortcutSettings({ ...valid, schemaVersion: 9 }), ShortcutValidationError);
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
    schemaVersion: 8,
    layers: DEFAULT_SHORTCUT_SETTINGS.layers,
    bindings: {
      ...additionalBindings,
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
      closeTab: "Ctrl+W",
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
    schemaVersion: 8,
    layers: DEFAULT_SHORTCUT_SETTINGS.layers,
    bindings: {
      ...additionalBindings,
      ...versionTwo.bindings,
      underlineSelection: "Ctrl+Shift+U",
      removeUnderline: "Ctrl+Alt+U",
      focusNextPane: "Ctrl+F6",
      focusPreviousPane: "Ctrl+Shift+F6",
      nextTab: null,
      previousTab: "Ctrl+Alt+ArrowLeft",
      closeTab: "Ctrl+W",
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
    bindings: Object.fromEntries(Object.entries(legacyBindings()).filter(
      ([command]) => command !== "underlineSelection" && command !== "removeUnderline",
    )),
  };
  const migratedVersionThree = parseShortcutSettings(versionThree);
  assert.equal(migratedVersionThree.schemaVersion, 8);
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
  const bindings = { ...legacyBindings(), save: "Ctrl+Shift+S", help: null };
  const migrated = parseShortcutSettings({ schemaVersion: 4, bindings });
  assert.equal(migrated.schemaVersion, 8);
  assert.deepEqual(migrated.bindings, { ...DEFAULT_SHORTCUT_SETTINGS.bindings, ...bindings });
  assert.deepEqual(migrated.layers, DEFAULT_SHORTCUT_SETTINGS.layers);
  assert.equal(resolveShortcutBindings(migrated, "app").save, bindings.save);
  assert.equal(resolveShortcutBindings(migrated, "edit").saveAndRead, "Ctrl+Enter");
  assert.equal(resolveShortcutBindings(migrated, "read").focusFolders, "G F");
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
  assert.deepEqual(resolveShortcutBindings(settings, "app"), { ...DEFAULT_SHORTCUT_SETTINGS.bindings, ...DEFAULT_SHORTCUT_SETTINGS.layers.app });
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

test("sequences normalize one to four strokes while single-stroke parsing stays strict", () => {
  assert.equal(normalizeShortcutBinding(" ctrl + shift + k   g  alt + u  Enter "), "Ctrl+Shift+K G Alt+U Enter");
  assert.equal(normalizeShortcutBinding("g   g", true), "G G");
  assert.equal(normalizeShortcutBinding("Ctrl+Q Shift+Tab"), "Ctrl+Q Shift+Tab");
  assert.deepEqual(parseShortcutSequence("ctrl+q g"), [
    parseShortcutBinding("Ctrl+Q"),
    parseShortcutBinding("G", true),
  ]);
  assert.equal(matchesShortcutBinding({ key: "q", ctrlKey: true }, "Ctrl+Q G"), false);
  assert.equal(matchesShortcutBinding({ key: "g" }, "Ctrl+Q G"), false);
  assert.equal(matchesShortcutBinding({ key: "g" }, parseShortcutSequence("Ctrl+Q G")[1]), true);
  assert.throws(() => parseShortcutBinding("Ctrl+Q G"), ShortcutValidationError);
  for (const invalid of ["", " ", "G G", "Ctrl+Q G G G G", "Ctrl+Q\tG", "Ctrl+Q\nG", "Ctrl+Q\u00a0G", "Ctrl + + Q G"]) {
    assert.throws(() => parseShortcutSequence(invalid), ShortcutValidationError, invalid);
  }
});

test("every sequence stroke enforces OS reservations and desktop availability", () => {
  for (const unsafe of ["Alt+F4", "Alt+Tab", "Ctrl+Alt+Delete", "Ctrl+Alt+ArrowUp", "F2", "Meta+S"]) {
    assert.throws(() => parseShortcutSequence(`Ctrl+Q ${unsafe}`), ShortcutValidationError, unsafe);
    assert.throws(() => parseShortcutSequence(`${unsafe} G`), ShortcutValidationError, unsafe);
  }
  for (const escape of ["Escape", "Shift+Escape", "Ctrl+Alt+Escape"]) {
    assert.throws(() => parseShortcutSequence(`G ${escape}`, true), ShortcutValidationError, escape);
    assert.throws(() => parseShortcutSequence(`${escape} G`, true), ShortcutValidationError, escape);
  }
  for (const binding of ["Ctrl+W G", "Ctrl+Q Ctrl+W", "G F5", "G G Ctrl+Tab"]) {
    assert.equal(isDesktopOnlyShortcutBinding(binding), true, binding);
    assert.equal(isShortcutBindingAvailable(binding, false), false, binding);
    assert.equal(isShortcutBindingAvailable(binding, true), true, binding);
  }
  assert.equal(isDesktopOnlyShortcutBinding("Ctrl+Q G Enter"), false);
  assert.equal(isShortcutBindingAvailable("G G", false), true);
});

test("conflict matching detects stroke prefixes, not textual prefixes or shared leaders", () => {
  for (const [first, second] of [["ctrl + q", "Ctrl+Q G"], ["G G", "G"], ["Ctrl+Q G", "Ctrl+Q G"], ["G G G G", "g g g"]]) {
    assert.equal(shortcutBindingsConflict(first, second), true, `${first} / ${second}`);
    assert.equal(shortcutBindingsConflict(second, first), true, `${second} / ${first}`);
  }
  for (const [first, second] of [["G G", "G H"], ["Ctrl+Q G", "Ctrl+Q H"], ["F1", "F10 G"], ["G", "Shift+G"]]) {
    assert.equal(shortcutBindingsConflict(first, second), false, `${first} / ${second}`);
  }
});

test("global and launcher settings reject ambiguous prefixes in either declaration order", () => {
  for (const [save, edit] of [["Ctrl+Q", "Ctrl+Q G"], ["Ctrl+Q G", "Ctrl+Q"], ["Ctrl+Q G", "ctrl+q g"]]) {
    assert.throws(() => parseShortcutSettings({
      ...DEFAULT_SHORTCUT_SETTINGS,
      bindings: { ...DEFAULT_SHORTCUT_SETTINGS.bindings, save, edit },
    }), ShortcutValidationError);
  }
  const settings = parseShortcutSettings({
    ...DEFAULT_SHORTCUT_SETTINGS,
    bindings: { ...DEFAULT_SHORTCUT_SETTINGS.bindings, save: "Ctrl+Q S", edit: "Ctrl+Q E" },
    layers: { ...DEFAULT_SHORTCUT_SETTINGS.layers, launcher: { ...DEFAULT_SHORTCUT_SETTINGS.layers.launcher, previousApp: "G G", nextApp: "G J" } },
  });
  assert.equal(settings.bindings.save, "Ctrl+Q S");
  assert.equal(settings.layers.launcher.nextApp, "G J");
  for (const [previousApp, nextApp] of [["G", "G G"], ["G G", "G"]]) {
    assert.throws(() => parseShortcutSettings({
      ...DEFAULT_SHORTCUT_SETTINGS,
      layers: { ...DEFAULT_SHORTCUT_SETTINGS.layers, launcher: { ...DEFAULT_SHORTCUT_SETTINGS.layers.launcher, previousApp, nextApp } },
    }), ShortcutValidationError);
  }
});

test("mode sequences preserve native first strokes but allow Tab and Enter after a leader", () => {
  for (const binding of ["G G", "G Enter", "G Tab", "G Shift+Tab", "G Shift+Enter"]) {
    const settings = parseShortcutSettings({
      ...DEFAULT_SHORTCUT_SETTINGS,
      layers: { ...DEFAULT_SHORTCUT_SETTINGS.layers, read: { underlineSelection: binding } },
    });
    assert.equal(settings.layers.read.underlineSelection, binding);
  }
  for (const binding of ["Enter G", "Shift+Enter G", "Tab G", "Shift+Tab G"]) {
    assert.throws(() => parseShortcutSettings({
      ...DEFAULT_SHORTCUT_SETTINGS,
      layers: { ...DEFAULT_SHORTCUT_SETTINGS.layers, read: { underlineSelection: binding } },
    }), ShortcutValidationError, binding);
  }
  for (const read of [{ new: "G", underlineSelection: "G G" }, { new: "G G", underlineSelection: "G" }]) {
    assert.throws(() => parseShortcutSettings({
      ...DEFAULT_SHORTCUT_SETTINGS,
      layers: { ...DEFAULT_SHORTCUT_SETTINGS.layers, read },
    }), ShortcutValidationError);
  }
});

test("effective mode validation rejects inherited prefixes while exact sequence overrides still shadow", () => {
  for (const mode of ["app", "edit", "read"] as const) {
    assert.throws(() => parseShortcutSettings({
      ...DEFAULT_SHORTCUT_SETTINGS,
      layers: { ...DEFAULT_SHORTCUT_SETTINGS.layers, [mode]: { new: "Ctrl+K G" } },
    }), /effective/);
    assert.throws(() => parseShortcutSettings({
      ...DEFAULT_SHORTCUT_SETTINGS,
      bindings: { ...DEFAULT_SHORTCUT_SETTINGS.bindings, save: "Ctrl+Q S" },
      layers: { ...DEFAULT_SHORTCUT_SETTINGS.layers, [mode]: { new: "Ctrl+Q" } },
    }), /effective/);
  }
  assert.throws(() => parseShortcutSettings({
    ...DEFAULT_SHORTCUT_SETTINGS,
    layers: { ...DEFAULT_SHORTCUT_SETTINGS.layers, app: { new: "G G" }, edit: { save: "G" } },
  }), /effective edit/);
  const settings = parseShortcutSettings({
    ...DEFAULT_SHORTCUT_SETTINGS,
    bindings: { ...DEFAULT_SHORTCUT_SETTINGS.bindings, save: "Ctrl+Q G" },
    layers: {
      ...DEFAULT_SHORTCUT_SETTINGS.layers,
      app: { new: "Ctrl+Q G", read: "G G" },
      edit: { save: "G G", commandPalette: null, edit: "Ctrl+K E" },
      read: { new: null, underlineSelection: "H H" },
    },
  });
  assert.equal(resolveShortcutBindings(settings, "app").save, null);
  assert.equal(resolveShortcutBindings(settings, "app").new, "Ctrl+Q G");
  assert.equal(resolveShortcutBindings(settings, "edit").read, null);
  assert.equal(resolveShortcutBindings(settings, "edit").save, "G G");
  assert.equal(resolveShortcutBindings(settings, "read").save, null);
  assert.equal(resolveShortcutBindings(settings, "read").new, null);
});

test("v5 migration preserves every layer and older schemas do not silently accept sequences", () => {
  const legacy = {
    schemaVersion: 5,
    bindings: { ...legacyBindings(), save: "Ctrl+Shift+S", help: null },
    layers: {
      app: { new: "N" }, edit: { save: "Ctrl+Alt+S" }, read: { underlineSelection: "H", new: null },
      launcher: { ...legacyLauncherBindings(), nextApp: "J" },
    },
  };
  assert.deepEqual(parseShortcutSettings(legacy), {
    ...legacy, schemaVersion: 8,
    bindings: { ...DEFAULT_SHORTCUT_SETTINGS.bindings, ...legacy.bindings },
    layers: { ...legacy.layers,
      launcher: { ...DEFAULT_SHORTCUT_SETTINGS.layers.launcher, ...legacy.layers.launcher },
      app: { ...DEFAULT_SHORTCUT_SETTINGS.layers.app, ...legacy.layers.app },
      edit: { ...DEFAULT_SHORTCUT_SETTINGS.layers.edit, ...legacy.layers.edit },
    },
  });
  assert.throws(() => parseShortcutSettings({ ...legacy, bindings: { ...legacy.bindings, save: "Ctrl+Q S" } }), ShortcutValidationError);
  assert.throws(() => parseShortcutSettings({ ...legacy, layers: { ...legacy.layers, read: { underlineSelection: "G H" } } }), ShortcutValidationError);
  assert.throws(() => parseShortcutSettings({ ...legacy, layers: { ...legacy.layers, launcher: { ...legacy.layers.launcher, nextApp: "G J" } } }), ShortcutValidationError);
  assert.throws(() => parseShortcutSettings({ schemaVersion: 4, bindings: { ...legacy.bindings, save: "Ctrl+Q S" } }), ShortcutValidationError);
});

test("v6 upgrade adds navigation without replacing custom keys, disabled commands or sequence leaders", () => {
  const oldLayers = { app: {}, edit: {}, read: {}, launcher: legacyLauncherBindings() };
  const defaultUpgrade = parseShortcutSettings({ schemaVersion: 6,
    bindings: { ...legacyBindings(), closeTab: "Ctrl+Alt+W" }, layers: oldLayers });
  assert.deepEqual(defaultUpgrade, DEFAULT_SHORTCUT_SETTINGS);
  const migrated = parseShortcutSettings({ schemaVersion: 6,
    bindings: { ...legacyBindings(), save: "Ctrl+1 S", closeTab: null, confirm: "Ctrl+Q" },
    layers: { ...oldLayers,
      app: { new: "G" },
      read: { underlineSelection: "Ctrl+Alt+2", removeUnderline: "Ctrl+Shift+T U" },
      edit: { confirm: "Ctrl+Shift+Enter" },
    },
  });
  assert.equal(migrated.bindings.save, "Ctrl+1 S");
  assert.equal(migrated.bindings.closeTab, null);
  assert.equal(migrated.bindings.selectApp1, null);
  assert.equal(migrated.bindings.selectApp2, "Ctrl+2");
  assert.equal(migrated.bindings.selectTab2, null);
  assert.equal(migrated.bindings.reopenTab, null);
  assert.equal(migrated.bindings.saveAndRead, null);
  assert.deepEqual(migrated.layers.app, { new: "G" });
  assert.deepEqual(migrated.layers.edit, { confirm: "Ctrl+Shift+Enter" });
  assert.equal(migrated.layers.read.removeUnderline, "Ctrl+Shift+T U");
  assert.deepEqual(parseShortcutSettings(migrated), migrated);

  const occupiedClose = parseShortcutSettings({ schemaVersion: 6,
    bindings: { ...legacyBindings(), closeTab: "Ctrl+Alt+W", save: "Ctrl+W S" }, layers: oldLayers });
  assert.equal(occupiedClose.bindings.closeTab, "Ctrl+Alt+W");
  assert.equal(occupiedClose.bindings.save, "Ctrl+W S");
  assert.throws(() => parseShortcutSettings({ schemaVersion: 6,
    bindings: legacyBindings(), layers: { ...oldLayers, app: { selectApp1: "Ctrl+1" } },
  }), /schemaVersion 7/);
});

test("window commands are configurable in every mode and the launcher", () => {
  for (const command of WINDOW_SHORTCUT_COMMANDS) {
    assert.equal(DESKTOP_SHORTCUT_COMMANDS.includes(command), true);
    for (const mode of ["app", "edit", "read"] as const) {
      const settings = parseShortcutSettings({
        ...getDefaultShortcutSettings(),
        layers: { ...getDefaultShortcutSettings().layers, [mode]: { [command]: "Z W" } },
      });
      assert.equal(resolveShortcutBindings(settings, mode)[command], "Z W");
    }
  }
  const settings = parseShortcutSettings({
    ...getDefaultShortcutSettings(),
    bindings: { ...DEFAULT_SHORTCUT_SETTINGS.bindings, minimizeWindow: null, closeWindow: "Ctrl+J Q" },
    layers: { ...DEFAULT_SHORTCUT_SETTINGS.layers, launcher: {
      ...DEFAULT_SHORTCUT_SETTINGS.layers.launcher, minimizeWindow: "W M", closeWindow: null,
    } },
  });
  assert.equal(settings.bindings.minimizeWindow, null);
  assert.equal(settings.bindings.closeWindow, "Ctrl+J Q");
  assert.equal(settings.layers.launcher.closeWindow, null);
  assert.deepEqual(parseShortcutSettings(settings), settings);
});

test("v7 migration preserves every old binding and layer while safely adding window defaults", () => {
  const legacy = {
    schemaVersion: 7,
    bindings: Object.fromEntries(Object.entries(DEFAULT_SHORTCUT_SETTINGS.bindings)
      .filter(([command]) => !WINDOW_SHORTCUT_COMMANDS.includes(command as typeof WINDOW_SHORTCUT_COMMANDS[number]))),
    layers: { app: {}, edit: {}, read: {}, launcher: legacyLauncherBindings() },
  };
  const migrated = parseShortcutSettings({ ...legacy, bindings: { ...legacy.bindings, closeTab: "Ctrl+Alt+W", save: null } });
  assert.equal(migrated.schemaVersion, 8);
  assert.equal(migrated.bindings.closeTab, "Ctrl+Alt+W");
  assert.equal(migrated.bindings.save, null);
  assert.deepEqual(migrated.layers.app, {});
  assert.deepEqual(migrated.layers.edit, {});
  assert.deepEqual(migrated.layers.read, {});
  for (const command of WINDOW_SHORTCUT_COMMANDS) {
    assert.equal(migrated.bindings[command], DEFAULT_SHORTCUT_SETTINGS.bindings[command]);
    assert.equal(migrated.layers.launcher[command], DEFAULT_SHORTCUT_SETTINGS.layers.launcher[command]);
  }
  for (const command of WINDOW_SHORTCUT_COMMANDS) {
    const defaultBinding = DEFAULT_SHORTCUT_SETTINGS.bindings[command]!;
    for (const occupied of [defaultBinding, `${defaultBinding} G`]) {
      const baseConflict = parseShortcutSettings({ ...legacy, bindings: { ...legacy.bindings, help: occupied } });
      assert.equal(baseConflict.bindings.help, occupied);
      assert.equal(baseConflict.bindings[command], null);
      for (const mode of ["app", "edit", "read"] as const) {
        const modeConflict = parseShortcutSettings({ ...legacy, layers: { ...legacy.layers, [mode]: { help: occupied } } });
        assert.equal(modeConflict.layers[mode].help, occupied);
        assert.equal(modeConflict.bindings[command], null);
      }
      const launcherConflict = parseShortcutSettings({ ...legacy, layers: { ...legacy.layers,
        launcher: { ...legacy.layers.launcher, openApp: occupied },
      } });
      assert.equal(launcherConflict.layers.launcher.openApp, occupied);
      assert.equal(launcherConflict.layers.launcher[command], null);
      assert.deepEqual(parseShortcutSettings(launcherConflict), launcherConflict);
    }
  }
  assert.throws(() => parseShortcutSettings({ ...legacy, bindings: { ...legacy.bindings, closeWindow: "Ctrl+Alt+Q" } }), ShortcutValidationError);
  assert.throws(() => parseShortcutSettings({ ...legacy, layers: { ...legacy.layers, read: { closeWindow: "Q" } } }), /schemaVersion 8/);
  assert.throws(() => parseShortcutSettings({ ...legacy, layers: { ...legacy.layers,
    launcher: { ...legacy.layers.launcher, closeWindow: "Ctrl+Alt+Q" },
  } }), ShortcutValidationError);
});
