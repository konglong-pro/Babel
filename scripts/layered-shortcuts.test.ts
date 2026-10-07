import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { parseShortcutSettings, resolveShortcutBindings } from "../packages/platform/src/shortcuts/core";

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const initialization = `
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
. (Join-Path $env:BABEL_TEST_ROOT 'launcher/Babel.Shortcuts.ps1')
$definitions = @(Get-BabelShortcutDefinitions -Path (Join-Path $env:BABEL_TEST_ROOT 'packages/platform/shortcuts.defaults.json'))
$launcherDefinitions = @(Get-BabelLauncherShortcutDefinitions)
$bindings = Get-BabelDefaultShortcutBindings -Definitions $definitions
$layers = Get-BabelDefaultShortcutLayers -LauncherDefinitions $launcherDefinitions
function Assert-Rejected([scriptblock]$Action) {
    $rejected = $false
    try { & $Action | Out-Null } catch { $rejected = $true }
    if (-not $rejected) { throw 'An invalid shortcut setting was accepted.' }
}
`;

async function runPowerShell(script: string, directory?: string) {
  return execFileAsync("pwsh.exe", ["-NoProfile", "-NonInteractive", "-STA", "-Command", initialization + script], {
    cwd: root,
    env: { ...process.env, BABEL_TEST_ROOT: root, BABEL_TEST_DIRECTORY: directory },
  });
}

