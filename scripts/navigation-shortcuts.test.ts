import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  getDefaultShortcutSettings, LEGACY_SHORTCUT_COMMANDS, parseShortcutSettings,
  type ShortcutCommand, type ShortcutSettings,
} from "../packages/platform/src/shortcuts/core";

const root = path.resolve(import.meta.dirname, "..");
const execFileAsync = promisify(execFile);
const initialize = `
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
. (Join-Path $env:BABEL_TEST_ROOT 'launcher/Babel.Shortcuts.ps1')
$definitions = @(Get-BabelShortcutDefinitions -Path (Join-Path $env:BABEL_TEST_ROOT 'packages/platform/shortcuts.defaults.json'))
function Import-GuiFunctions([string[]]$Names) {
  $tokens = $null; $errors = $null
  $ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $env:BABEL_TEST_ROOT 'launcher/Babel.Gui.ps1'), [ref]$tokens, [ref]$errors)
  if ($errors.Count -gt 0) { throw ($errors | Out-String) }
  foreach ($name in $Names) {
    $definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
    if ($null -eq $definition) { throw "Missing GUI function $name" }
    Invoke-Expression ($definition.Extent.Text -replace ('^function ' + [regex]::Escape($name)), ('function script:' + $name))
  }
}
`;

function runPowerShell(script: string, directory?: string) {
  return execFileAsync("pwsh.exe", ["-NoProfile", "-NonInteractive", "-STA", "-Command", initialize + script], {
    cwd: root, env: { ...process.env, BABEL_TEST_ROOT: root, BABEL_TEST_DIRECTORY: directory },
    windowsHide: true, timeout: 30_000,
  });
}

function legacySettings(version: number) {
  const defaults = getDefaultShortcutSettings();
  const commands: readonly ShortcutCommand[] = version === 1
    ? ["save", "new", "edit", "confirm", "cancel", "search", "delete", "commandPalette"]
    : version === 2 ? ["save", "new", "edit", "read", "confirm", "cancel", "search", "delete", "commandPalette"]
      : version === 3 ? LEGACY_SHORTCUT_COMMANDS.filter(id => !["underlineSelection", "removeUnderline"].includes(id))
        : LEGACY_SHORTCUT_COMMANDS;
  return {
    schemaVersion: version,
    bindings: Object.fromEntries(commands.map(id => [id, id === "closeTab" ? "Ctrl+Alt+W" : defaults.bindings[id]])),
    ...(version >= 5 ? { layers: { app: {}, edit: {}, read: {}, launcher: defaults.layers.launcher } } : {}),
  };
}

