import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
      schemaVersion: 2,
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
      schemaVersion: 2,
      bindings: {
        ...legacy.bindings,
        read: "Ctrl+R",
      },
    });
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
