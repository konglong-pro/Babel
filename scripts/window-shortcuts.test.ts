import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const root = path.resolve(import.meta.dirname, "..");
const execFileAsync = promisify(execFile);

test("native window commands respect home overrides, sequences, input focus and current-window closing", {
  skip: process.platform !== "win32", timeout: 30_000,
}, async () => {
  const { stdout } = await execFileAsync("pwsh.exe", ["-NoProfile", "-NonInteractive", "-STA", "-Command", String.raw`
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase
. (Join-Path $env:BABEL_TEST_ROOT 'launcher/Babel.Shortcuts.ps1')
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $env:BABEL_TEST_ROOT 'launcher/Babel.Gui.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count -gt 0) { throw ($errors | Out-String) }
foreach ($name in @('Get-BabelNativeShellShortcutBindings', 'Update-BabelHomeShortcutHint', 'Reset-BabelHomeShortcutSequence', 'Invoke-BabelHomeShortcutKeyEvent', 'Invoke-BabelHomeShortcut', 'Invoke-BabelWindowShortcut')) {
    $definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
    if ($null -eq $definition) { throw "Missing function $name" }
    Invoke-Expression ($definition.Extent.Text -replace ('^function ' + $name), ('function script:' + $name))
}
$definitions = @(Get-BabelShortcutDefinitions -Path (Join-Path $env:BABEL_TEST_ROOT 'packages/platform/shortcuts.defaults.json'))
$script:DesktopShortcutBindings = Get-BabelDefaultShortcutBindings -Definitions $definitions
$script:LauncherShortcutBindings = (Get-BabelDefaultShortcutLayers).launcher
$script:DesktopHost = $null
$script:HomeShortcutSequence = New-BabelShortcutSequenceState
$script:HomeShortcutSequenceTimer = [Windows.Threading.DispatcherTimer]::new()
$controls = @{ DesktopStatusText = [Windows.Controls.TextBlock]::new() }
$script:Typing = $false
function Test-BabelEditableTextInputFocused { return $script:Typing }
function ConvertFrom-WpfShortcutKeyEvent($EventArgs, [switch]$AllowBareKeys) { return $EventArgs.Binding }
function Get-BabelNumberSelectionIndex($Key) { return -1 }
function Show-BabelError([string]$Message) { throw $Message }
function New-FixtureWindow {
    $result = [Windows.Window]::new()
    $result.Left = -32000; $result.Top = -32000
    $result.Width = 800; $result.Height = 600
    $result.ShowInTaskbar = $false; $result.ShowActivated = $false; $result.Opacity = 0
    $result.Show()
    return $result
}
$script:Window = New-FixtureWindow
$popup = New-FixtureWindow
function Send-Key([string]$Binding, [Windows.Window]$Target, [switch]$Repeat) {
    $event = [pscustomobject]@{ Binding = $Binding; Key = [Windows.Input.Key]::M; IsRepeat = [bool]$Repeat; Handled = $false;
        KeyboardDevice = @{ Modifiers = [Windows.Input.ModifierKeys]::Control -bor [Windows.Input.ModifierKeys]::Alt } }
    Invoke-BabelHomeShortcutKeyEvent -EventArgs $event -TargetWindow $Target
    return $event.Handled
}
try {
    $script:LauncherShortcutBindings.minimizeWindow = 'Ctrl+Alt+J M'
    if (Send-Key 'Ctrl+Alt+M' $script:Window) { throw 'Base binding ignored the home override.' }
    [void](Send-Key 'Ctrl+Alt+J' $script:Window)
    [void](Send-Key 'Escape' $script:Window)
    if ($script:Window.WindowState -ne [Windows.WindowState]::Normal) { throw 'Cancelled sequence minimized a window.' }
    [void](Send-Key 'Ctrl+Alt+J' $script:Window)
    if (-not (Send-Key 'M' $script:Window) -or $script:Window.WindowState -ne [Windows.WindowState]::Minimized) { throw 'Home sequence did not minimize.' }
    $script:Window.WindowState = [Windows.WindowState]::Normal
    $script:LauncherShortcutBindings.closeWindow = $null
    if (Send-Key 'Ctrl+Alt+Q' $script:Window) { throw 'Disabled home close inherited the base shortcut.' }
    $script:LauncherShortcutBindings.minimizeWindow = 'M'
    $script:Typing = $true
    if (Send-Key 'M' $script:Window) { throw 'Bare window shortcut captured typing.' }
    $script:Typing = $false

    $script:WebFocused = $false
    $script:DesktopHost = [pscustomobject]@{ IsHomeVisible = $false; IsWebContentFocused = $false }
    $script:DesktopHost | Add-Member ScriptMethod IsWindowWebContentFocused { param($target) return $script:WebFocused }
    $script:DesktopHost | Add-Member ScriptMethod RefreshStatus {}
    $popupBindings = Get-BabelNativeShellShortcutBindings -HomeVisible $false -WindowOnly
    if ($popupBindings.Keys.Count -ne 3 -or $popupBindings.Contains('appHome')) { throw 'Detached chrome inherited APP navigation.' }
    if (-not (Send-Key 'Ctrl+Alt+M' $popup) -or $popup.WindowState -ne [Windows.WindowState]::Minimized -or
        $script:Window.WindowState -ne [Windows.WindowState]::Normal) { throw 'Minimize affected the wrong window.' }
    $popup.WindowState = [Windows.WindowState]::Normal
    [void](Send-Key 'Ctrl+Alt+F11' $popup)
    if ($popup.WindowState -ne [Windows.WindowState]::Maximized) { throw 'Maximize command failed.' }
    [void](Send-Key 'Ctrl+Alt+F11' $popup -Repeat)
    if ($popup.WindowState -ne [Windows.WindowState]::Maximized) { throw 'Held shortcut toggled repeatedly.' }
    [void](Send-Key 'Ctrl+Alt+F11' $popup)
    if ($popup.WindowState -ne [Windows.WindowState]::Normal) { throw 'Restore command failed.' }
    $script:WebFocused = $true
    if (Send-Key 'Ctrl+Alt+M' $popup) { throw 'Native router captured a focused WebView command twice.' }
    $script:WebFocused = $false
    $script:CloseCount = 0
    $cancelClose = [ComponentModel.CancelEventHandler]{ param($sender, $event) $script:CloseCount++; $event.Cancel = $true }
    $popup.Add_Closing($cancelClose)
    [void](Send-Key 'Ctrl+Alt+Q' $popup)
    if ($script:CloseCount -ne 1 -or -not $popup.IsVisible -or -not $script:Window.IsVisible) { throw 'Close bypassed cancellation or closed the main window.' }
    $popup.Remove_Closing($cancelClose)
    [void](Send-Key 'Ctrl+Alt+Q' $popup)
    if ($popup.IsVisible -or -not $script:Window.IsVisible) { throw 'Close failed to close only the detached window.' }
    'Native window shortcut routing passed'
} finally {
    $script:HomeShortcutSequenceTimer.Stop()
    if ($popup.IsVisible) { $popup.Close() }
    $script:Window.Close()
}
`], { cwd: root, env: { ...process.env, BABEL_TEST_ROOT: root }, windowsHide: true, timeout: 25_000 });
  assert.match(stdout, /Native window shortcut routing passed/);
});
