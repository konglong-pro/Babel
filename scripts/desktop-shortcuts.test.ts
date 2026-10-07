import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { getDefaultShortcutSettings, parseShortcutSettings, WINDOW_SHORTCUT_COMMANDS } from "../packages/platform/src/shortcuts/core";

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const desktopBindings = [
  "Ctrl+W", "Ctrl+Shift+W", "Ctrl+T", "Ctrl+Shift+T", "Ctrl+L",
  "Ctrl+N", "Ctrl+Shift+N", "Ctrl+Tab", "Ctrl+Shift+Tab",
  "F5", "Ctrl+F5", "F6", "F11", "F12",
];

test("desktop bindings round-trip through PowerShell and TypeScript without becoming global hotkeys", {
  skip: process.platform !== "win32",
}, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "babel-desktop-shortcuts-"));
  try {
    const { stdout } = await execFileAsync("pwsh.exe", ["-NoProfile", "-NonInteractive", "-Command", `
$ErrorActionPreference = "Stop"
. (Join-Path $env:BABEL_TEST_ROOT "launcher/Babel.Shortcuts.ps1")
$definitions = @(Get-BabelShortcutDefinitions -Path (Join-Path $env:BABEL_TEST_ROOT "packages/platform/shortcuts.defaults.json"))
$bindings = Get-BabelDefaultShortcutBindings -Definitions $definitions
$path = Join-Path $env:BABEL_TEST_DIRECTORY "shortcuts.json"
$results = @()
foreach ($binding in ($env:BABEL_TEST_DESKTOP_BINDINGS | ConvertFrom-Json)) {
    $bindings = Get-BabelDefaultShortcutBindings -Definitions $definitions
    foreach ($key in @($bindings.Keys)) { if ($bindings[$key] -eq $binding) { $bindings[$key] = $null } }
    $bindings["closeTab"] = $binding
    [void](Write-BabelShortcutSettings -Definitions $definitions -Bindings $bindings -Path $path)
    $loaded = Read-BabelShortcutSettings -Definitions $definitions -Path $path
    if ($loaded.Source -ne "User" -or $loaded.Bindings["closeTab"] -ne $binding -or $loaded.Bindings["save"] -ne "Ctrl+S") {
        throw "Desktop binding $binding did not survive the settings round-trip."
    }
    if (-not (Test-BabelDesktopOnlyShortcutBinding -Binding $binding)) { throw "Desktop classification is missing for $binding." }
    $rejected = $false
    try { [void](ConvertTo-BabelLauncherHotkeyRegistration -Binding $binding) } catch { $rejected = $true }
    if (-not $rejected) { throw "Desktop binding $binding was incorrectly accepted as a global hotkey." }
    $results += (Get-Content -LiteralPath $path -Raw | ConvertFrom-Json)
}
foreach ($binding in @("Alt+F4", "Alt+Tab", "Alt+Shift+Tab", "Ctrl+Alt+Tab", "Ctrl+Alt+Shift+Tab", "Ctrl+Alt+Delete", "F2", "Ctrl+Alt+ArrowUp", "Ctrl+Alt+ArrowDown")) {
    $rejected = $false
    try { [void](ConvertTo-BabelShortcutBinding -Binding $binding) } catch { $rejected = $true }
    if (-not $rejected) { throw "Reserved binding $binding was accepted." }
}
$results | ConvertTo-Json -Depth 5 -Compress
`], {
      cwd: root,
      env: {
        ...process.env,
        BABEL_TEST_ROOT: root,
        BABEL_TEST_DIRECTORY: directory,
        BABEL_TEST_DESKTOP_BINDINGS: JSON.stringify(desktopBindings),
      },
    });
    const documents = JSON.parse(stdout) as unknown[];
    assert.equal(documents.length, desktopBindings.length);
    for (const [index, document] of documents.entries()) {
      const settings = parseShortcutSettings(document);
      assert.equal(settings.schemaVersion, 8);
      assert.equal(settings.bindings.closeTab, desktopBindings[index]);
      assert.equal(settings.bindings.save, "Ctrl+S");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("native window settings migrate v7 without claiming custom keys and preserve v8 disables", {
  skip: process.platform !== "win32",
}, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "babel-window-settings-"));
  const defaults = getDefaultShortcutSettings();
  const isWindowCommand = (command: string) => WINDOW_SHORTCUT_COMMANDS.includes(command as typeof WINDOW_SHORTCUT_COMMANDS[number]);
  const legacy = {
    schemaVersion: 7,
    bindings: Object.fromEntries(Object.entries(defaults.bindings).filter(([command]) => !isWindowCommand(command))),
    layers: { app: {}, edit: {}, read: {}, launcher: Object.fromEntries(Object.entries(defaults.layers.launcher).filter(([command]) => !isWindowCommand(command))) },
  };
  const fixtures: unknown[] = [
    legacy,
    { ...legacy, bindings: { ...legacy.bindings, closeTab: "Ctrl+Alt+W", save: null } },
    { ...defaults, bindings: { ...defaults.bindings, minimizeWindow: null, closeWindow: "Ctrl+J Q" },
      layers: { ...defaults.layers, read: { toggleMaximizeWindow: "W W" },
        launcher: { ...defaults.layers.launcher, closeWindow: null, minimizeWindow: "W M" } } },
  ];
  for (const command of WINDOW_SHORTCUT_COMMANDS) {
    const binding = defaults.bindings[command]!;
    for (const occupied of [binding, `${binding} G`]) {
      fixtures.push({ ...legacy, bindings: { ...legacy.bindings, help: occupied } });
      for (const mode of ["app", "edit", "read"]) {
        fixtures.push({ ...legacy, layers: { ...legacy.layers, [mode]: { help: occupied } } });
      }
      fixtures.push({ ...legacy, layers: { ...legacy.layers, launcher: { ...legacy.layers.launcher, openApp: occupied } } });
    }
  }
  try {
    for (const [index, fixture] of fixtures.entries()) {
      await writeFile(path.join(directory, `${index}.json`), JSON.stringify(fixture));
    }
    const { stdout } = await execFileAsync("pwsh.exe", ["-NoProfile", "-NonInteractive", "-Command", `
$ErrorActionPreference = 'Stop'
. (Join-Path $env:BABEL_TEST_ROOT 'launcher/Babel.Shortcuts.ps1')
$definitions = @(Get-BabelShortcutDefinitions -Path (Join-Path $env:BABEL_TEST_ROOT 'packages/platform/shortcuts.defaults.json'))
$results = @(Get-ChildItem -LiteralPath $env:BABEL_TEST_DIRECTORY -Filter '*.json' | Sort-Object { [int]$_.BaseName } | ForEach-Object {
  $source = Get-Content -LiteralPath $_.FullName -Raw
  $settings = Read-BabelShortcutSettings -Definitions $definitions -Path $_.FullName -WarningAction SilentlyContinue
  if ($settings.Source -ne 'User') { throw $settings.Warning }
  if ((Get-Content -LiteralPath $_.FullName -Raw) -cne $source) { throw 'Reading changed source settings.' }
  [void](Write-BabelShortcutSettings -Definitions $definitions -Bindings $settings.Bindings -Layers $settings.Layers -Path $_.FullName)
  $roundTrip = Read-BabelShortcutSettings -Definitions $definitions -Path $_.FullName -WarningAction SilentlyContinue
  if ($roundTrip.Source -ne 'User') { throw $roundTrip.Warning }
  Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json
})
ConvertTo-Json -InputObject $results -Depth 10 -Compress
`], {
      cwd: root,
      env: { ...process.env, BABEL_TEST_ROOT: root, BABEL_TEST_DIRECTORY: directory },
      windowsHide: true,
      timeout: 60_000,
    });
    const documents = JSON.parse(stdout) as unknown[];
    assert.equal(documents.length, fixtures.length);
    for (const [index, document] of documents.entries()) {
      assert.deepEqual(document, parseShortcutSettings(fixtures[index]), `fixture ${index}`);
      assert.deepEqual(parseShortcutSettings(document), document, `round-trip ${index}`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
