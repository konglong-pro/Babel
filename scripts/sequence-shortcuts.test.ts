import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { normalizeShortcutBinding, parseShortcutSettings, resolveShortcutBindings } from "../packages/platform/src/shortcuts/core";

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

async function runPowerShell(script: string, directory?: string) {
  return execFileAsync("pwsh.exe", ["-NoProfile", "-NonInteractive", "-STA", "-Command", initialization + script], {
    cwd: root,
    env: { ...process.env, BABEL_TEST_ROOT: root, BABEL_TEST_DIRECTORY: directory },
    windowsHide: true,
    timeout: 30_000,
  });
}

test("sequence parsers agree on canonical steps, safety, and the single global toggle", { skip: process.platform !== "win32" }, async () => {
  const { stdout } = await runPowerShell(`
$valid = @('ctrl + j  u', 'g g', 'Shift+G G', 'Ctrl+J U R 1', 'Ctrl+J Tab', 'F3 F4')
$results = @($valid | ForEach-Object { @{ raw = $_; canonical = (ConvertTo-BabelShortcutBinding -Binding $_ -AllowBareKeys) } })
foreach ($invalid in @('G G G G G', 'Ctrl+J Escape', 'Escape G', 'Ctrl+J Ctrl+Escape', 'Ctrl+J F2', 'Ctrl+J Alt+Tab', "G\tG", "G\nG")) {
    Assert-Rejected { ConvertTo-BabelShortcutBinding -Binding $invalid -AllowBareKeys }
}
Assert-Rejected { ConvertTo-BabelShortcutBinding -Binding 'G G' }
Assert-Rejected { ConvertTo-BabelLauncherHotkeyRegistration -Binding 'Ctrl+J U' }
foreach ($scope in @('app', 'edit', 'read')) {
    Assert-Rejected { ConvertTo-BabelShortcutBindingMap -Definitions $definitions -Bindings @{ save = 'Tab G' } -Scope $scope -Partial }
    Assert-Rejected { ConvertTo-BabelShortcutBindingMap -Definitions $definitions -Bindings @{ save = 'G'; read = 'G G' } -Scope $scope -Partial }
}
if (-not (Test-BabelDesktopOnlyShortcutBinding -Binding 'Ctrl+J Ctrl+W')) { throw 'A desktop-only tail was not detected.' }
$layers.read.underlineSelection = 'G Ctrl+Alt+B'
Assert-Rejected { Assert-BabelShortcutHotkeyConflict -Bindings $bindings -Layers $layers -LauncherBinding 'Ctrl+Alt+B' }
ConvertTo-Json -InputObject $results -Compress
`);
  for (const { raw, canonical } of JSON.parse(stdout) as Array<{ raw: string; canonical: string }>) {
    assert.equal(canonical, normalizeShortcutBinding(raw, true));
  }
  for (const invalid of ["G G G G G", "Ctrl+J Escape", "Escape G", "Ctrl+J Ctrl+Escape", "Ctrl+J F2", "Ctrl+J Alt+Tab", "G\tG", "G\nG"]) {
    assert.throws(() => normalizeShortcutBinding(invalid, true));
  }
});

