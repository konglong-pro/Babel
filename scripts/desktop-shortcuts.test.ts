import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { parseShortcutSettings } from "../packages/platform/src/shortcuts/core";

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
      assert.equal(settings.schemaVersion, 4);
      assert.equal(settings.bindings.closeTab, desktopBindings[index]);
      assert.equal(settings.bindings.save, "Ctrl+S");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
