import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DEFAULT_SHORTCUT_SETTINGS } from "../src/shortcuts/core";
import {
  loadShortcutSettings,
  resolveShortcutSettingsPath,
  shortcutSettingsResponse,
} from "../src/shortcuts/server";

test("shortcut path uses an override before the local application data directory", () => {
  assert.equal(
    resolveShortcutSettingsPath({
      BABEL_SHORTCUTS_PATH: "D:\\settings\\shortcuts.json",
      LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local",
    }),
    "D:\\settings\\shortcuts.json",
  );
  assert.equal(
    resolveShortcutSettingsPath({ LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local" }),
    join("C:\\Users\\test\\AppData\\Local", "Babel", "shortcuts.json"),
  );
});

test("shortcut loader rereads valid settings and falls back for missing or invalid files", () => {
  const directory = mkdtempSync(join(tmpdir(), "babel-shortcuts-"));
  const settingsPath = join(directory, "shortcuts.json");
  try {
    assert.deepEqual(loadShortcutSettings({ path: settingsPath }), DEFAULT_SHORTCUT_SETTINGS);

    writeFileSync(settingsPath, "not json", "utf8");
    assert.deepEqual(loadShortcutSettings({ path: settingsPath }), DEFAULT_SHORTCUT_SETTINGS);

    const changed = {
      ...DEFAULT_SHORTCUT_SETTINGS,
      bindings: { ...DEFAULT_SHORTCUT_SETTINGS.bindings, save: "Ctrl+Alt+S" },
    };
    writeFileSync(settingsPath, JSON.stringify(changed), "utf8");
    assert.deepEqual(loadShortcutSettings({ path: settingsPath }), changed);

    const changedAgain = {
      ...changed,
      bindings: { ...changed.bindings, save: "Ctrl+Shift+S" },
    };
    writeFileSync(settingsPath, JSON.stringify(changedAgain), "utf8");
    assert.deepEqual(loadShortcutSettings({ path: settingsPath }), changedAgain);

    const versionFour = JSON.stringify({ schemaVersion: 4, bindings: changedAgain.bindings });
    writeFileSync(settingsPath, versionFour, "utf8");
    assert.deepEqual(loadShortcutSettings({ path: settingsPath }), changedAgain);
    assert.equal(readFileSync(settingsPath, "utf8"), versionFour);

    const layered = {
      ...changedAgain,
      layers: { ...changedAgain.layers, read: { underlineSelection: "H", new: null } },
    };
    writeFileSync(settingsPath, JSON.stringify(layered), "utf8");
    assert.deepEqual(loadShortcutSettings({ path: settingsPath }), layered);

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
    writeFileSync(settingsPath, JSON.stringify(legacy), "utf8");
    assert.deepEqual(loadShortcutSettings({ path: settingsPath }), {
      schemaVersion: 6,
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

    const versionTwoWithConflict = {
      schemaVersion: 2,
      bindings: {
        save: "Ctrl+Alt+S",
        new: "Ctrl+Alt+N",
        edit: "Ctrl+Alt+E",
        read: "Ctrl+R",
        confirm: "Ctrl+Enter",
        cancel: "Escape",
        search: "Ctrl+F",
        delete: "Ctrl+Delete",
        commandPalette: "Ctrl+Alt+P",
      },
    };
    writeFileSync(settingsPath, JSON.stringify(versionTwoWithConflict), "utf8");
    assert.equal(loadShortcutSettings({ path: settingsPath }).bindings.commandPalette, "Ctrl+Alt+P");
    assert.equal(loadShortcutSettings({ path: settingsPath }).bindings.quickOpen, null);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("shortcut response disables caching", async () => {
  const response = shortcutSettingsResponse(DEFAULT_SHORTCUT_SETTINGS);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.deepEqual(await response.json(), DEFAULT_SHORTCUT_SETTINGS);
});

test("shortcut loader migrates v5 layers in memory and serves validated v6 sequences", async () => {
  const directory = mkdtempSync(join(tmpdir(), "babel-shortcut-sequences-"));
  const settingsPath = join(directory, "shortcuts.json");
  try {
    const legacy = {
      ...DEFAULT_SHORTCUT_SETTINGS,
      schemaVersion: 5,
      layers: { ...DEFAULT_SHORTCUT_SETTINGS.layers, read: { underlineSelection: "H", new: null } },
    };
    const source = JSON.stringify(legacy);
    writeFileSync(settingsPath, source, "utf8");
    assert.deepEqual(loadShortcutSettings({ path: settingsPath }), { ...legacy, schemaVersion: 6 });
    assert.equal(readFileSync(settingsPath, "utf8"), source);

    const sequences = {
      ...DEFAULT_SHORTCUT_SETTINGS,
      bindings: { ...DEFAULT_SHORTCUT_SETTINGS.bindings, save: "Ctrl+Q S" },
      layers: {
        ...DEFAULT_SHORTCUT_SETTINGS.layers,
        read: { underlineSelection: "G H", removeUnderline: "G U" },
        launcher: { ...DEFAULT_SHORTCUT_SETTINGS.layers.launcher, nextApp: "G J" },
      },
    };
    writeFileSync(settingsPath, JSON.stringify(sequences), "utf8");
    const loaded = loadShortcutSettings({ path: settingsPath });
    assert.deepEqual(loaded, sequences);
    assert.deepEqual(await shortcutSettingsResponse(loaded).json(), sequences);

    writeFileSync(settingsPath, JSON.stringify({
      ...sequences,
      layers: { ...sequences.layers, read: { underlineSelection: "Ctrl+Q" } },
    }), "utf8");
    assert.deepEqual(loadShortcutSettings({ path: settingsPath }), DEFAULT_SHORTCUT_SETTINGS);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