test("schema 6 sequences round-trip across all layers and reject effective prefix conflicts", { skip: process.platform !== "win32" }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "babel-sequence-settings-"));
  try {
    const { stdout } = await runPowerShell(`
$path = Join-Path $env:BABEL_TEST_DIRECTORY 'shortcuts.json'
$bindings.help = $null
$bindings.save = " Ctrl\t+ S "
$layers.read.underlineSelection = " Shift\n+ U "
$legacyBindings = [ordered]@{}
foreach ($definition in @($definitions | Select-Object -First 18)) { $legacyBindings[$definition.Id] = $bindings[$definition.Id] }
$legacyLauncher = [ordered]@{}
foreach ($definition in @($launcherDefinitions | Select-Object -First 7)) { $legacyLauncher[$definition.Id] = $layers.launcher[$definition.Id] }
$legacyLayers = [ordered]@{ app = @{}; edit = @{}; read = $layers.read; launcher = $legacyLauncher }
@{ schemaVersion = 5; bindings = $legacyBindings; layers = $legacyLayers } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $path
$legacy = Read-BabelShortcutSettings -Definitions $definitions -Path $path
if ($legacy.Source -ne 'User' -or $null -ne $legacy.Bindings.help -or $legacy.Layers.read.underlineSelection -ne 'Shift+U' -or $legacy.Bindings.save -ne 'Ctrl+S') { throw 'Schema 5 assignments were not retained.' }
$bindings = $legacy.Bindings
$bindings.new = 'Ctrl+J N'
$layers.app.read = 'G R'
$layers.edit.save = 'G S'
$layers.read.underlineSelection = 'G U'
$layers.read.read = 'Ctrl+J N U'
Assert-Rejected { Write-BabelShortcutSettings -Definitions $definitions -Bindings $bindings -Layers $layers -Path $path }
$layers.read.Remove('read')
$layers.read.new = $null
$layers.read.removeUnderline = 'G R'
$layers.launcher.openApp = 'G G'
$layers.launcher.nextApp = 'G N'
[void](Write-BabelShortcutSettings -Definitions $definitions -Bindings $bindings -Layers $layers -Path $path)
$loaded = Read-BabelShortcutSettings -Definitions $definitions -Path $path
if ($loaded.Source -ne 'User' -or $loaded.Bindings.new -ne 'Ctrl+J N') { throw 'Schema 6 sequence was not loaded.' }
$read = Get-BabelEffectiveShortcutBindings -Bindings $loaded.Bindings -Layers $loaded.Layers -Scope read
if ($null -ne $read.read -or $null -ne $read.new -or $read.removeUnderline -ne 'G R') { throw 'Exact override/disable semantics changed.' }
@{ settings = (Get-Content -LiteralPath $path -Raw | ConvertFrom-Json); resolved = @{
  app = (Get-BabelEffectiveShortcutBindings -Bindings $loaded.Bindings -Layers $loaded.Layers -Scope app)
  edit = (Get-BabelEffectiveShortcutBindings -Bindings $loaded.Bindings -Layers $loaded.Layers -Scope edit)
  read = $read
} } | ConvertTo-Json -Depth 8 -Compress
`, directory);
    const result = JSON.parse(stdout) as { settings: unknown; resolved: Record<"app" | "edit" | "read", unknown> };
    const settings = parseShortcutSettings(result.settings);
    assert.equal(settings.schemaVersion, 8);
    for (const mode of ["app", "edit", "read"] as const) assert.deepEqual(result.resolved[mode], resolveShortcutBindings(settings, mode));
    assert.throws(() => parseShortcutSettings({ ...(result.settings as object), schemaVersion: 5 }));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("native sequence dispatch handles branches, repeats, cancellation, mismatch, and expiry", { skip: process.platform !== "win32" }, async () => {
  const { stdout } = await runPowerShell(`
$map = [ordered]@{ openApp = 'G G'; nextApp = 'G N'; previousApp = 'G P Q R'; hideLauncher = 'Escape'; stopApp = 'Delete' }
$state = New-BabelShortcutSequenceState
$first = Step-BabelShortcutSequence -State $state -Bindings $map -Binding G -NowMilliseconds 0
if ($first.Status -ne 'pending' -or $state.ExpiresAt -ne 1500) { throw 'Prefix did not start a deadline.' }
$repeat = Step-BabelShortcutSequence -State $state -Bindings $map -Binding G -NowMilliseconds 800 -IsRepeat
if ($repeat.Status -ne 'repeat' -or $state.ExpiresAt -ne 1500) { throw 'Repeat advanced or extended a sequence.' }
$complete = Step-BabelShortcutSequence -State $state -Bindings $map -Binding N -NowMilliseconds 900
if ($complete.Command -ne 'nextApp' -or $state.Pending) { throw 'Shared prefix did not choose its branch.' }
[void](Step-BabelShortcutSequence -State $state -Bindings $map -Binding G -NowMilliseconds 1000)
$cancel = Step-BabelShortcutSequence -State $state -Bindings $map -Binding Escape -NowMilliseconds 1100
if ($cancel.Status -ne 'cancelled' -or $cancel.Command -or -not $cancel.Consumed) { throw 'Escape ran a hide command while cancelling.' }
[void](Step-BabelShortcutSequence -State $state -Bindings $map -Binding G -NowMilliseconds 2000)
$wrong = Step-BabelShortcutSequence -State $state -Bindings $map -Binding Delete -NowMilliseconds 2100
if (-not $wrong.Consumed -or $wrong.Command -or $state.Pending) { throw 'Wrong continuation ran a different command.' }
[void](Step-BabelShortcutSequence -State $state -Bindings $map -Binding G -NowMilliseconds 3000)
$expired = Step-BabelShortcutSequence -State $state -Bindings $map -Binding N -NowMilliseconds 4500
if ($expired.Command -or $expired.Consumed -or $state.Pending) { throw 'Expired sequence remained active.' }
foreach ($key in @('G', 'P', 'Q')) { $step = Step-BabelShortcutSequence -State $state -Bindings $map -Binding $key -NowMilliseconds 5000 }
$last = Step-BabelShortcutSequence -State $state -Bindings $map -Binding R -NowMilliseconds 5100
if ($last.Command -ne 'previousApp') { throw 'Four-step command did not complete.' }
$held = Step-BabelShortcutSequence -State $state -Bindings $map -Binding G -NowMilliseconds 5200 -IsRepeat
if ($held.Command -or $state.Pending) { throw 'Held first key started a new sequence.' }
'Native sequence dispatch passed'
`);
  assert.match(stdout, /Native sequence dispatch passed/);
});

test("WPF sequence recording applies explicitly and the dialog remains usable at minimum size", { skip: process.platform !== "win32" }, async () => {
  const { stdout } = await runPowerShell(`
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase, System.Data
Import-GuiFunctions @('Update-BabelShortcutDialogRows', 'Set-BabelShortcutDialogLayer', 'Set-BabelShortcutDialogBinding', 'Reset-BabelShortcutRecording', 'Add-BabelShortcutRecordingStroke', 'Apply-BabelShortcutRecording')
[xml]$xaml = Get-Content -LiteralPath (Join-Path $env:BABEL_TEST_ROOT 'launcher/Babel.Shortcuts.xaml') -Raw
$reader = [Xml.XmlNodeReader]::new($xaml)
try { $window = [Windows.Markup.XamlReader]::Load($reader) } finally { $reader.Close() }
$window.Width = $window.MinWidth; $window.Height = $window.MinHeight
$window.ShowInTaskbar = $false; $window.ShowActivated = $false; $window.Left = -20000; $window.Top = -20000
$table = [Data.DataTable]::new()
foreach ($column in @('Id', 'Label', 'Shortcut', 'BindingState')) { [void]$table.Columns.Add($column, [string]) }
$controls = @{}
foreach ($name in @('ShortcutGrid', 'RestoreInheritanceButton', 'ShortcutLayerHint', 'ApplyShortcutSequenceButton', 'ShortcutRecordingPreview', 'ShortcutStatusText', 'SaveShortcutsButton', 'RecordShortcutAgainButton', 'ShortcutRecordingModeBox')) { $controls[$name] = $window.FindName($name) }
$controls.ShortcutGrid.ItemsSource = $table.DefaultView
$state = [pscustomobject]@{
    Controls = $controls; Table = $table; Definitions = $definitions; LauncherDefinitions = $launcherDefinitions
    DefaultBindings = $bindings; DefaultLauncherBindings = $layers.launcher
    Bindings = $bindings; Layers = $layers; CurrentLayer = 'read'; SelectedCommand = ''; LauncherBinding = 'Ctrl+Alt+B'
    RecordingMode = 'sequence'; RecordingCommand = ''; RecordingStrokes = @()
}
Reset-BabelShortcutRecording -State $state
Add-BabelShortcutRecordingStroke -State $state -CommandId underlineSelection -Stroke G
if ($state.Layers.read.Count -ne 0 -or $controls.ApplyShortcutSequenceButton.IsEnabled) { throw 'First recorded step changed a binding.' }
Assert-Rejected { Apply-BabelShortcutRecording -State $state }
Add-BabelShortcutRecordingStroke -State $state -CommandId underlineSelection -Stroke U
if (-not $controls.ApplyShortcutSequenceButton.IsEnabled -or $state.Layers.read.Count -ne 0) { throw 'Completed recording was not a draft.' }
Apply-BabelShortcutRecording -State $state
if ($state.Layers.read.underlineSelection -ne 'G U' -or $state.RecordingStrokes.Count -ne 0) { throw 'Apply did not keep and clear the sequence.' }
Add-BabelShortcutRecordingStroke -State $state -CommandId underlineSelection -Stroke G
Add-BabelShortcutRecordingStroke -State $state -CommandId removeUnderline -Stroke R
if ($state.RecordingStrokes.Count -ne 1 -or $state.RecordingCommand -ne 'removeUnderline') { throw 'Changing command reused its previous recording.' }
Reset-BabelShortcutRecording -State $state
foreach ($key in @('G', 'U', 'U', 'U')) { Add-BabelShortcutRecordingStroke -State $state -CommandId underlineSelection -Stroke $key }
Assert-Rejected { Add-BabelShortcutRecordingStroke -State $state -CommandId underlineSelection -Stroke U }
Reset-BabelShortcutRecording -State $state
$state.CurrentLayer = 'global'
Assert-Rejected { Add-BabelShortcutRecordingStroke -State $state -CommandId save -Stroke G }
Add-BabelShortcutRecordingStroke -State $state -CommandId save -Stroke 'Ctrl+J'
Add-BabelShortcutRecordingStroke -State $state -CommandId save -Stroke S
Apply-BabelShortcutRecording -State $state
if ($state.Bindings.save -ne 'Ctrl+J S') { throw 'Global recording did not permit bare continuation.' }
Add-BabelShortcutRecordingStroke -State $state -CommandId read -Stroke 'Ctrl+K'
Add-BabelShortcutRecordingStroke -State $state -CommandId read -Stroke R
Assert-Rejected { Apply-BabelShortcutRecording -State $state }
if ($state.Bindings.read -ne 'Ctrl+R') { throw 'Rejected prefix changed the draft binding.' }
$window.Show(); $window.UpdateLayout()
$height = ([Windows.FrameworkElement]$window.Content).ActualHeight
foreach ($name in @('ApplyShortcutSequenceButton', 'RecordShortcutAgainButton', 'ShortcutRecordingModeBox', 'SaveShortcutsButton')) {
    $control = $controls[$name]
    $position = $control.TranslatePoint([Windows.Point]::new(0, 0), $window.Content)
    if ($control.ActualHeight -lt 20 -or $position.Y -lt 0 -or ($position.Y + $control.ActualHeight) -gt ($height + 1)) { throw "$name is clipped at minimum window size." }
}
if ($controls.ShortcutGrid.ActualHeight -lt 100) { throw 'Minimum window leaves no usable command rows.' }
$window.Close()
'WPF recording and minimum geometry passed'
`);
  assert.match(stdout, /WPF recording and minimum geometry passed/);
});

test("native home routing shows pending steps and protects input, IME, and app views", { skip: process.platform !== "win32" }, async () => {
  const { stdout } = await runPowerShell(`
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase
Import-GuiFunctions @('Get-BabelNativeShellShortcutBindings', 'Update-BabelHomeShortcutHint', 'Reset-BabelHomeShortcutSequence', 'Invoke-BabelHomeShortcutKeyEvent')
$script:DesktopHost = $null
$script:DesktopShortcutBindings = [ordered]@{}
$script:HomeShortcutSequence = New-BabelShortcutSequenceState
$script:HomeShortcutSequenceTimer = [Windows.Threading.DispatcherTimer]::new()
$script:LauncherShortcutBindings = [ordered]@{ openApp = 'G G'; hideLauncher = 'Escape'; focusNextPane = 'Tab' }
$controls = @{ DesktopStatusText = [Windows.Controls.TextBlock]::new() }
$script:Invoked = [Collections.Generic.List[string]]::new()
$script:Typing = $false
function Test-BabelEditableTextInputFocused { return $script:Typing }
function ConvertFrom-WpfShortcutKeyEvent($EventArgs, [switch]$AllowBareKeys) {
    if ($EventArgs.Binding -eq 'unknown') { throw 'Unsupported key' }
    return $EventArgs.Binding
}
function Invoke-BabelHomeShortcut([string]$Command) { $script:Invoked.Add($Command) }
function Show-BabelError([string]$Message) { throw $Message }
function Get-BabelNumberSelectionIndex($Key) { return -1 }
function Send-Key([string]$Binding, [Windows.Input.Key]$Key = [Windows.Input.Key]::G, [switch]$Repeat) {
    $event = [pscustomobject]@{ Binding = $Binding; Key = $Key; SystemKey = $Key; IsRepeat = [bool]$Repeat; Handled = $false; KeyboardDevice = @{ Modifiers = [Windows.Input.ModifierKeys]::None } }
    Invoke-BabelHomeShortcutKeyEvent -EventArgs $event
    return $event
}
[void](Send-Key G)
if (-not $script:HomeShortcutSequenceTimer.IsEnabled -or $controls.DesktopStatusText.Text -notmatch 'G →') { throw 'Pending home hint or timer is missing.' }
[void](Send-Key ignored -Key LeftCtrl)
if ($script:HomeShortcutSequence.Pending -ne 'G') { throw 'Modifier cancelled pending sequence.' }
[void](Send-Key G -Repeat)
if ($script:Invoked.Count -ne 0) { throw 'Repeated key ran the command.' }
[void](Send-Key G)
if ($script:Invoked.Count -ne 1 -or $script:Invoked[0] -ne 'openApp' -or $script:HomeShortcutSequenceTimer.IsEnabled) { throw 'Home sequence did not execute exactly once.' }
[void](Send-Key G); [void](Send-Key Escape -Key Escape)
if ($script:Invoked.Count -ne 1 -or $script:HomeShortcutSequence.Pending) { throw 'Escape did not cancel without hiding.' }
[void](Send-Key G); $unknown = Send-Key unknown -Key OemPeriod
if (-not $unknown.Handled -or $script:HomeShortcutSequence.Pending) { throw 'Unknown continuation was not consumed/reset.' }
[void](Send-Key G); $windowsKey = Send-Key ignored -Key LWin
if ($windowsKey.Handled -or $script:HomeShortcutSequence.Pending) { throw 'Windows key was consumed or kept a pending sequence.' }
[void](Send-Key G); $script:Typing = $true; $typingKey = Send-Key G
if ($typingKey.Handled -or $script:HomeShortcutSequence.Pending) { throw 'Typing was consumed by a sequence.' }
$script:Typing = $false
[void](Send-Key G); [void](Send-Key ignored -Key ImeProcessed)
if ($script:HomeShortcutSequence.Pending) { throw 'IME did not clear pending state.' }
[void](Send-Key G)
$script:DesktopHost = [pscustomobject]@{ IsHomeVisible = $false; IsWebContentFocused = $true }
$script:DesktopHost | Add-Member -MemberType ScriptMethod -Name RefreshStatus -Value {}
$appKey = Send-Key G
if ($appKey.Handled -or $script:HomeShortcutSequence.Pending) { throw 'Home dispatcher captured an app key.' }
$script:DesktopHost = $null
[void](Send-Key G); Reset-BabelHomeShortcutSequence
if ($script:HomeShortcutSequence.Pending -or $script:HomeShortcutSequenceTimer.IsEnabled -or $controls.DesktopStatusText.Text -match '→') { throw 'Context reset retained pending hint/timer.' }
'Native home routing passed'
`);
  assert.match(stdout, /Native home routing passed/);
});