test("layered settings preserve legacy assignments and round-trip with matching PS/TS resolution", {
  skip: process.platform !== "win32",
}, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "babel-layered-shortcuts-"));
  try {
    const { stdout } = await runPowerShell(`
$path = Join-Path $env:BABEL_TEST_DIRECTORY 'shortcuts.json'
$bindings.cancel = 'Ctrl+Q'
$bindings.help = $null
$legacyBindings = [ordered]@{}
foreach ($definition in @($definitions | Select-Object -First 18)) { $legacyBindings[$definition.Id] = $bindings[$definition.Id] }
@{ schemaVersion = 4; bindings = $legacyBindings } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $path
$migrated = Read-BabelShortcutSettings -Definitions $definitions -Path $path
if ($migrated.Source -ne 'User' -or $migrated.Bindings.cancel -ne 'Ctrl+Q' -or $null -ne $migrated.Bindings.help -or
    $migrated.Layers.app.focusFolders -ne 'G F' -or $migrated.Layers.read.Count -ne 0 -or $migrated.Layers.edit.saveAndRead -ne 'Ctrl+Enter' -or
    $migrated.Layers.launcher.focusPreviousPane -ne 'Shift+Tab') { throw 'Schema 4 migration lost a binding or layer default.' }
$layers.app = [ordered]@{ read = 'Ctrl+S' }
$layers.read = [ordered]@{ read = $null; underlineSelection = 'u'; removeUnderline = 'Shift+U'; closeTab = 'Ctrl+W' }
$layers.edit = [ordered]@{ read = 'R' }
$layers.launcher.openApp = '1'
$layers.launcher.stopApp = $null
[void](Write-BabelShortcutSettings -Definitions $definitions -Bindings $migrated.Bindings -Layers $layers -Path $path)
$loaded = Read-BabelShortcutSettings -Definitions $definitions -Path $path
if ($loaded.Source -ne 'User' -or $loaded.Layers.read.Contains('save') -or $null -ne $loaded.Layers.read.read) {
    throw 'Missing inheritance and explicit null did not survive saving.'
}
$effective = Get-BabelEffectiveShortcutBindings -Bindings $loaded.Bindings -Layers $loaded.Layers -Scope read
if ($null -ne $effective.save -or $null -ne $effective.read -or $effective.underlineSelection -ne 'U') {
    throw 'Read layer incorrectly restored a command shadowed in APP.'
}
if ((Get-BabelLauncherShortcutCommand -Bindings $loaded.Layers.launcher -Binding '1') -ne 'openApp') {
    throw 'Configured numbered command was not found.'
}
foreach ($scope in @('app', 'edit', 'read')) {
    foreach ($invalid in @('Enter', 'Shift+Enter', 'Tab', 'Shift+Tab', 'Escape', 'F2', 'Alt+Tab', 'Ctrl+Alt+ArrowUp')) {
        Assert-Rejected { ConvertTo-BabelShortcutBindingMap -Definitions $definitions -Bindings @{ save = $invalid } -Scope $scope -Partial }
    }
    Assert-Rejected { ConvertTo-BabelShortcutBindingMap -Definitions $definitions -Bindings @{ save = 'u'; read = 'U' } -Scope $scope -Partial }
    Assert-Rejected { ConvertTo-BabelShortcutBindingMap -Definitions $definitions -Bindings @{ unexpected = 'U' } -Scope $scope -Partial }
}
Assert-Rejected { ConvertTo-BabelShortcutBinding -Binding 'U' }
Assert-Rejected { ConvertTo-BabelShortcutBindingMap -Definitions $launcherDefinitions -Bindings @{ openApp = 'Enter' } -Scope launcher }
$invalidLauncher = Get-BabelDefaultShortcutBindings -Definitions $launcherDefinitions
$invalidLauncher.hideLauncher = $null
$invalidLauncher.openApp = 'Escape'
Assert-Rejected { ConvertTo-BabelShortcutBindingMap -Definitions $launcherDefinitions -Bindings $invalidLauncher -Scope launcher }
foreach ($scope in @('app', 'edit', 'read', 'launcher')) {
    $conflictingLayers = Get-BabelDefaultShortcutLayers -LauncherDefinitions $launcherDefinitions
    $command = if ($scope -eq 'launcher') { 'openApp' } else { 'save' }
    $conflictingLayers[$scope][$command] = 'Ctrl+Alt+B'
    Assert-Rejected { Assert-BabelShortcutHotkeyConflict -Bindings $bindings -Layers $conflictingLayers -LauncherBinding 'Ctrl+Alt+B' }
}
@{
    settings = (Get-Content -LiteralPath $path -Raw | ConvertFrom-Json)
    resolved = @{
        app = (Get-BabelEffectiveShortcutBindings -Bindings $loaded.Bindings -Layers $loaded.Layers -Scope app)
        edit = (Get-BabelEffectiveShortcutBindings -Bindings $loaded.Bindings -Layers $loaded.Layers -Scope edit)
        read = $effective
    }
} | ConvertTo-Json -Depth 8 -Compress
`, directory);
    const result = JSON.parse(stdout) as {
      settings: unknown;
      resolved: Record<"app" | "edit" | "read", unknown>;
    };
    const settings = parseShortcutSettings(result.settings);
    assert.equal(settings.schemaVersion, 8);
    assert.equal(settings.bindings.cancel, "Ctrl+Q");
    assert.equal(settings.bindings.help, null);
    assert.equal(settings.layers.launcher.openApp, "1");
    assert.equal(settings.layers.launcher.stopApp, null);
    assert.equal(settings.layers.read.underlineSelection, "U");
    for (const mode of ["app", "edit", "read"] as const) {
      assert.deepEqual(result.resolved[mode], resolveShortcutBindings(settings, mode));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("WPF shortcut rows expose effective inheritance and edit only the chosen layer", {
  skip: process.platform !== "win32",
}, async () => {
  const { stdout } = await runPowerShell(`
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase, System.Data
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $env:BABEL_TEST_ROOT 'launcher/Babel.Gui.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count -gt 0) { throw ($errors | Out-String) }
foreach ($name in @('Update-BabelShortcutDialogRows', 'Set-BabelShortcutDialogLayer', 'Set-BabelShortcutDialogBinding')) {
    $function = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
    Invoke-Expression $function.Extent.Text
}
[xml]$xaml = Get-Content -LiteralPath (Join-Path $env:BABEL_TEST_ROOT 'launcher/Babel.Shortcuts.xaml') -Raw
$reader = [Xml.XmlNodeReader]::new($xaml)
try { $window = [Windows.Markup.XamlReader]::Load($reader) } finally { $reader.Close() }
$table = [Data.DataTable]::new()
foreach ($column in @('Id', 'Label', 'Shortcut', 'BindingState')) { [void]$table.Columns.Add($column, [string]) }
$controls = @{}
foreach ($name in @('ShortcutGrid', 'RestoreInheritanceButton', 'ShortcutLayerHint')) { $controls[$name] = $window.FindName($name) }
$controls.ShortcutGrid.ItemsSource = $table.DefaultView
$state = [pscustomobject]@{
    Controls = $controls; Table = $table; Definitions = $definitions; LauncherDefinitions = $launcherDefinitions
    DefaultBindings = $bindings; DefaultLauncherBindings = $layers.launcher
    Bindings = $bindings; Layers = $layers; CurrentLayer = 'app'; SelectedCommand = ''; LauncherBinding = 'Ctrl+Alt+B'
}
function Get-Row([string]$Id) { return $table.Rows | Where-Object { $_.Id -eq $Id } }
Set-BabelShortcutDialogBinding -State $state -CommandId read -Binding 'Ctrl+S'
if ($state.Bindings.save -ne 'Ctrl+S' -or (Get-Row save).BindingState -ne 'Key claimed in APP') { throw 'APP override corrupted Global or lost its source.' }
$state.CurrentLayer = 'read'
Set-BabelShortcutDialogBinding -State $state -CommandId read -Binding $null
if ((Get-Row save).Shortcut -ne '' -or (Get-Row save).BindingState -ne 'Key claimed in APP' -or (Get-Row read).BindingState -ne 'Disabled') {
    throw 'Read did not retain APP shadowing and local disable state.'
}
Set-BabelShortcutDialogBinding -State $state -CommandId underlineSelection -Binding U
if ((Get-Row underlineSelection).Shortcut -ne 'U' -or (Get-Row underlineSelection).BindingState -ne 'Override') { throw 'Bare read key override failed.' }
Set-BabelShortcutDialogBinding -State $state -CommandId underlineSelection -Binding $null
if ((Get-Row underlineSelection).BindingState -ne 'Disabled') { throw 'Disable did not write null.' }
Set-BabelShortcutDialogBinding -State $state -CommandId underlineSelection -Inherit
if ($state.Layers.read.Contains('underlineSelection') -or (Get-Row underlineSelection).BindingState -ne 'Inherited: Global') { throw 'Restore inheritance failed.' }
Set-BabelShortcutDialogLayer -State $state -Bindings ([ordered]@{})
if ($state.Layers.read.Count -ne 0 -or $state.Layers.app.read -ne 'Ctrl+S' -or (Get-Row read).BindingState -ne 'Inherited: APP') { throw 'Restore layer defaults modified APP.' }
Assert-Rejected { Set-BabelShortcutDialogBinding -State $state -CommandId save -Binding 'Ctrl+Alt+B' }
if ($state.Layers.read.Count -ne 0) { throw 'Rejected toggle conflict leaked into draft settings.' }
$state.CurrentLayer = 'launcher'
Update-BabelShortcutDialogRows -State $state
if ($table.Rows.Count -ne $launcherDefinitions.Count -or $controls.RestoreInheritanceButton.IsEnabled) { throw 'Apps home layer has incorrect commands or inheritance.' }
Set-BabelShortcutDialogBinding -State $state -CommandId openApp -Binding '1'
if ($state.Layers.launcher.openApp -ne '1' -or $state.DefaultLauncherBindings.openApp -ne 'Enter') { throw 'Apps home editing corrupted its defaults.' }
Set-BabelShortcutDialogLayer -State $state -Bindings $state.DefaultLauncherBindings
if ((Get-Row openApp).BindingState -ne 'Default' -or (Get-Row openApp).Shortcut -ne 'Enter') { throw 'Apps home default restore failed.' }
$window.Close()
'WPF layered shortcut editor behavior passed'
`);
  assert.match(stdout, /WPF layered shortcut editor behavior passed/);
});