test("native schema 7 migration matches web defaults and preserves occupied keys across legacy versions", { skip: process.platform !== "win32" }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "babel-navigation-settings-"));
  try {
    const fixtures = Array.from({ length: 6 }, (_, index) => legacySettings(index + 1));
    const occupiedGlobal = legacySettings(6);
    occupiedGlobal.bindings.help = "Ctrl+1 X";
    occupiedGlobal.bindings.new = "Ctrl+W";
    occupiedGlobal.bindings.confirm = null;
    fixtures.push(occupiedGlobal);
    const occupiedMode = legacySettings(6);
    occupiedMode.bindings.help = null;
    occupiedMode.layers!.read = { help: "Ctrl+Alt+2 X", read: "Ctrl+Shift+T", new: "G" };
    occupiedMode.layers!.edit = { confirm: null };
    fixtures.push(occupiedMode);
    for (const version of [1, 2]) {
      const occupiedLegacy = legacySettings(version);
      occupiedLegacy.bindings.new = "Ctrl+W";
      fixtures.push(occupiedLegacy);
    }
    for (let index = 0; index < fixtures.length; index++) {
      await writeFile(path.join(directory, `${index}.json`), JSON.stringify(fixtures[index]));
    }
    const { stdout } = await runPowerShell(`
$results = @(Get-ChildItem -LiteralPath $env:BABEL_TEST_DIRECTORY -Filter '*.json' | Sort-Object { [int]$_.BaseName } | ForEach-Object {
  $settings = Read-BabelShortcutSettings -Definitions $definitions -Path $_.FullName -WarningAction SilentlyContinue
  @{ source = $settings.Source; warning = $settings.Warning; settings = @{ schemaVersion = 7; bindings = $settings.Bindings; layers = $settings.Layers } }
})
ConvertTo-Json -InputObject $results -Depth 10 -Compress
`, directory);
    const results = JSON.parse(stdout) as { source: string; warning: string | null; settings: ShortcutSettings }[];
    assert.equal(results.length, fixtures.length);
    for (let index = 0; index < fixtures.length; index++) {
      assert.equal(results[index].source, "User", results[index].warning ?? `fixture ${index}`);
      assert.deepEqual(results[index].settings, parseShortcutSettings(fixtures[index]), `fixture ${index}`);
      assert.deepEqual(JSON.parse(await readFile(path.join(directory, `${index}.json`), "utf8")), fixtures[index], "Reading must not rewrite user settings");
    }
    assert.equal(results[6].settings.bindings.selectApp1, null);
    assert.equal(results[6].settings.bindings.closeTab, "Ctrl+Alt+W");
    assert.equal(results[7].settings.bindings.selectTab2, null);
    assert.equal(results[7].settings.layers.app.focusFolders, undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("native shell merges customized APP keys with home bindings and routes chrome, input, and web focus correctly", { skip: process.platform !== "win32" }, async () => {
  const { stdout } = await runPowerShell(`
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase
Import-GuiFunctions @('Get-BabelNativeShellShortcutBindings', 'Update-BabelHomeShortcutHint', 'Reset-BabelHomeShortcutSequence', 'Invoke-BabelHomeShortcutKeyEvent')
$script:DesktopShortcutBindings = [ordered]@{ selectApp1 = 'Ctrl+1'; selectApp2 = 'Ctrl+J A'; nextAppTab = 'Ctrl+Tab'; previousAppTab = $null; save = 'Ctrl+S'; appHome = 'Alt+Home' }
$script:LauncherShortcutBindings = [ordered]@{ openApp = 'Enter'; hideLauncher = 'Escape'; focusNextPane = 'Tab'; nextApp = 'Ctrl+J' }
$homeBindings = Get-BabelNativeShellShortcutBindings -HomeVisible $true
if ($homeBindings.Contains('selectApp2') -or $homeBindings.Contains('save') -or $homeBindings.Contains('previousAppTab') -or $homeBindings.selectApp1 -ne 'Ctrl+1') { throw 'Home shell merge ignored priority or scope.' }
$chromeBindings = Get-BabelNativeShellShortcutBindings -HomeVisible $false
if ($chromeBindings.Contains('openApp') -or $chromeBindings.selectApp2 -ne 'Ctrl+J A') { throw 'Native chrome did not use customized shell keys.' }
$script:LauncherShortcutBindings.nextApp = 'ArrowDown'
$script:DesktopHost = [pscustomobject]@{ IsHomeVisible = $true; IsWebContentFocused = $false }
$script:DesktopHost | Add-Member -MemberType ScriptMethod -Name RefreshStatus -Value { $controls.DesktopStatusText.Text = 'APP ready' }
$script:HomeShortcutSequence = New-BabelShortcutSequenceState
$script:HomeShortcutSequenceTimer = [Windows.Threading.DispatcherTimer]::new()
$controls = @{ DesktopStatusText = [Windows.Controls.TextBlock]::new() }
$script:Invoked = [Collections.Generic.List[string]]::new()
$script:Typing = $false
function Test-BabelEditableTextInputFocused { return $script:Typing }
function ConvertFrom-WpfShortcutKeyEvent($EventArgs, [switch]$AllowBareKeys) { return $EventArgs.Binding }
function Invoke-BabelHomeShortcut([string]$Command) { $script:Invoked.Add($Command) }
function Show-BabelError([string]$Message) { throw $Message }
function Get-BabelNumberSelectionIndex($Key) { return -1 }
function Send-Key([string]$Binding, [switch]$Repeat) {
  $event = [pscustomobject]@{ Binding = $Binding; Key = [Windows.Input.Key]::A; SystemKey = [Windows.Input.Key]::A; IsRepeat = [bool]$Repeat; Handled = $false; KeyboardDevice = @{ Modifiers = [Windows.Input.ModifierKeys]::Control } }
  Invoke-BabelHomeShortcutKeyEvent -EventArgs $event
  return $event
}
if (-not (Send-Key 'Ctrl+1').Handled -or $script:Invoked[0] -ne 'selectApp1') { throw 'APP position did not dispatch from home.' }
$script:DesktopHost.IsHomeVisible = $false
if (-not (Send-Key 'Ctrl+Tab').Handled -or $script:Invoked[1] -ne 'nextAppTab') { throw 'APP cycling did not dispatch from chrome.' }
$script:Typing = $true
[void](Send-Key 'Ctrl+J'); [void](Send-Key A)
if ($script:Invoked[2] -ne 'selectApp2') { throw 'Modified APP sequence failed inside a native text field.' }
[void](Send-Key 'Ctrl+J')
if ((Send-Key 'Ctrl+C').Handled -or $script:HomeShortcutSequence.Pending) { throw 'Native copy did not cancel a shell sequence.' }
[void](Send-Key 'Ctrl+J'); $script:DesktopHost.IsWebContentFocused = $true
if ((Send-Key A).Handled -or $script:HomeShortcutSequence.Pending -or $script:Invoked.Count -ne 3) { throw 'Shell stole focused web content keys.' }
$script:DesktopHost.IsWebContentFocused = $false
[void](Send-Key 'Ctrl+1' -Repeat)
if ($script:Invoked.Count -ne 3) { throw 'Repeat ran APP navigation.' }
'Native navigation routing passed'
`);
  assert.match(stdout, /Native navigation routing passed/);
});
