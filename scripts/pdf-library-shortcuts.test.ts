import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  getDefaultShortcutSettings, LEGACY_SHORTCUT_COMMANDS, parseShortcutSettings,
  type ShortcutSettings, WINDOW_SHORTCUT_COMMANDS,
} from "../packages/platform/src/shortcuts/core";

const root = path.resolve(import.meta.dirname, "..");
const execFileAsync = promisify(execFile);
const windowCommand = (command: string) => WINDOW_SHORTCUT_COMMANDS.includes(command as typeof WINDOW_SHORTCUT_COMMANDS[number]);

function legacySettings(version: number) {
  const defaults = getDefaultShortcutSettings();
  const legacyCommands = version === 1
    ? ["save", "new", "edit", "confirm", "cancel", "search", "delete", "commandPalette"]
    : version === 2 ? ["save", "new", "edit", "read", "confirm", "cancel", "search", "delete", "commandPalette"]
      : version === 3 ? LEGACY_SHORTCUT_COMMANDS.filter(command => !["underlineSelection", "removeUnderline"].includes(command))
        : version < 7 ? LEGACY_SHORTCUT_COMMANDS
          : Object.keys(defaults.bindings).filter(command => command !== "pdfLibrary" && (version >= 8 || !windowCommand(command)));
  return {
    schemaVersion: version,
    bindings: Object.fromEntries(legacyCommands.map(command => [command,
      command === "closeTab" && version < 7 ? "Ctrl+Alt+W" : defaults.bindings[command as keyof typeof defaults.bindings]])),
    ...(version >= 5 ? { layers: {
      app: {}, edit: {}, read: {},
      launcher: Object.fromEntries(Object.entries(defaults.layers.launcher).filter(([command]) => version >= 8 || !windowCommand(command))),
    } } : {}),
  };
}

test("native v1–v8 upgrades preserve Ctrl+P owners and match the web v9 migration without changing source files", {
  skip: process.platform !== "win32", timeout: 60_000,
}, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "babel-pdf-shortcuts-"));
  const fixtures: unknown[] = [];
  for (let version = 1; version <= 8; version++) {
    const legacy = legacySettings(version);
    fixtures.push(legacy, { ...legacy, bindings: { ...legacy.bindings, save: "Ctrl+P" } });
    if (version >= 6) fixtures.push({ ...legacy, bindings: { ...legacy.bindings, save: "Ctrl+P G" } });
  }
  for (const binding of ["Ctrl+P", "Ctrl+P G"]) {
    for (const mode of ["app", "edit", "read"] as const) {
      const legacy = legacySettings(8);
      fixtures.push({ ...legacy, layers: { ...legacy.layers, [mode]: { help: binding } } });
    }
  }
  const defaults = getDefaultShortcutSettings();
  fixtures.push(
    { ...defaults, bindings: { ...defaults.bindings, pdfLibrary: null, closeWindow: null } },
    { ...defaults, bindings: { ...defaults.bindings, pdfLibrary: "Ctrl+Q P" }, layers: { ...defaults.layers, read: { pdfLibrary: null } } },
  );
  try {
    for (const [index, fixture] of fixtures.entries()) await writeFile(path.join(directory, `${index}.json`), JSON.stringify(fixture));
    const { stdout } = await execFileAsync("pwsh.exe", ["-NoProfile", "-NonInteractive", "-Command", String.raw`
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
. (Join-Path $env:BABEL_TEST_ROOT 'launcher/Babel.Shortcuts.ps1')
$definitions = @(Get-BabelShortcutDefinitions -Path (Join-Path $env:BABEL_TEST_ROOT 'packages/platform/shortcuts.defaults.json'))
$pdf = @($definitions | Where-Object { $_.Id -ceq 'pdfLibrary' })
if ($pdf.Count -ne 1 -or $pdf[0].Label -cne 'Open PDF Library' -or $pdf[0].DefaultBinding -cne 'Ctrl+P') { throw 'PDF definition mismatch.' }
if (@(Get-BabelLauncherShortcutDefinitions | Where-Object { $_.Id -ceq 'pdfLibrary' }).Count -ne 0) { throw 'PDF Library must not become a native launcher command.' }
if (Test-BabelDesktopOnlyShortcutBinding -Binding 'Ctrl+P') { throw 'PDF Library must work in a regular browser.' }
$results = @(Get-ChildItem -LiteralPath $env:BABEL_TEST_DIRECTORY -Filter '*.json' | Sort-Object { [int]$_.BaseName } | ForEach-Object {
    $source = Get-Content -LiteralPath $_.FullName -Raw
    $settings = Read-BabelShortcutSettings -Definitions $definitions -Path $_.FullName -WarningAction SilentlyContinue
    if ($settings.Source -ne 'User') { throw $settings.Warning }
    if ((Get-Content -LiteralPath $_.FullName -Raw) -cne $source) { throw 'Reading rewrote user settings.' }
    [void](Write-BabelShortcutSettings -Definitions $definitions -Bindings $settings.Bindings -Layers $settings.Layers -Path $_.FullName)
    $saved = Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json
    if ($saved.schemaVersion -ne 9) { throw 'The native editor did not save schema version 9.' }
    $roundTrip = Read-BabelShortcutSettings -Definitions $definitions -Path $_.FullName -WarningAction SilentlyContinue
    if ($roundTrip.Source -ne 'User') { throw $roundTrip.Warning }
    $saved
})
ConvertTo-Json -InputObject $results -Depth 12 -Compress
`], {
      cwd: root, env: { ...process.env, BABEL_TEST_ROOT: root, BABEL_TEST_DIRECTORY: directory },
      windowsHide: true, timeout: 55_000,
    });
    const results = JSON.parse(stdout) as ShortcutSettings[];
    assert.equal(results.length, fixtures.length);
    for (const [index, fixture] of fixtures.entries()) assert.deepEqual(results[index], parseShortcutSettings(fixture), `fixture ${index}`);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
