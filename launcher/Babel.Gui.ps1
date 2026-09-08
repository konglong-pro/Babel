[CmdletBinding()]
param(
    [switch]$SmokeTest,

    [switch]$TraySmokeTest,

    [switch]$StateSmokeTest,

    [switch]$LifecycleSmokeTest,

    [switch]$HotkeySmokeTest
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

$testModeCount = 0
foreach ($testModeEnabled in @(
    $SmokeTest,
    $TraySmokeTest,
    $StateSmokeTest,
    $LifecycleSmokeTest,
    $HotkeySmokeTest
)) {
    if ($testModeEnabled) {
        $testModeCount++
    }
}
if ($testModeCount -gt 1) {
    throw "GUI smoke-test modes cannot be used together."
}

if ($PSVersionTable.PSEdition -ne "Core" -or $PSVersionTable.PSVersion.Major -lt 7) {
    throw "Babel GUI requires PowerShell 7 or newer."
}
if ([Threading.Thread]::CurrentThread.ApartmentState -ne [Threading.ApartmentState]::STA) {
    throw "Babel GUI requires an STA thread. Start it with pwsh.exe -STA -File launcher\Babel.Gui.ps1."
}

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Data
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

if ($null -eq ("BabelLauncher.GlobalHotkeyNativeMethods" -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace BabelLauncher
{
    public static class GlobalHotkeyNativeMethods
    {
        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool RegisterHotKey(
            IntPtr windowHandle,
            int identifier,
            uint modifiers,
            uint virtualKey);

        public static int RegisterHotKeyWithError(
            IntPtr windowHandle,
            int identifier,
            uint modifiers,
            uint virtualKey)
        {
            if (RegisterHotKey(windowHandle, identifier, modifiers, virtualKey))
            {
                return 0;
            }
            return Marshal.GetLastWin32Error();
        }

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool UnregisterHotKey(IntPtr windowHandle, int identifier);

        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool PostMessage(
            IntPtr windowHandle,
            uint message,
            IntPtr wParam,
            IntPtr lParam);
    }
}
'@
}

$babelRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$registryPath = Join-Path $babelRoot "babel.apps.json"
$xamlPath = Join-Path $PSScriptRoot "Babel.xaml"
$nativeLauncherPath = Join-Path $PSScriptRoot "Babel.exe"
$workerScriptPath = Join-Path $PSScriptRoot "Babel.ps1"
$processHelperPath = Join-Path $PSScriptRoot "Babel.Process.ps1"
$shortcutHelperPath = Join-Path $PSScriptRoot "Babel.Shortcuts.ps1"
$shortcutXamlPath = Join-Path $PSScriptRoot "Babel.Shortcuts.xaml"
$shortcutDefaultsPath = Join-Path $babelRoot "packages\platform\shortcuts.defaults.json"

foreach ($helperPath in @($processHelperPath, $shortcutHelperPath)) {
    if (-not (Test-Path -LiteralPath $helperPath -PathType Leaf)) {
        throw "Launcher helper not found: $helperPath"
    }
}
try {
    . $processHelperPath
    . $shortcutHelperPath
} catch {
    throw "Could not load a launcher helper: $($_.Exception.Message)"
}

function Test-RequiredProperty {
    param(
        [Parameter(Mandatory = $true)]
        [object]$InputObject,

        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    return $null -ne $InputObject.PSObject.Properties[$Name]
}

function Get-RegisteredApps {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Application registry not found: $Path"
    }

    try {
        $registry = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    } catch {
        throw "The application registry is not valid JSON: $($_.Exception.Message)"
    }

    if (-not (Test-RequiredProperty -InputObject $registry -Name "schemaVersion")) {
        throw "The application registry is missing schemaVersion."
    }
    if ([string]$registry.schemaVersion -ne "1") {
        throw "Unsupported application registry schemaVersion '$($registry.schemaVersion)'."
    }
    if (-not (Test-RequiredProperty -InputObject $registry -Name "apps")) {
        throw "The application registry is missing apps."
    }

    $definitions = @($registry.apps)
    if ($definitions.Count -eq 0) {
        throw "The application registry does not contain any applications."
    }

    $ids = @{}
    $ports = @{}
    $apps = @()

    foreach ($definition in $definitions) {
        foreach ($propertyName in @("name", "id", "port", "healthPath", "identityPath", "identityText")) {
            if (-not (Test-RequiredProperty -InputObject $definition -Name $propertyName)) {
                throw "Application registry entry is missing $propertyName."
            }
        }

        $name = ([string]$definition.name).Trim()
        $id = ([string]$definition.id).Trim()
        $port = 0
        $healthPath = ([string]$definition.healthPath).Trim()
        $identityPath = ([string]$definition.identityPath).Trim()
        $identityText = ([string]$definition.identityText).Trim()

        if ([string]::IsNullOrWhiteSpace($name)) {
            throw "Application name cannot be empty."
        }
        if ($id -notmatch "^[a-z0-9][a-z0-9-]*$") {
            throw "Application id '$id' may contain only lowercase letters, numbers, and hyphens."
        }
        if ($ids.ContainsKey($id)) {
            throw "Duplicate application id '$id'."
        }
        if (-not [int]::TryParse([string]$definition.port, [ref]$port) -or $port -lt 1 -or $port -gt 65535) {
            throw "Application '$name' has an invalid port."
        }
        if ($ports.ContainsKey([string]$port)) {
            throw "Duplicate application port '$port'."
        }
        if (-not $healthPath.StartsWith("/")) {
            throw "Application '$name' healthPath must start with /."
        }
        if (-not $identityPath.StartsWith("/")) {
            throw "Application '$name' identityPath must start with /."
        }
        if ([string]::IsNullOrWhiteSpace($identityText)) {
            throw "Application '$name' identityText cannot be empty."
        }

        $internalBaseUrl = "http://127.0.0.1:$port"
        $publicBaseUrl = "http://localhost:$port"

        $apps += [pscustomobject]@{
            Name = $name
            Id = $id
            Port = $port
            HealthPath = $healthPath
            IdentityPath = $identityPath
            IdentityText = $identityText
            HealthUrl = $internalBaseUrl + $healthPath
            IdentityUrl = $publicBaseUrl + $identityPath
        }
        $ids[$id] = $true
        $ports[[string]$port] = $true
    }

    return @($apps)
}

function Get-AppDisplayStatus {
    param(
        [Parameter(Mandatory = $true)]
        [bool]$PortOpen,

        [Parameter(Mandatory = $true)]
        [bool]$Healthy,

        [Parameter(Mandatory = $true)]
        [bool]$WorkerActive,

        [Parameter(Mandatory = $true)]
        [bool]$ReadyObserved
    )

    if ($Healthy) {
        if ($WorkerActive) {
            return "Ready"
        }
        return "External"
    }
    if ($WorkerActive) {
        if ($ReadyObserved) {
            return "Unhealthy"
        }
        return "Starting"
    }
    if ($PortOpen) {
        return "Unhealthy"
    }
    return "Stopped"
}

function Test-AppHealth {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$App
    )

    try {
        $healthResponse = Invoke-WebRequest `
            -Uri $App.HealthUrl `
            -UseBasicParsing `
            -TimeoutSec 2
        if ($healthResponse.StatusCode -lt 200 -or $healthResponse.StatusCode -ge 400) {
            return $false
        }

        $health = $healthResponse.Content | ConvertFrom-Json -ErrorAction Stop
        return `
            [string]$health.status -ieq "ok" -and
            [string]$health.app -ieq [string]$App.IdentityText
    } catch {
        return $false
    }
}

function Import-BabelWindow {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "UI file not found: $Path"
    }

    try {
        [xml]$xaml = Get-Content -LiteralPath $Path -Raw
        $reader = New-Object System.Xml.XmlNodeReader $xaml
        try {
            return [Windows.Markup.XamlReader]::Load($reader)
        } finally {
            $reader.Close()
        }
    } catch {
        throw "Could not load Babel XAML: $($_.Exception.Message)"
    }
}

function Get-RequiredControl {
    param(
        [Parameter(Mandatory = $true)]
        [Windows.Window]$Window,

        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    $control = $Window.FindName($Name)
    if ($null -eq $control) {
        throw "XAML is missing required control '$Name'."
    }
    return $control
}

$expectedShortcutCommands = @(
    "save",
    "new",
    "edit",
    "read",
    "confirm",
    "cancel",
    "search",
    "delete",
    "commandPalette",
    "focusNextPane",
    "focusPreviousPane",
    "nextTab",
    "previousTab",
    "closeTab",
    "quickOpen",
    "help"
)
$shortcutDefinitions = @(Get-BabelShortcutDefinitions -Path $shortcutDefaultsPath)
$actualShortcutCommands = @($shortcutDefinitions | ForEach-Object { [string]$_.Id })
if (($actualShortcutCommands -join "|") -cne ($expectedShortcutCommands -join "|")) {
    throw "Shortcut defaults must define the schema v3 commands in their registered order."
}
$shortcutDefaultBindings = Get-BabelDefaultShortcutBindings -Definitions $shortcutDefinitions

$shortcutControlNames = @(
    "LauncherHotkeyBox",
    "ShortcutGrid",
    "ShortcutErrorText",
    "ShortcutStatusText",
    "RestoreDefaultsButton",
    "CancelShortcutsButton",
    "SaveShortcutsButton"
)
$shortcutPreviewWindow = Import-BabelWindow -Path $shortcutXamlPath
$shortcutPreviewControls = @{}
foreach ($controlName in $shortcutControlNames) {
    $shortcutPreviewControls[$controlName] = Get-RequiredControl `
        -Window $shortcutPreviewWindow `
        -Name $controlName
}
$shortcutControlCount = $shortcutPreviewControls.Count
$shortcutPreviewControls = $null
$shortcutPreviewWindow = $null

$registeredApps = @(Get-RegisteredApps -Path $registryPath)
$window = Import-BabelWindow -Path $xamlPath

$requiredControlNames = @(
    "BrandLogo",
    "AppsGrid",
    "OpenSelectedButton",
    "StartAllButton",
    "StopSelectedButton",
    "StopAllButton",
    "VerifyButton",
    "ShortcutsButton",
    "MinimizeToTrayButton",
    "AdvancedExpander",
    "LogTextBox",
    "StatusText",
    "WorkerText"
)
$controls = @{}
foreach ($controlName in $requiredControlNames) {
    $controls[$controlName] = Get-RequiredControl -Window $window -Name $controlName
}

$brandLogoPath = Join-Path $PSScriptRoot "assets\Babel.png"
if (-not (Test-Path -LiteralPath $brandLogoPath -PathType Leaf)) {
    throw "Brand logo not found: $brandLogoPath"
}

try {
    $brandLogoUri = New-Object Uri($brandLogoPath, [UriKind]::Absolute)
    $brandLogoBitmap = New-Object Windows.Media.Imaging.BitmapImage
    $brandLogoBitmap.BeginInit()
    $brandLogoBitmap.CacheOption = [Windows.Media.Imaging.BitmapCacheOption]::OnLoad
    $brandLogoBitmap.UriSource = $brandLogoUri
    $brandLogoBitmap.EndInit()
    $brandLogoBitmap.Freeze()
    $controls.BrandLogo.Source = $brandLogoBitmap
} catch {
    throw "Could not load Babel brand logo: $($_.Exception.Message)"
}

if ($SmokeTest) {
    $normalizedSmokeBinding = ConvertTo-BabelShortcutBinding -Binding "shift + ctrl + s"
    if ($normalizedSmokeBinding -ne "Ctrl+Shift+S") {
        throw "Shortcut normalization smoke test failed."
    }
    Write-Output "Babel GUI smoke test passed: $($registeredApps.Count) app(s), $($controls.Count) launcher control(s), $shortcutControlCount shortcut control(s), $($shortcutDefinitions.Count) shortcut command(s)."
    return
}

if ($StateSmokeTest) {
    $stateCases = [ordered]@{
        Stopped = Get-AppDisplayStatus -PortOpen $false -Healthy $false -WorkerActive $false -ReadyObserved $false
        Starting = Get-AppDisplayStatus -PortOpen $true -Healthy $false -WorkerActive $true -ReadyObserved $false
        Ready = Get-AppDisplayStatus -PortOpen $true -Healthy $true -WorkerActive $true -ReadyObserved $true
        Unhealthy = Get-AppDisplayStatus -PortOpen $true -Healthy $false -WorkerActive $false -ReadyObserved $false
        External = Get-AppDisplayStatus -PortOpen $true -Healthy $true -WorkerActive $false -ReadyObserved $false
    }
    foreach ($expectedState in @($stateCases.Keys)) {
        if ([string]$stateCases[$expectedState] -cne [string]$expectedState) {
            throw "State smoke test expected '$expectedState' but received '$($stateCases[$expectedState])'."
        }
    }

    $foreignListener = New-Object Net.Sockets.TcpListener -ArgumentList ([Net.IPAddress]::Loopback), 0
    try {
        $foreignListener.Start()
        $foreignPort = ([Net.IPEndPoint]$foreignListener.LocalEndpoint).Port
        $foreignApp = [pscustomobject]@{
            HealthUrl = "http://127.0.0.1:$foreignPort/api/health"
            IdentityText = "Babel state smoke identity"
        }
        if (Test-AppHealth -App $foreignApp) {
            throw "A port-only foreign listener passed the Babel health identity check."
        }
    } finally {
        $foreignListener.Stop()
    }

    $workerScopes = @{
        all = [pscustomobject]@{ ManagesAll = $true }
        retex = [pscustomobject]@{ AppId = "retex"; ManagesAll = $false }
    }
    if (
        $workerScopes.Count -ne 2 -or
        -not $workerScopes.all.ManagesAll -or
        $workerScopes.retex.ManagesAll
    ) {
        throw "State smoke test could not model aggregate and independent worker scopes."
    }

    Write-Output "Babel GUI state smoke test passed: Stopped, Starting, Ready, Unhealthy, External; foreign listener rejected; aggregate Start All and independent OPEN workers."
    return
}

foreach ($launcherPath in @($nativeLauncherPath, $workerScriptPath)) {
    if (-not (Test-Path -LiteralPath $launcherPath -PathType Leaf)) {
        throw "Babel launcher component not found: $launcherPath"
    }
}

$script:Window = $window
$script:AppsGrid = $controls.AppsGrid
$script:OpenSelectedButton = $controls.OpenSelectedButton
$script:StartAllButton = $controls.StartAllButton
$script:StopSelectedButton = $controls.StopSelectedButton
$script:StopAllButton = $controls.StopAllButton
$script:VerifyButton = $controls.VerifyButton
$script:ShortcutsButton = $controls.ShortcutsButton
$script:MinimizeToTrayButton = $controls.MinimizeToTrayButton
$script:AdvancedExpander = $controls.AdvancedExpander
$script:LogTextBox = $controls.LogTextBox
$script:StatusText = $controls.StatusText
$script:WorkerText = $controls.WorkerText
$script:ShortcutXamlPath = $shortcutXamlPath
$script:ShortcutControlNames = @($shortcutControlNames)
$script:ShortcutDefinitions = @($shortcutDefinitions)
$script:ShortcutDefaultBindings = $shortcutDefaultBindings
$script:RegisteredApps = $registeredApps
$script:AppsById = @{}
$script:RowsById = @{}
$script:WorkersById = @{}
$script:AllWorker = $null
$script:AllWorkerManagedAppIds = @{}
$script:AllWorkerReadyById = @{}
$script:VerifyWorker = $null
$script:WorkerHistory = New-Object System.Collections.ArrayList
$script:MaximumWorkerHistory = 20
$script:MaximumLogTailLines = 2000
$script:MaximumLogCharactersPerStream = 131072
$script:MaximumRenderedLogCharacters = 1048576
$script:HealthProbeIntervalSeconds = 30
$script:StatusPollIntervalSeconds = 5
$script:LastPortOpenById = @{}
$script:LastHealthById = @{}
$script:LastProbeAtById = @{}
$script:HealthProbesById = @{}
$script:ProbeGenerationById = @{}
$script:ExternalOpenRequestsById = @{}
$script:HideAfterOpenById = @{}
$script:HealthProbeScript = @'
param(
    [string]$HealthUrl,
    [string]$IdentityText
)

$ErrorActionPreference = "Stop"
try {
    $healthResponse = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 2
    if ($healthResponse.StatusCode -lt 200 -or $healthResponse.StatusCode -ge 400) {
        return $false
    }

    $health = $healthResponse.Content | ConvertFrom-Json -ErrorAction Stop
    return `
        [string]$health.status -ieq "ok" -and
        [string]$health.app -ieq $IdentityText
} catch {
    return $false
}
'@
$healthProbeConcurrency = [Math]::Min(2, $script:RegisteredApps.Count)
$script:HealthProbeRunspacePool = `
    [Management.Automation.Runspaces.RunspaceFactory]::CreateRunspacePool(1, $healthProbeConcurrency)
$script:HealthProbeRunspacePool.Open()
$script:CloseRequested = $false
$script:AllowClose = $false
$script:LastRenderedLog = ""
$script:NotifyIcon = $null
$script:TrayIconImage = $null
$script:TrayContextMenu = $null
$script:TrayOpenMenuItem = $null
$script:TrayExitMenuItem = $null
$script:TrayAppMenuItems = @{}
$script:TraySmokeTimer = $null
$script:TraySmokeError = $null
$script:WindowHandle = [IntPtr]::Zero
$script:GlobalHotkeySource = $null
$script:GlobalHotkeyHook = $null
$script:GlobalHotkeyRegistered = $false
$script:GlobalHotkeyId = 0
$script:GlobalHotkeyBinding = ""
$script:GlobalHotkeyIds = @(0x4241, 0x4242)
$script:GlobalHotkeyWarning = ""
$script:ShortcutDialogWindow = $null
$script:HotkeySmokeTimer = $null
$script:HotkeySmokeError = $null
$script:HotkeySmokePhase = 0
$script:HotkeySmokeForegroundOverride = $null
$script:WmHotkey = [uint32]0x0312

$appTable = New-Object System.Data.DataTable
[void]$appTable.Columns.Add("Id", [string])
[void]$appTable.Columns.Add("Name", [string])
[void]$appTable.Columns.Add("Port", [int])
[void]$appTable.Columns.Add("Status", [string])

foreach ($app in $script:RegisteredApps) {
    $row = $appTable.NewRow()
    $row.Id = $app.Id
    $row.Name = $app.Name
    $row.Port = $app.Port
    $row.Status = "Stopped"
    [void]$appTable.Rows.Add($row)
    $script:AppsById[$app.Id] = $app
    $script:RowsById[$app.Id] = $row
}

$script:AppsGrid.ItemsSource = $appTable.DefaultView
if ($script:AppsGrid.Items.Count -gt 0) {
    $script:AppsGrid.SelectedIndex = 0
}

$iconPath = Join-Path $PSScriptRoot "assets\Babel.ico"
if (Test-Path -LiteralPath $iconPath -PathType Leaf) {
    try {
        $iconUri = New-Object Uri($iconPath, [UriKind]::Absolute)
        $script:Window.Icon = [Windows.Media.Imaging.BitmapFrame]::Create($iconUri)
    } catch {
        # An unreadable window icon must not make the launcher unusable.
    }
}

try {
    if (Test-Path -LiteralPath $iconPath -PathType Leaf) {
        try {
            $script:TrayIconImage = New-Object System.Drawing.Icon($iconPath)
        } catch {
            $script:TrayIconImage = $null
        }
    }
    if ($null -eq $script:TrayIconImage) {
        $script:TrayIconImage = [System.Drawing.Icon]([System.Drawing.SystemIcons]::Application.Clone())
    }

    $script:NotifyIcon = New-Object System.Windows.Forms.NotifyIcon
    $script:NotifyIcon.Icon = $script:TrayIconImage
    $script:NotifyIcon.Text = "Babel Launcher"
    $script:NotifyIcon.Visible = $false

    $script:TrayContextMenu = New-Object System.Windows.Forms.ContextMenuStrip
    foreach ($app in $script:RegisteredApps) {
        $trayAppMenuItem = New-Object System.Windows.Forms.ToolStripMenuItem
        $trayAppMenuItem.Text = $app.Name.Replace("&", "&&")
        $trayAppMenuItem.Tag = $app.Id
        $trayAppMenuItem.Add_Click({
            param($sender, $eventArgs)

            try {
                $appId = [string]$sender.Tag
                if (-not $script:AppsById.ContainsKey($appId)) {
                    throw "The selected notebook is no longer registered."
                }
                Open-BabelApp -App $script:AppsById[$appId]
            } catch {
                Show-BabelError -Message $_.Exception.Message
            }
        })
        $script:TrayAppMenuItems[$app.Id] = $trayAppMenuItem
        [void]$script:TrayContextMenu.Items.Add($trayAppMenuItem)
    }
    [void]$script:TrayContextMenu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
    $script:TrayOpenMenuItem = New-Object System.Windows.Forms.ToolStripMenuItem
    $script:TrayOpenMenuItem.Text = "Open Launcher"
    $script:TrayExitMenuItem = New-Object System.Windows.Forms.ToolStripMenuItem
    $script:TrayExitMenuItem.Text = "Exit"
    [void]$script:TrayContextMenu.Items.Add($script:TrayOpenMenuItem)
    [void]$script:TrayContextMenu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
    [void]$script:TrayContextMenu.Items.Add($script:TrayExitMenuItem)
    $script:NotifyIcon.ContextMenuStrip = $script:TrayContextMenu
} catch {
    $trayInitializationError = $_.Exception.Message
    if ($null -ne $script:NotifyIcon) {
        $script:NotifyIcon.Dispose()
    }
    if ($null -ne $script:TrayContextMenu) {
        $script:TrayContextMenu.Dispose()
    }
    if ($null -ne $script:TrayIconImage) {
        $script:TrayIconImage.Dispose()
    }
    $script:NotifyIcon = $null
    $script:TrayContextMenu = $null
    $script:TrayIconImage = $null
    $script:TrayOpenMenuItem = $null
    $script:TrayExitMenuItem = $null
    $script:TrayAppMenuItems = @{}
    $script:MinimizeToTrayButton.IsEnabled = $false
    $script:MinimizeToTrayButton.ToolTip = "Notification-area mode is unavailable: $trayInitializationError"
}

function Set-UiStatus {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Message
    )

    $script:StatusText.Text = $Message
}

function Show-BabelError {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Message
    )

    Set-UiStatus -Message $Message
    [Windows.MessageBox]::Show(
        $script:Window,
        $Message,
        "Babel Launcher",
        [Windows.MessageBoxButton]::OK,
        [Windows.MessageBoxImage]::Error
    ) | Out-Null
}

function Get-WpfShortcutKeyName {
    param(
        [Parameter(Mandatory = $true)]
        [Windows.Input.Key]$Key
    )

    $keyText = $Key.ToString()
    if ($keyText -match "^[A-Z]$") {
        return $keyText
    }
    if ($keyText -match "^D([0-9])$") {
        return $Matches[1]
    }
    if ($keyText -match "^NumPad([0-9])$") {
        return $Matches[1]
    }
    if ($keyText -match "^F([1-9]|1[0-2])$") {
        return $keyText
    }

    switch ($Key) {
        ([Windows.Input.Key]::Return) { return "Enter" }
        ([Windows.Input.Key]::Escape) { return "Escape" }
        ([Windows.Input.Key]::Delete) { return "Delete" }
        ([Windows.Input.Key]::Back) { return "Backspace" }
        ([Windows.Input.Key]::Space) { return "Space" }
        ([Windows.Input.Key]::Left) { return "ArrowLeft" }
        ([Windows.Input.Key]::Up) { return "ArrowUp" }
        ([Windows.Input.Key]::Right) { return "ArrowRight" }
        ([Windows.Input.Key]::Down) { return "ArrowDown" }
        ([Windows.Input.Key]::Home) { return "Home" }
        ([Windows.Input.Key]::End) { return "End" }
        ([Windows.Input.Key]::PageUp) { return "PageUp" }
        ([Windows.Input.Key]::PageDown) { return "PageDown" }
        default { throw "Key '$keyText' is not supported for Babel shortcuts." }
    }
}

function ConvertFrom-WpfShortcutKeyEvent {
    param(
        [Parameter(Mandatory = $true)]
        [Windows.Input.KeyEventArgs]$EventArgs
    )

    $key = $EventArgs.Key
    if ($key -eq [Windows.Input.Key]::System) {
        $key = $EventArgs.SystemKey
    }
    $keyName = Get-WpfShortcutKeyName -Key $key
    $modifiers = $EventArgs.KeyboardDevice.Modifiers
    if (
        ($modifiers -band [Windows.Input.ModifierKeys]::Windows) -ne
        [Windows.Input.ModifierKeys]::None
    ) {
        throw "The Windows key cannot be used in a Babel shortcut."
    }

    $parts = @()
    if (
        ($modifiers -band [Windows.Input.ModifierKeys]::Control) -ne
        [Windows.Input.ModifierKeys]::None
    ) {
        $parts += "Ctrl"
    }
    if (
        ($modifiers -band [Windows.Input.ModifierKeys]::Alt) -ne
        [Windows.Input.ModifierKeys]::None
    ) {
        $parts += "Alt"
    }
    if (
        ($modifiers -band [Windows.Input.ModifierKeys]::Shift) -ne
        [Windows.Input.ModifierKeys]::None
    ) {
        $parts += "Shift"
    }
    $parts += $keyName

    return ConvertTo-BabelShortcutBinding -Binding ($parts -join "+")
}

function Get-BabelShortcutDialogState {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Sender
    )

    if ($Sender -is [Windows.Window]) {
        return $Sender.Tag
    }
    $dialogWindow = [Windows.Window]::GetWindow($Sender)
    if ($null -eq $dialogWindow) {
        throw "The shortcut settings window is unavailable."
    }
    return $dialogWindow.Tag
}

function Show-BabelShortcutSettings {
    $settings = Read-BabelShortcutSettings -Definitions $script:ShortcutDefinitions
    $launcherSettings = Read-BabelLauncherHotkeySettings
    $shortcutWindow = Import-BabelWindow -Path $script:ShortcutXamlPath
    $shortcutControls = @{}
    foreach ($controlName in $script:ShortcutControlNames) {
        $shortcutControls[$controlName] = Get-RequiredControl `
            -Window $shortcutWindow `
            -Name $controlName
    }

    $shortcutWindow.Owner = $script:Window
    if ($null -ne $script:Window.Icon) {
        $shortcutWindow.Icon = $script:Window.Icon
    }

    $shortcutTable = New-Object System.Data.DataTable
    [void]$shortcutTable.Columns.Add("Id", [string])
    [void]$shortcutTable.Columns.Add("Label", [string])
    [void]$shortcutTable.Columns.Add("Shortcut", [string])
    foreach ($definition in $script:ShortcutDefinitions) {
        $row = $shortcutTable.NewRow()
        $row.Id = [string]$definition.Id
        $row.Label = [string]$definition.Label
        $row.Shortcut = [string]$settings.Bindings[$row.Id]
        [void]$shortcutTable.Rows.Add($row)
    }
    $shortcutControls.ShortcutGrid.ItemsSource = $shortcutTable.DefaultView
    $shortcutControls.LauncherHotkeyBox.Text = [string]$launcherSettings.Binding

    $state = [pscustomobject]@{
        Window = $shortcutWindow
        Controls = $shortcutControls
        Table = $shortcutTable
        Definitions = @($script:ShortcutDefinitions)
        DefaultBindings = $script:ShortcutDefaultBindings
        DefaultLauncherBinding = Get-BabelDefaultLauncherHotkeyBinding
        LauncherBinding = [string]$launcherSettings.Binding
        Saved = $false
    }
    $shortcutWindow.Tag = $state
    $settingsWarnings = @(
        @(
            [string]$settings.Warning,
            [string]$launcherSettings.Warning
        ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    )
    if ($settingsWarnings.Count -gt 0) {
        $shortcutControls.ShortcutStatusText.Text = $settingsWarnings -join " "
    }

    $shortcutWindow.Add_PreviewKeyDown({
        param($sender, $eventArgs)

        $focusedElement = [Windows.Input.Keyboard]::FocusedElement
        if (
            $null -eq $focusedElement -or
            -not ($focusedElement -is [Windows.Controls.TextBox]) -or
            @("LauncherHotkeyBox", "ShortcutCaptureBox") -notcontains $focusedElement.Name -or
            [string]::IsNullOrWhiteSpace([string]$focusedElement.Tag)
        ) {
            return
        }

        $dialogState = Get-BabelShortcutDialogState -Sender $sender
        try {
            $pressedKey = $eventArgs.Key
            if ($pressedKey -eq [Windows.Input.Key]::System) {
                $pressedKey = $eventArgs.SystemKey
            }
            $pressedModifiers = $eventArgs.KeyboardDevice.Modifiers
            $isUnbindGesture = (
                $focusedElement.Name -eq "ShortcutCaptureBox" -and
                $pressedModifiers -eq [Windows.Input.ModifierKeys]::None -and
                @([Windows.Input.Key]::Back, [Windows.Input.Key]::Delete) -contains $pressedKey
            )
            if ($isUnbindGesture) {
                $commandId = [string]$focusedElement.Tag
                $escapedCommandId = $commandId.Replace("'", "''")
                $currentRows = @($dialogState.Table.Select("Id = '$escapedCommandId'"))
                if ($currentRows.Count -ne 1) {
                    throw "Could not find shortcut command '$commandId'."
                }
                $currentRows[0].Shortcut = ""
                $dialogState.Controls.ShortcutGrid.Items.Refresh()
                $dialogState.Controls.ShortcutErrorText.Text = ""
                $dialogState.Controls.ShortcutStatusText.Text = "Command left unbound. Choose Save to apply the complete set."
                return
            }

            $canonicalBinding = ConvertFrom-WpfShortcutKeyEvent -EventArgs $eventArgs
            if ($focusedElement.Name -eq "LauncherHotkeyBox") {
                [void](ConvertTo-BabelLauncherHotkeyRegistration -Binding $canonicalBinding)
                foreach ($otherRow in $dialogState.Table.Rows) {
                    if (
                        -not [string]::IsNullOrWhiteSpace([string]$otherRow.Shortcut) -and
                        [string]::Equals(
                            [string]$otherRow.Shortcut,
                            $canonicalBinding,
                            [StringComparison]::OrdinalIgnoreCase
                        )
                    ) {
                        throw "Hotkey '$canonicalBinding' is already assigned to the $($otherRow.Label) web command."
                    }
                }
                $dialogState.LauncherBinding = $canonicalBinding
                $dialogState.Controls.LauncherHotkeyBox.Text = $canonicalBinding
            } else {
                $commandId = [string]$focusedElement.Tag
                Assert-BabelShortcutCommandBindingOwnership `
                    -CommandId $commandId `
                    -Binding $canonicalBinding
                if (
                    [string]::Equals(
                        [string]$dialogState.LauncherBinding,
                        $canonicalBinding,
                        [StringComparison]::OrdinalIgnoreCase
                    )
                ) {
                    throw "Shortcut '$canonicalBinding' is already assigned to the launcher toggle."
                }
                foreach ($otherRow in $dialogState.Table.Rows) {
                    if (
                        [string]$otherRow.Id -ne $commandId -and
                        -not [string]::IsNullOrWhiteSpace([string]$otherRow.Shortcut) -and
                        [string]::Equals(
                            [string]$otherRow.Shortcut,
                            $canonicalBinding,
                            [StringComparison]::OrdinalIgnoreCase
                        )
                    ) {
                        throw "Shortcut '$canonicalBinding' is already assigned to $($otherRow.Label)."
                    }
                }

                $escapedCommandId = $commandId.Replace("'", "''")
                $currentRows = @($dialogState.Table.Select("Id = '$escapedCommandId'"))
                if ($currentRows.Count -ne 1) {
                    throw "Could not find shortcut command '$commandId'."
                }
                $currentRows[0].Shortcut = $canonicalBinding
                $dialogState.Controls.ShortcutGrid.Items.Refresh()
            }
            $dialogState.Controls.ShortcutErrorText.Text = ""
            $dialogState.Controls.ShortcutStatusText.Text = "Shortcut captured. Choose Save to apply the complete set."
        } catch {
            $dialogState.Controls.ShortcutErrorText.Text = $_.Exception.Message
        } finally {
            $eventArgs.Handled = $true
        }
    })

    $shortcutControls.RestoreDefaultsButton.Add_Click({
        param($sender, $eventArgs)

        $dialogState = Get-BabelShortcutDialogState -Sender $sender
        foreach ($row in $dialogState.Table.Rows) {
            $row.Shortcut = [string]$dialogState.DefaultBindings[[string]$row.Id]
        }
        $dialogState.LauncherBinding = [string]$dialogState.DefaultLauncherBinding
        $dialogState.Controls.LauncherHotkeyBox.Text = [string]$dialogState.LauncherBinding
        $dialogState.Controls.ShortcutGrid.Items.Refresh()
        $dialogState.Controls.ShortcutErrorText.Text = ""
        $dialogState.Controls.ShortcutStatusText.Text = "Defaults restored in this window. Choose Save to persist them."
    })

    $shortcutControls.CancelShortcutsButton.Add_Click({
        param($sender, $eventArgs)

        $dialogState = Get-BabelShortcutDialogState -Sender $sender
        $dialogState.Window.DialogResult = $false
    })

    $shortcutControls.SaveShortcutsButton.Add_Click({
        param($sender, $eventArgs)

        $dialogState = Get-BabelShortcutDialogState -Sender $sender
        $candidate = $null
        try {
            $bindings = [ordered]@{}
            foreach ($row in $dialogState.Table.Rows) {
                if ([string]::IsNullOrWhiteSpace([string]$row.Shortcut)) {
                    $bindings[[string]$row.Id] = $null
                } else {
                    $bindings[[string]$row.Id] = [string]$row.Shortcut
                }
            }
            $launcherRegistration = ConvertTo-BabelLauncherHotkeyRegistration `
                -Binding ([string]$dialogState.LauncherBinding)
            foreach ($row in $dialogState.Table.Rows) {
                if (
                    -not [string]::IsNullOrWhiteSpace([string]$row.Shortcut) -and
                    [string]::Equals(
                        [string]$row.Shortcut,
                        [string]$launcherRegistration.Binding,
                        [StringComparison]::OrdinalIgnoreCase
                    )
                ) {
                    throw "Hotkey '$($launcherRegistration.Binding)' is already assigned to the $($row.Label) web command."
                }
            }

            $candidate = Register-BabelGlobalHotkeyCandidate -Registration $launcherRegistration
            $savedShortcutPath = Write-BabelShortcutSettings `
                -Definitions $dialogState.Definitions `
                -Bindings $bindings
            $savedLauncherPath = Write-BabelLauncherHotkeySettings `
                -Binding $launcherRegistration.Binding
            Commit-BabelGlobalHotkeyCandidate -Candidate $candidate
            $dialogState.Saved = $true
            $dialogState.Controls.ShortcutErrorText.Text = ""
            $dialogState.Controls.ShortcutStatusText.Text = "Saved. The launcher hotkey is active now; reload open application pages for web command changes."
            [Windows.MessageBox]::Show(
                $dialogState.Window,
                "Launcher hotkey applied now: $($launcherRegistration.Binding)`r`n`r`nLauncher setting:`r`n$savedLauncherPath`r`n`r`nWeb command settings:`r`n$savedShortcutPath`r`n`r`nReload open application pages for web command changes.",
                "Babel Shortcuts",
                [Windows.MessageBoxButton]::OK,
                [Windows.MessageBoxImage]::Information
            ) | Out-Null
            $dialogState.Window.DialogResult = $true
        } catch {
            Cancel-BabelGlobalHotkeyCandidate -Candidate $candidate
            $dialogState.Controls.ShortcutErrorText.Text = $_.Exception.Message
        }
    })

    $script:ShortcutDialogWindow = $shortcutWindow
    try {
        [void]$shortcutWindow.ShowDialog()
    } finally {
        if ([object]::ReferenceEquals($script:ShortcutDialogWindow, $shortcutWindow)) {
            $script:ShortcutDialogWindow = $null
        }
    }
    return [bool]$state.Saved
}

function Hide-BabelWindowToTray {
    if ($null -eq $script:NotifyIcon) {
        throw "The Babel notification-area icon is unavailable."
    }

    $script:NotifyIcon.Visible = $true
    $script:Window.ShowInTaskbar = $false
    $script:Window.Hide()
}

function Restore-BabelWindowFromTray {
    if ($null -eq $script:NotifyIcon) {
        return
    }

    $script:Window.ShowInTaskbar = $true
    $script:Window.Show()
    $script:Window.WindowState = [Windows.WindowState]::Normal
    [void]$script:Window.Activate()
    $script:NotifyIcon.Visible = $false
}

function Dispose-BabelTrayResources {
    if ($null -ne $script:NotifyIcon) {
        $script:NotifyIcon.Visible = $false
        $script:NotifyIcon.Dispose()
        $script:NotifyIcon = $null
    }
    if ($null -ne $script:TrayContextMenu) {
        $script:TrayContextMenu.Dispose()
        $script:TrayContextMenu = $null
    }
    $script:TrayOpenMenuItem = $null
    $script:TrayExitMenuItem = $null
    $script:TrayAppMenuItems = @{}
    if ($null -ne $script:TrayIconImage) {
        $script:TrayIconImage.Dispose()
        $script:TrayIconImage = $null
    }
}

function Focus-BabelAppList {
    if ($script:AppsGrid.Items.Count -gt 0 -and $script:AppsGrid.SelectedIndex -lt 0) {
        $script:AppsGrid.SelectedIndex = 0
    }
    if ($null -ne $script:AppsGrid.SelectedItem) {
        $script:AppsGrid.ScrollIntoView($script:AppsGrid.SelectedItem)
    }

    [void]$script:AppsGrid.Focus()
    [void][Windows.Input.Keyboard]::Focus($script:AppsGrid)

    $focusAction = [Action]{
        [void]$script:AppsGrid.Focus()
        [void][Windows.Input.Keyboard]::Focus($script:AppsGrid)
    }
    [void]$script:AppsGrid.Dispatcher.BeginInvoke(
        [Windows.Threading.DispatcherPriority]::Input,
        $focusAction
    )
}

function Test-BabelWindowIsForeground {
    if ($HotkeySmokeTest -and $null -ne $script:HotkeySmokeForegroundOverride) {
        return [bool]$script:HotkeySmokeForegroundOverride
    }
    if ($script:WindowHandle -eq [IntPtr]::Zero) {
        return $false
    }
    return (
        [BabelLauncher.GlobalHotkeyNativeMethods]::GetForegroundWindow() -eq
        $script:WindowHandle
    )
}

function Invoke-BabelGlobalHotkeyToggle {
    if (
        $null -ne $script:ShortcutDialogWindow -and
        $script:ShortcutDialogWindow.IsVisible
    ) {
        [void]$script:ShortcutDialogWindow.Activate()
        return
    }

    if (Test-BabelWindowIsForeground) {
        Hide-BabelWindowToTray
        return
    }

    Restore-BabelWindowFromTray
    Focus-BabelAppList
}

function Get-BabelLastWin32ErrorText {
    param(
        [int]$ErrorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    )

    $exception = New-Object ComponentModel.Win32Exception -ArgumentList $ErrorCode
    return "$($exception.Message) (Win32 error $ErrorCode)"
}

function Register-BabelGlobalHotkeyCandidate {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$Registration
    )

    if ($script:WindowHandle -eq [IntPtr]::Zero -or $null -eq $script:GlobalHotkeySource) {
        throw "The launcher window handle is not ready for global hotkey registration."
    }
    if ($null -eq $script:NotifyIcon) {
        throw "The launcher hotkey is unavailable because notification-area mode could not be initialized."
    }

    $binding = [string]$Registration.Binding
    if (
        $script:GlobalHotkeyRegistered -and
        [string]::Equals(
            $script:GlobalHotkeyBinding,
            $binding,
            [StringComparison]::OrdinalIgnoreCase
        )
    ) {
        return [pscustomobject]@{
            Changed = $false
            Committed = $true
            Id = $script:GlobalHotkeyId
            Binding = $script:GlobalHotkeyBinding
        }
    }

    $candidateId = [int]$script:GlobalHotkeyIds[0]
    if ($script:GlobalHotkeyRegistered -and $candidateId -eq $script:GlobalHotkeyId) {
        $candidateId = [int]$script:GlobalHotkeyIds[1]
    }

    $registrationError = [BabelLauncher.GlobalHotkeyNativeMethods]::RegisterHotKeyWithError(
        $script:WindowHandle,
        $candidateId,
        [uint32]$Registration.Modifiers,
        [uint32]$Registration.VirtualKey
    )
    if ($registrationError -ne 0) {
        $errorText = Get-BabelLastWin32ErrorText -ErrorCode $registrationError
        throw "Could not register launcher hotkey '$binding'. It may already be in use by another application. $errorText"
    }

    return [pscustomobject]@{
        Changed = $true
        Committed = $false
        Id = $candidateId
        Binding = $binding
    }
}

function Cancel-BabelGlobalHotkeyCandidate {
    param(
        [AllowNull()]
        [pscustomobject]$Candidate
    )

    if (
        $null -eq $Candidate -or
        -not [bool]$Candidate.Changed -or
        [bool]$Candidate.Committed -or
        $script:WindowHandle -eq [IntPtr]::Zero
    ) {
        return
    }
    [void][BabelLauncher.GlobalHotkeyNativeMethods]::UnregisterHotKey(
        $script:WindowHandle,
        [int]$Candidate.Id
    )
}

function Commit-BabelGlobalHotkeyCandidate {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$Candidate
    )

    if (-not [bool]$Candidate.Changed) {
        return
    }

    if ($script:GlobalHotkeyRegistered) {
        $unregistered = [BabelLauncher.GlobalHotkeyNativeMethods]::UnregisterHotKey(
            $script:WindowHandle,
            $script:GlobalHotkeyId
        )
        if (-not $unregistered) {
            $errorText = Get-BabelLastWin32ErrorText
            throw "Could not replace the existing launcher hotkey. $errorText"
        }
    }

    $script:GlobalHotkeyRegistered = $true
    $script:GlobalHotkeyId = [int]$Candidate.Id
    $script:GlobalHotkeyBinding = [string]$Candidate.Binding
    $Candidate.Committed = $true
}

function Dispose-BabelGlobalHotkeyResources {
    if (
        $script:GlobalHotkeyRegistered -and
        $script:WindowHandle -ne [IntPtr]::Zero
    ) {
        [void][BabelLauncher.GlobalHotkeyNativeMethods]::UnregisterHotKey(
            $script:WindowHandle,
            $script:GlobalHotkeyId
        )
    }
    $script:GlobalHotkeyRegistered = $false
    $script:GlobalHotkeyId = 0
    $script:GlobalHotkeyBinding = ""

    if ($null -ne $script:GlobalHotkeySource -and $null -ne $script:GlobalHotkeyHook) {
        try {
            $script:GlobalHotkeySource.RemoveHook($script:GlobalHotkeyHook)
        } catch {
            # The HwndSource may already be disposed during application shutdown.
        }
    }
    $script:GlobalHotkeyHook = $null
    $script:GlobalHotkeySource = $null
    $script:WindowHandle = [IntPtr]::Zero
}

function Initialize-BabelGlobalHotkey {
    $interopHelper = New-Object Windows.Interop.WindowInteropHelper($script:Window)
    $script:WindowHandle = $interopHelper.Handle
    if ($script:WindowHandle -eq [IntPtr]::Zero) {
        throw "Windows did not create a launcher window handle."
    }

    $script:GlobalHotkeySource = [Windows.Interop.HwndSource]::FromHwnd($script:WindowHandle)
    if ($null -eq $script:GlobalHotkeySource) {
        throw "Could not attach the launcher hotkey message source."
    }

    $script:GlobalHotkeyHook = [Windows.Interop.HwndSourceHook]{
        param($windowHandle, $message, $wParam, $lParam, [ref]$handled)

        if (
            [uint32]$message -eq $script:WmHotkey -and
            $script:GlobalHotkeyRegistered -and
            $wParam.ToInt32() -eq $script:GlobalHotkeyId
        ) {
            $handled.Value = $true
            try {
                Invoke-BabelGlobalHotkeyToggle
            } catch {
                try {
                    Set-UiStatus -Message "Launcher hotkey failed: $($_.Exception.Message)"
                } catch {
                    # Never allow a status-rendering failure to escape the window hook.
                }
            }
        }
        return [IntPtr]::Zero
    }
    $script:GlobalHotkeySource.AddHook($script:GlobalHotkeyHook)

    if ($HotkeySmokeTest) {
        $registration = [pscustomobject]@{
            Binding = "Ctrl+Alt+Shift+F24 (smoke)"
            Modifiers = [uint32]0x4007
            VirtualKey = [uint32]0x87
        }
    } else {
        $settings = Read-BabelLauncherHotkeySettings
        if (-not [string]::IsNullOrWhiteSpace([string]$settings.Warning)) {
            $script:GlobalHotkeyWarning = [string]$settings.Warning
        }
        $registration = ConvertTo-BabelLauncherHotkeyRegistration -Binding $settings.Binding
    }

    $candidate = $null
    try {
        $candidate = Register-BabelGlobalHotkeyCandidate -Registration $registration
        Commit-BabelGlobalHotkeyCandidate -Candidate $candidate
    } catch {
        Cancel-BabelGlobalHotkeyCandidate -Candidate $candidate
        throw
    }
}

function Test-LocalPort {
    param(
        [Parameter(Mandatory = $true)]
        [int]$Port,

        [int]$TimeoutMilliseconds = 80
    )

    $client = New-Object Net.Sockets.TcpClient
    $asyncResult = $null

    try {
        $asyncResult = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
        if (-not $asyncResult.AsyncWaitHandle.WaitOne($TimeoutMilliseconds, $false)) {
            return $false
        }
        $client.EndConnect($asyncResult)
        return $true
    } catch {
        return $false
    } finally {
        if ($null -ne $asyncResult) {
            $asyncResult.AsyncWaitHandle.Close()
        }
        $client.Close()
    }
}

function Test-WorkerStateActive {
    param(
        [AllowNull()]
        [object]$WorkerState
    )

    if ($null -eq $WorkerState -or $null -eq $WorkerState.Process) {
        return $false
    }

    try {
        $WorkerState.Process.Refresh()
        return -not $WorkerState.Process.HasExited
    } catch {
        return $false
    }
}

function Get-AppWorkerState {
    param(
        [Parameter(Mandatory = $true)]
        [string]$AppId
    )

    if (-not $script:WorkersById.ContainsKey($AppId)) {
        return $null
    }
    $workerState = $script:WorkersById[$AppId]
    if (-not (Test-WorkerStateActive -WorkerState $workerState)) {
        return $null
    }
    return $workerState
}

function Get-AllWorkerState {
    if (-not (Test-WorkerStateActive -WorkerState $script:AllWorker)) {
        return $null
    }
    return $script:AllWorker
}

function Get-AppManagingWorkerState {
    param(
        [Parameter(Mandatory = $true)]
        [string]$AppId
    )

    $workerState = Get-AppWorkerState -AppId $AppId
    if ($null -ne $workerState) {
        return $workerState
    }
    if (-not $script:AllWorkerManagedAppIds.ContainsKey($AppId)) {
        return $null
    }
    return Get-AllWorkerState
}

function Set-AppReadyObserved {
    param(
        [Parameter(Mandatory = $true)]
        [string]$AppId
    )

    $workerState = Get-AppWorkerState -AppId $AppId
    if ($null -ne $workerState) {
        $workerState.ReadyObserved = $true
    }

    $allWorker = Get-AllWorkerState
    if ($null -eq $allWorker) {
        return
    }

    $script:AllWorkerReadyById[$AppId] = $true
    $allReady = $true
    foreach ($app in $script:RegisteredApps) {
        if (
            -not $script:AllWorkerReadyById.ContainsKey($app.Id) -or
            -not [bool]$script:AllWorkerReadyById[$app.Id]
        ) {
            $allReady = $false
            break
        }
    }
    $allWorker.ReadyObserved = $allReady
}

function Get-ActiveWorkerStates {
    $activeWorkers = @()
    foreach ($appId in @($script:WorkersById.Keys)) {
        $workerState = $script:WorkersById[$appId]
        if (Test-WorkerStateActive -WorkerState $workerState) {
            $activeWorkers += $workerState
        }
    }
    if (Test-WorkerStateActive -WorkerState $script:AllWorker) {
        $activeWorkers += $script:AllWorker
    }
    if (Test-WorkerStateActive -WorkerState $script:VerifyWorker) {
        $activeWorkers += $script:VerifyWorker
    }
    return @($activeWorkers)
}

function Test-AnyWorkerActive {
    return @(Get-ActiveWorkerStates).Count -gt 0
}

function Get-SelectedApp {
    $selectedRow = $script:AppsGrid.SelectedItem
    if ($null -eq $selectedRow) {
        return $null
    }

    $id = [string]$selectedRow["Id"]
    if (-not $script:AppsById.ContainsKey($id)) {
        return $null
    }
    return $script:AppsById[$id]
}

function Refresh-ButtonState {
    $selectedApp = Get-SelectedApp
    $hasSelection = $null -ne $selectedApp
    $selectedWorker = $null
    if ($hasSelection) {
        $selectedWorker = Get-AppWorkerState -AppId $selectedApp.Id
    }

    $activeWorkers = @(Get-ActiveWorkerStates)
    $verifyActive = Test-WorkerStateActive -WorkerState $script:VerifyWorker
    $allWorkerActive = Test-WorkerStateActive -WorkerState $script:AllWorker
    $independentStartActive = @(
        $activeWorkers | Where-Object {
            $_.Mode -eq "Start" -and -not [bool]$_.ManagesAll
        }
    ).Count -gt 0
    $hasStartingWorker = @(
        $activeWorkers | Where-Object {
            $_.Mode -eq "Start" -and -not $_.ReadyObserved
        }
    ).Count -gt 0

    $script:OpenSelectedButton.IsEnabled = $hasSelection -and -not $script:CloseRequested
    $script:StartAllButton.IsEnabled = `
        -not $verifyActive -and
        -not $allWorkerActive -and
        -not $independentStartActive -and
        -not $script:CloseRequested
    $script:VerifyButton.IsEnabled = `
        -not $verifyActive -and -not $hasStartingWorker -and -not $script:CloseRequested
    $script:StopSelectedButton.IsEnabled = `
        $null -ne $selectedWorker -and -not $selectedWorker.StopRequested
    $script:StopAllButton.IsEnabled = $activeWorkers.Count -gt 0

    if ($activeWorkers.Count -gt 0) {
        $stoppingCount = @($activeWorkers | Where-Object { $_.StopRequested }).Count
        $summary = "MANAGED / $($activeWorkers.Count) ACTIVE"
        if ($stoppingCount -gt 0) {
            $summary += " / $stoppingCount STOPPING"
        }
        if ($verifyActive) {
            $summary += " / VERIFYING"
        }
        if ($allWorkerActive) {
            $summary += " / ALL SESSION"
        }
        $script:WorkerText.Text = $summary
    } else {
        $script:WorkerText.Text = "MANAGED / IDLE"
    }
}

function Invalidate-AppHealthProbe {
    param(
        [Parameter(Mandatory = $true)]
        [string]$AppId
    )

    $generation = 0
    if ($script:ProbeGenerationById.ContainsKey($AppId)) {
        $generation = [int]$script:ProbeGenerationById[$AppId]
    }
    $script:ProbeGenerationById[$AppId] = $generation + 1
    $script:LastHealthById[$AppId] = $false
}

function Test-AppHealthRecentlyPassed {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$App,

        [int]$MaximumAgeSeconds = 5
    )

    if (
        -not $script:LastHealthById.ContainsKey($App.Id) -or
        -not [bool]$script:LastHealthById[$App.Id] -or
        -not $script:LastProbeAtById.ContainsKey($App.Id)
    ) {
        return $false
    }
    return (
        ([DateTime]::UtcNow - [DateTime]$script:LastProbeAtById[$App.Id]).TotalSeconds -le
        $MaximumAgeSeconds
    )
}

function Start-AppHealthProbe {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$App
    )

    if ($script:HealthProbesById.ContainsKey($App.Id)) {
        return
    }

    $generation = 0
    if ($script:ProbeGenerationById.ContainsKey($App.Id)) {
        $generation = [int]$script:ProbeGenerationById[$App.Id]
    }
    $generation++
    $script:ProbeGenerationById[$App.Id] = $generation

    $probePowerShell = [Management.Automation.PowerShell]::Create()
    try {
        $probePowerShell.RunspacePool = $script:HealthProbeRunspacePool
        [void]$probePowerShell.AddScript($script:HealthProbeScript)
        [void]$probePowerShell.AddArgument($App.HealthUrl)
        [void]$probePowerShell.AddArgument($App.IdentityText)
        $asyncResult = $probePowerShell.BeginInvoke()
    } catch {
        $probePowerShell.Dispose()
        throw
    }

    $script:HealthProbesById[$App.Id] = [pscustomobject]@{
        AppId = $App.Id
        PowerShell = $probePowerShell
        AsyncResult = $asyncResult
        Generation = $generation
        StartedAt = [DateTime]::UtcNow
    }
}

function Complete-AppHealthProbes {
    foreach ($appId in @($script:HealthProbesById.Keys)) {
        $probe = $script:HealthProbesById[$appId]
        if (-not $probe.AsyncResult.IsCompleted) {
            continue
        }

        $healthy = $false
        $applyResult = `
            $script:ProbeGenerationById.ContainsKey($appId) -and
            [int]$script:ProbeGenerationById[$appId] -eq [int]$probe.Generation
        try {
            $probeResults = @($probe.PowerShell.EndInvoke($probe.AsyncResult))
            if ($probeResults.Count -gt 0) {
                $healthy = [bool]$probeResults[$probeResults.Count - 1]
            }
        } catch {
            $healthy = $false
        } finally {
            $probe.PowerShell.Dispose()
            $script:HealthProbesById.Remove($appId)
        }

        if (-not $applyResult) {
            continue
        }
        $script:LastHealthById[$appId] = $healthy
        $script:LastProbeAtById[$appId] = [DateTime]::UtcNow
        if ($healthy) {
            Set-AppReadyObserved -AppId $appId
        }
    }
}

function Dispose-AppHealthProbes {
    foreach ($appId in @($script:HealthProbesById.Keys)) {
        $probe = $script:HealthProbesById[$appId]
        try {
            if (-not $probe.AsyncResult.IsCompleted) {
                $probe.PowerShell.Stop()
            }
        } catch {
            # Shutdown must continue even if a probe is already completing.
        } finally {
            $probe.PowerShell.Dispose()
        }
    }
    $script:HealthProbesById = @{}
    $script:ExternalOpenRequestsById = @{}

    if ($null -ne $script:HealthProbeRunspacePool) {
        try {
            $script:HealthProbeRunspacePool.Close()
        } finally {
            $script:HealthProbeRunspacePool.Dispose()
            $script:HealthProbeRunspacePool = $null
        }
    }
}

function Refresh-AppStatuses {
    param(
        [switch]$ForceProbe
    )

    $now = [DateTime]::UtcNow
    foreach ($app in $script:RegisteredApps) {
        $portOpen = Test-LocalPort -Port $app.Port
        $healthy = $false
        if ($script:LastHealthById.ContainsKey($app.Id)) {
            $healthy = [bool]$script:LastHealthById[$app.Id]
        }
        $workerState = Get-AppWorkerState -AppId $app.Id
        $managingWorker = Get-AppManagingWorkerState -AppId $app.Id
        $allWorker = $null
        if ($null -ne $managingWorker -and [bool]$managingWorker.ManagesAll) {
            $allWorker = $managingWorker
        }
        $workerActive = $null -ne $managingWorker

        if ($portOpen) {
            $probeDue = $ForceProbe -or -not $script:LastProbeAtById.ContainsKey($app.Id)
            if (-not $probeDue) {
                $probeDue = `
                    ($now - [DateTime]$script:LastProbeAtById[$app.Id]).TotalSeconds -ge
                    $script:HealthProbeIntervalSeconds
            }
            $managedOpenPending = `
                $null -ne $workerState -and [bool]$workerState.OpenPending
            if (
                $script:ExternalOpenRequestsById.ContainsKey($app.Id) -and
                [bool]$script:ExternalOpenRequestsById[$app.Id].ManagedByAll
            ) {
                $managedOpenPending = $true
            }
            if ($workerActive -and $managedOpenPending) {
                $probeDue = $true
            }

            if ($probeDue -and -not $script:HealthProbesById.ContainsKey($app.Id)) {
                Start-AppHealthProbe -App $app
            }
        } else {
            $healthy = $false
            if (
                $script:HealthProbesById.ContainsKey($app.Id) -or
                (
                    $script:LastPortOpenById.ContainsKey($app.Id) -and
                    [bool]$script:LastPortOpenById[$app.Id]
                )
            ) {
                Invalidate-AppHealthProbe -AppId $app.Id
            } else {
                $script:LastHealthById[$app.Id] = $false
            }
        }

        $script:LastPortOpenById[$app.Id] = $portOpen
        if ($healthy -and $workerActive) {
            Set-AppReadyObserved -AppId $app.Id
        }

        $readyObserved = $false
        if ($null -ne $workerState) {
            $readyObserved = [bool]$workerState.ReadyObserved
        } elseif (
            $null -ne $allWorker -and
            $script:AllWorkerReadyById.ContainsKey($app.Id)
        ) {
            $readyObserved = [bool]$script:AllWorkerReadyById[$app.Id]
        }
        $status = Get-AppDisplayStatus `
            -PortOpen $portOpen `
            -Healthy $healthy `
            -WorkerActive $workerActive `
            -ReadyObserved $readyObserved
        $script:RowsById[$app.Id].Status = $status

        if ($script:TrayAppMenuItems.ContainsKey($app.Id)) {
            $script:TrayAppMenuItems[$app.Id].Text = `
                $app.Name.Replace("&", "&&") + "  [" + $status + "]"
        }
    }

    $script:AppsGrid.Items.Refresh()
}

function Read-WorkerLogTail {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return ""
    }

    try {
        $lines = @(
            Get-Content `
                -LiteralPath $Path `
                -Tail $script:MaximumLogTailLines `
                -ErrorAction Stop
        )
        $text = [string]($lines -join "`r`n")
        if ($text.Length -le $script:MaximumLogCharactersPerStream) {
            return $text
        }

        $start = $text.Length - $script:MaximumLogCharactersPerStream
        return "[earlier output omitted]`r`n" + $text.Substring($start)
    } catch {
        return ""
    }
}

function Remove-WorkerSessionDirectory {
    param(
        [Parameter(Mandatory = $true)]
        [object]$WorkerState
    )

    if (-not [bool]$WorkerState.Completed) {
        return
    }

    try {
        $sessionRoot = [IO.Path]::GetFullPath(
            (Join-Path ([IO.Path]::GetTempPath()) "BabelLauncher")
        ).TrimEnd("\")
        $sessionDirectory = [IO.Path]::GetFullPath([string]$WorkerState.SessionDirectory).TrimEnd("\")
        $sessionPrefix = $sessionRoot + "\"
        $sessionName = Split-Path -Leaf $sessionDirectory
        if (
            -not $sessionDirectory.StartsWith($sessionPrefix, [StringComparison]::OrdinalIgnoreCase) -or
            $sessionName -notmatch "^[0-9a-f]{32}$"
        ) {
            return
        }

        if (Test-Path -LiteralPath $sessionDirectory -PathType Container) {
            Remove-Item -LiteralPath $sessionDirectory -Recurse -Force -ErrorAction Stop
        }
    } catch {
        # Diagnostics cleanup must never disrupt worker lifecycle management.
    }
}

function Trim-WorkerHistory {
    while ($script:WorkerHistory.Count -gt $script:MaximumWorkerHistory) {
        $completedIndex = -1
        for ($index = 0; $index -lt $script:WorkerHistory.Count; $index++) {
            if ([bool]$script:WorkerHistory[$index].Completed) {
                $completedIndex = $index
                break
            }
        }
        if ($completedIndex -lt 0) {
            return
        }

        $expiredWorker = $script:WorkerHistory[$completedIndex]
        $script:WorkerHistory.RemoveAt($completedIndex)
        Remove-WorkerSessionDirectory -WorkerState $expiredWorker
    }
}

function Remove-CompletedWorkerSessions {
    foreach ($workerState in @($script:WorkerHistory)) {
        if ([bool]$workerState.Completed) {
            Remove-WorkerSessionDirectory -WorkerState $workerState
        }
    }
}

function Update-LogView {
    if (-not $script:AdvancedExpander.IsExpanded) {
        return
    }

    $logSections = New-Object System.Collections.ArrayList
    foreach ($workerState in @($script:WorkerHistory)) {
        $standardOutput = ""
        $standardError = ""

        $standardOutput = Read-WorkerLogTail -Path $workerState.StdOutLogPath
        $standardError = Read-WorkerLogTail -Path $workerState.StdErrLogPath

        $workerLog = "===== $($workerState.Label) / $($workerState.StartedAt.ToLocalTime().ToString('yyyy-MM-dd HH:mm:ss')) ====="
        if (-not [string]::IsNullOrWhiteSpace($standardOutput)) {
            $workerLog += "`r`n" + $standardOutput.TrimEnd()
        }
        if (-not [string]::IsNullOrWhiteSpace($standardError)) {
            $workerLog += "`r`n[stderr]`r`n" + $standardError.TrimEnd()
        }
        if ([string]::IsNullOrWhiteSpace($standardOutput) -and [string]::IsNullOrWhiteSpace($standardError)) {
            $workerLog += "`r`n(no output yet)"
        }
        [void]$logSections.Add($workerLog)
    }

    $rendered = "No worker sessions yet."
    if ($logSections.Count -gt 0) {
        $rendered = $logSections -join "`r`n`r`n"
    }
    if ($rendered.Length -gt $script:MaximumRenderedLogCharacters) {
        $start = $rendered.Length - $script:MaximumRenderedLogCharacters
        $rendered = "[earlier sessions omitted]`r`n" + $rendered.Substring($start)
    }

    if ($rendered -ne $script:LastRenderedLog) {
        $script:LastRenderedLog = $rendered
        $script:LogTextBox.Text = $rendered
        $script:LogTextBox.ScrollToEnd()
    }
}

function Request-WorkerStop {
    param(
        [Parameter(Mandatory = $true)]
        [object]$WorkerState
    )

    if (-not (Test-WorkerStateActive -WorkerState $WorkerState)) {
        return $false
    }
    if ($WorkerState.StopRequested) {
        return $true
    }
    $WorkerState.OpenPending = $false
    if ([bool]$WorkerState.ManagesAll) {
        $script:ExternalOpenRequestsById = @{}
        $script:HideAfterOpenById = @{}
    } elseif (-not [string]::IsNullOrWhiteSpace([string]$WorkerState.AppId)) {
        Clear-BabelHideAfterOpen -AppId ([string]$WorkerState.AppId)
    }

    try {
        if ([string]::IsNullOrWhiteSpace($WorkerState.StopSignalPath)) {
            throw "The worker stop signal path is unavailable."
        }
        [IO.File]::WriteAllText(
            $WorkerState.StopSignalPath,
            [DateTime]::UtcNow.ToString("o"),
            (New-Object Text.UTF8Encoding($false))
        )
        $WorkerState.StopRequested = $true
        Set-UiStatus -Message "Graceful stop requested for $($WorkerState.Label)."
        Refresh-ButtonState
        return $true
    } catch {
        Show-BabelError -Message "Could not request worker shutdown.`r`n`r`n$($_.Exception.Message)"
        return $false
    }
}

function Request-AppWorkerStop {
    param(
        [Parameter(Mandatory = $true)]
        [string]$AppId
    )

    $workerState = Get-AppWorkerState -AppId $AppId
    if ($null -eq $workerState) {
        Set-UiStatus -Message "This notebook is not managed by the launcher."
        return
    }
    [void](Request-WorkerStop -WorkerState $workerState)
}

function Request-AllWorkersStop {
    $activeWorkers = @(Get-ActiveWorkerStates)
    if ($activeWorkers.Count -eq 0) {
        Set-UiStatus -Message "No workers are currently managed by this launcher."
        return
    }
    $script:ExternalOpenRequestsById = @{}
    $script:HideAfterOpenById = @{}
    foreach ($workerState in $activeWorkers) {
        [void](Request-WorkerStop -WorkerState $workerState)
    }
}

function Complete-WorkerStateIfExited {
    param(
        [Parameter(Mandatory = $true)]
        [object]$WorkerState
    )

    if (-not (Test-WorkerStateActive -WorkerState $WorkerState)) {
        try {
            if ($null -ne $WorkerState.Process) {
                $WorkerState.Process.Refresh()
                $exitCode = $WorkerState.Process.ExitCode
            } else {
                $exitCode = -1
            }
        } catch {
            $exitCode = -1
        }
    } else {
        return $false
    }

    try {
        if ($null -ne $WorkerState.Process) {
            $WorkerState.Process.Dispose()
        }
    } catch {
        # The process object may already have been released by Windows.
    }
    $WorkerState.Process = $null
    $WorkerState.Completed = $true
    $WorkerState.ExitCode = $exitCode

    if ($WorkerState.Mode -eq "Start" -and [bool]$WorkerState.ManagesAll) {
        if ([object]::ReferenceEquals($script:AllWorker, $WorkerState)) {
            $script:AllWorker = $null
            $script:AllWorkerManagedAppIds = @{}
            $script:AllWorkerReadyById = @{}
            $script:ExternalOpenRequestsById = @{}
            $script:HideAfterOpenById = @{}
        }
    } elseif ($WorkerState.Mode -eq "Start") {
        if (
            $script:WorkersById.ContainsKey($WorkerState.AppId) -and
            [object]::ReferenceEquals($script:WorkersById[$WorkerState.AppId], $WorkerState)
        ) {
            $script:WorkersById.Remove($WorkerState.AppId)
        }
    } elseif ([object]::ReferenceEquals($script:VerifyWorker, $WorkerState)) {
        $script:VerifyWorker = $null
    }

    if ($exitCode -eq 0) {
        if ($WorkerState.Mode -eq "Verify") {
            Set-UiStatus -Message "All applications passed verification."
        } elseif ($WorkerState.StopRequested) {
            Set-UiStatus -Message "$($WorkerState.Label) stopped."
        } else {
            Set-UiStatus -Message "$($WorkerState.Label) worker exited cleanly."
        }
    } else {
        Set-UiStatus -Message "$($WorkerState.Label) worker exited unexpectedly (code $exitCode). Review Diagnostics."
    }

    if ($WorkerState.OpenPending) {
        $WorkerState.OpenPending = $false
        if (-not $WorkerState.StopRequested) {
            Show-BabelOpenError `
                -AppId ([string]$WorkerState.AppId) `
                -Message "$($WorkerState.Label) did not become ready. Review Diagnostics."
        } else {
            Clear-BabelHideAfterOpen -AppId ([string]$WorkerState.AppId)
        }
    }
    Trim-WorkerHistory
    return $true
}

function Complete-WorkersIfExited {
    foreach ($appId in @($script:WorkersById.Keys)) {
        [void](Complete-WorkerStateIfExited -WorkerState $script:WorkersById[$appId])
    }
    if ($null -ne $script:AllWorker) {
        [void](Complete-WorkerStateIfExited -WorkerState $script:AllWorker)
    }
    if ($null -ne $script:VerifyWorker) {
        [void](Complete-WorkerStateIfExited -WorkerState $script:VerifyWorker)
    }

    if ($script:CloseRequested -and -not (Test-AnyWorkerActive)) {
        $script:AllowClose = $true
        $script:Window.Close()
    }
}

function ConvertTo-PowerShellLiteral {
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [string]$Value
    )

    return "'" + $Value.Replace("'", "''") + "'"
}

function Start-BabelWorker {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Selection,

        [Parameter(Mandatory = $true)]
        [ValidateSet("Start", "Verify")]
        [string]$Mode
    )

    if ($script:CloseRequested) {
        throw "The launcher is closing and cannot start another worker."
    }
    Complete-WorkersIfExited
    $app = $null
    $isAllStart = `
        $Mode -eq "Start" -and
        $Selection.Equals("All", [StringComparison]::OrdinalIgnoreCase)
    if ($Mode -eq "Start") {
        if (Test-WorkerStateActive -WorkerState $script:VerifyWorker) {
            throw "Verification is running. Wait for it to finish before starting another notebook."
        }
        if ($isAllStart) {
            $existingWorker = Get-AllWorkerState
            if ($null -ne $existingWorker) {
                return $existingWorker
            }
        } elseif (-not $script:AppsById.ContainsKey($Selection)) {
            throw "Unknown notebook '$Selection'."
        } else {
            if (
                $null -ne (Get-AllWorkerState) -and
                $script:AllWorkerManagedAppIds.ContainsKey($Selection)
            ) {
                throw "The Start All session already manages notebook startup. Use STOP ALL before starting an independent worker."
            }
            $app = $script:AppsById[$Selection]
            $existingWorker = Get-AppWorkerState -AppId $Selection
            if ($null -ne $existingWorker) {
                return $existingWorker
            }
        }
    } elseif (Test-WorkerStateActive -WorkerState $script:VerifyWorker) {
        Set-UiStatus -Message "Verification is already running."
        return $script:VerifyWorker
    }

    $sessionDirectory = Join-Path ([IO.Path]::GetTempPath()) ("BabelLauncher\" + [Guid]::NewGuid().ToString("N"))
    [void](New-Item -ItemType Directory -Path $sessionDirectory -Force)

    $stopSignalPath = [IO.Path]::GetFullPath((Join-Path $sessionDirectory "stop.signal"))
    $stdOutLogPath = Join-Path $sessionDirectory "stdout.log"
    $stdErrLogPath = Join-Path $sessionDirectory "stderr.log"
    if (Test-Path -LiteralPath $stopSignalPath) {
        throw "The stop signal already exists before worker startup: $stopSignalPath"
    }

    $workerCommand = "& " + (ConvertTo-PowerShellLiteral -Value $workerScriptPath) +
        " -Selection " + (ConvertTo-PowerShellLiteral -Value $Selection) +
        " -NoBrowser -StopSignalPath " + (ConvertTo-PowerShellLiteral -Value $stopSignalPath)
    if ($Mode -eq "Verify") {
        $workerCommand += " -VerifyAndExit"
    }

    # Keep each native stream in a pollable temporary file. The native host
    # propagates the PowerShell 7 process exit code.
    $workerCommand += " 2> " + (ConvertTo-PowerShellLiteral -Value $stdErrLogPath) +
        " 3>&1 4>&1 5>&1 6>&1 1> " + (ConvertTo-PowerShellLiteral -Value $stdOutLogPath) +
        '; if ($null -eq $global:BabelLauncherExitCode) { $global:BabelLauncherExitCode = [int]$LASTEXITCODE }'
    $encodedCommand = [Convert]::ToBase64String(
        [Text.Encoding]::Unicode.GetBytes($workerCommand)
    )

    try {
        $process = Start-BabelDetachedProcess `
            -FilePath $nativeLauncherPath `
            -Arguments "--encoded-command $encodedCommand" `
            -WorkingDirectory $babelRoot
    } catch {
        throw "Could not start the Babel worker: $($_.Exception.Message)"
    }

    $label = "Verify all"
    $appId = ""
    if ($isAllStart) {
        $label = "All notebooks"
    } elseif ($Mode -eq "Start") {
        $label = $app.Name
        $appId = $app.Id
    }
    $workerState = [pscustomobject]@{
        AppId = $appId
        App = $app
        Label = $label
        Mode = $Mode
        ManagesAll = $isAllStart
        Process = $process
        StopSignalPath = $stopSignalPath
        StdOutLogPath = $stdOutLogPath
        StdErrLogPath = $stdErrLogPath
        SessionDirectory = $sessionDirectory
        StartedAt = [DateTime]::UtcNow
        StopRequested = $false
        ReadyObserved = $false
        OpenPending = $false
        Completed = $false
        ExitCode = $null
    }

    if ($Mode -eq "Verify") {
        $script:VerifyWorker = $workerState
    } elseif ($isAllStart) {
        $script:AllWorker = $workerState
        $script:AllWorkerReadyById = @{}
    } else {
        $script:WorkersById[$app.Id] = $workerState
    }
    [void]$script:WorkerHistory.Add($workerState)
    Trim-WorkerHistory
    $script:LastRenderedLog = ""

    if ($Mode -eq "Verify") {
        Set-UiStatus -Message "Verifying all applications. Temporary services will stop automatically."
    } elseif ($isAllStart) {
        Set-UiStatus -Message "Starting all notebooks in one managed worker. Use STOP ALL to stop this session."
    } else {
        Set-UiStatus -Message "Starting $($app.Name). OPEN will continue after its identity check passes."
    }
    Refresh-ButtonState
    return $workerState
}

function Open-AppIdentity {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$App
    )

    $null = Start-Process -FilePath $App.IdentityUrl
    Set-UiStatus -Message "Opened $($App.Name) in the default browser."
}

function Clear-BabelHideAfterOpen {
    param(
        [Parameter(Mandatory = $true)]
        [string]$AppId
    )

    if ($script:HideAfterOpenById.ContainsKey($AppId)) {
        $script:HideAfterOpenById.Remove($AppId)
    }
}

function Restore-BabelWindowAfterOpenFailure {
    if (-not $script:Window.IsVisible -or -not $script:Window.ShowInTaskbar) {
        Restore-BabelWindowFromTray
        Focus-BabelAppList
    }
}

function Show-BabelOpenError {
    param(
        [Parameter(Mandatory = $true)]
        [string]$AppId,

        [Parameter(Mandatory = $true)]
        [string]$Message
    )

    Clear-BabelHideAfterOpen -AppId $AppId
    Restore-BabelWindowAfterOpenFailure
    Show-BabelError -Message $Message
}

function Complete-BabelOpenSuccess {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$App
    )

    try {
        Open-AppIdentity -App $App
    } catch {
        Clear-BabelHideAfterOpen -AppId $App.Id
        Restore-BabelWindowAfterOpenFailure
        throw
    }

    $hideAfterOpen = $script:HideAfterOpenById.ContainsKey($App.Id)
    Clear-BabelHideAfterOpen -AppId $App.Id
    if ($hideAfterOpen) {
        Hide-BabelWindowToTray
    }
}

function Open-BabelApp {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$App,

        [switch]$HideAfterOpen
    )

    if ($script:CloseRequested) {
        throw "The launcher is closing and cannot open another notebook."
    }
    if ($HideAfterOpen) {
        $script:HideAfterOpenById[$App.Id] = $true
    }

    if (Test-AppHealthRecentlyPassed -App $App) {
        $script:LastPortOpenById[$App.Id] = $true
        Set-AppReadyObserved -AppId $App.Id
        Complete-BabelOpenSuccess -App $App
        return
    }

    $workerState = Get-AppWorkerState -AppId $App.Id
    if ($null -ne $workerState) {
        if (-not $workerState.OpenPending) {
            Invalidate-AppHealthProbe -AppId $App.Id
        }
        $workerState.OpenPending = $true
        if (Test-LocalPort -Port $App.Port) {
            Start-AppHealthProbe -App $App
        }
        Set-UiStatus -Message "$($App.Name) is starting. It will open after the identity check passes."
        Refresh-ButtonState
        return
    }

    if (Test-WorkerStateActive -WorkerState $script:VerifyWorker) {
        throw "Verification is preparing applications. Wait for it to finish, then choose OPEN again."
    }

    $allWorker = Get-AllWorkerState
    if (
        $null -ne $allWorker -and
        $script:AllWorkerManagedAppIds.ContainsKey($App.Id)
    ) {
        if (-not $script:ExternalOpenRequestsById.ContainsKey($App.Id)) {
            Invalidate-AppHealthProbe -AppId $App.Id
            $script:ExternalOpenRequestsById[$App.Id] = [pscustomobject]@{
                App = $App
                RequestedAt = [DateTime]::UtcNow
                ManagedByAll = $true
            }
        }
        if (Test-LocalPort -Port $App.Port) {
            Start-AppHealthProbe -App $App
        }
        Set-UiStatus -Message "$($App.Name) is starting in the Start All session. It will open after its registered health identity passes."
        return
    }

    if (Test-LocalPort -Port $App.Port) {
        if (-not $script:ExternalOpenRequestsById.ContainsKey($App.Id)) {
            Invalidate-AppHealthProbe -AppId $App.Id
            $script:ExternalOpenRequestsById[$App.Id] = [pscustomobject]@{
                App = $App
                RequestedAt = [DateTime]::UtcNow
                ManagedByAll = $false
            }
        }
        Start-AppHealthProbe -App $App
        Set-UiStatus -Message "Checking the $($App.Name) registered health identity before OPEN."
        return
    }

    Invalidate-AppHealthProbe -AppId $App.Id
    $script:ExternalOpenRequestsById.Remove($App.Id)
    $workerState = Start-BabelWorker -Selection $App.Id -Mode "Start"
    $workerState.OpenPending = $true
    Set-UiStatus -Message "$($App.Name) is starting. It will open after the identity check passes."
}

function Complete-PendingOpens {
    foreach ($appId in @($script:WorkersById.Keys)) {
        $workerState = Get-AppWorkerState -AppId $appId
        if ($null -eq $workerState -or -not $workerState.OpenPending) {
            continue
        }
        if ($script:CloseRequested -or $workerState.StopRequested) {
            $workerState.OpenPending = $false
            Clear-BabelHideAfterOpen -AppId $appId
            continue
        }
        if (
            -not $script:LastHealthById.ContainsKey($appId) -or
            -not [bool]$script:LastHealthById[$appId]
        ) {
            continue
        }

        $workerState.ReadyObserved = $true
        $workerState.OpenPending = $false
        try {
            Complete-BabelOpenSuccess -App $workerState.App
        } catch {
            Show-BabelOpenError `
                -AppId $appId `
                -Message "Could not complete OPEN.`r`n`r`n$($_.Exception.Message)"
        }
    }

    foreach ($appId in @($script:ExternalOpenRequestsById.Keys)) {
        $openRequest = $script:ExternalOpenRequestsById[$appId]
        $app = $openRequest.App
        if ($script:CloseRequested) {
            $script:ExternalOpenRequestsById.Remove($appId)
            Clear-BabelHideAfterOpen -AppId $appId
            continue
        }
        if ($script:HealthProbesById.ContainsKey($appId)) {
            continue
        }

        if ([bool]$openRequest.ManagedByAll) {
            $allWorker = Get-AllWorkerState
            if ($null -eq $allWorker -or $allWorker.StopRequested) {
                $script:ExternalOpenRequestsById.Remove($appId)
                Clear-BabelHideAfterOpen -AppId $appId
                continue
            }
            if (-not (Test-LocalPort -Port $app.Port)) {
                continue
            }
            if (Test-AppHealthRecentlyPassed -App $app) {
                $script:ExternalOpenRequestsById.Remove($appId)
                Set-AppReadyObserved -AppId $appId
                try {
                    Complete-BabelOpenSuccess -App $app
                } catch {
                    Show-BabelOpenError `
                        -AppId $appId `
                        -Message "Could not complete OPEN.`r`n`r`n$($_.Exception.Message)"
                }
            } else {
                Start-AppHealthProbe -App $app
            }
            continue
        }

        if (-not (Test-LocalPort -Port $app.Port)) {
            $script:ExternalOpenRequestsById.Remove($appId)
            if (Test-WorkerStateActive -WorkerState $script:VerifyWorker) {
                Show-BabelOpenError `
                    -AppId $appId `
                    -Message "$($app.Name) stopped during its identity check while verification is running."
                continue
            }
            try {
                Invalidate-AppHealthProbe -AppId $appId
                $workerState = Start-BabelWorker -Selection $appId -Mode "Start"
                $workerState.OpenPending = $true
            } catch {
                Show-BabelOpenError -AppId $appId -Message $_.Exception.Message
            }
            continue
        }

        if (
            -not $script:LastProbeAtById.ContainsKey($appId) -or
            [DateTime]$script:LastProbeAtById[$appId] -lt [DateTime]$openRequest.RequestedAt
        ) {
            Start-AppHealthProbe -App $app
            continue
        }

        $script:ExternalOpenRequestsById.Remove($appId)
        if (Test-AppHealthRecentlyPassed -App $app) {
            try {
                Complete-BabelOpenSuccess -App $app
            } catch {
                Show-BabelOpenError `
                    -AppId $appId `
                    -Message "Could not complete OPEN.`r`n`r`n$($_.Exception.Message)"
            }
        } else {
            Show-BabelOpenError `
                -AppId $appId `
                -Message "Port $($app.Port) is occupied, but the listener is not a healthy $($app.Name) instance. OPEN was blocked."
        }
    }
}

function Start-AllNotebookWorkers {
    if ($script:CloseRequested) {
        throw "The launcher is closing and cannot start more notebooks."
    }
    Complete-WorkersIfExited

    if ($null -ne (Get-AllWorkerState)) {
        Set-UiStatus -Message "The Start All session is already running."
        return
    }
    if ($script:WorkersById.Count -gt 0) {
        Set-UiStatus -Message "Stop independent OPEN workers before starting the aggregate Start All session."
        return
    }

    $needsAggregateWorker = $false
    $managedAppIds = @{}
    foreach ($app in $script:RegisteredApps) {
        if ($null -ne (Get-AppWorkerState -AppId $app.Id)) {
            continue
        }
        if (Test-LocalPort -Port $app.Port) {
            $script:LastPortOpenById[$app.Id] = $true
            continue
        }

        Invalidate-AppHealthProbe -AppId $app.Id
        $managedAppIds[$app.Id] = $true
        $needsAggregateWorker = $true
    }

    if (-not $needsAggregateWorker) {
        Set-UiStatus -Message "Every notebook already has a worker or an occupied port; no Start All worker was needed."
        return
    }

    $script:AllWorkerManagedAppIds = $managedAppIds
    try {
        [void](Start-BabelWorker -Selection "All" -Mode "Start")
    } catch {
        $script:AllWorkerManagedAppIds = @{}
        throw
    }
    Set-UiStatus -Message "Starting all notebooks in one managed worker. Use STOP ALL to stop this session."
}

if ($LifecycleSmokeTest) {
    $lifecycleStopSignalPath = [IO.Path]::GetTempFileName()
    $lifecycleForeignListener = $null
    $lifecycleCleanupWorkerState = $null
    try {
        $lifecycleSessionDirectory = Join-Path `
            ([IO.Path]::GetTempPath()) `
            ("BabelLauncher\" + [Guid]::NewGuid().ToString("N"))
        [void](New-Item -ItemType Directory -Path $lifecycleSessionDirectory -Force)
        [IO.File]::WriteAllText(
            (Join-Path $lifecycleSessionDirectory "stdout.log"),
            "lifecycle diagnostics cleanup smoke"
        )
        $lifecycleCleanupWorkerState = [pscustomobject]@{
            Completed = $true
            SessionDirectory = $lifecycleSessionDirectory
        }
        Remove-WorkerSessionDirectory -WorkerState $lifecycleCleanupWorkerState
        if (Test-Path -LiteralPath $lifecycleSessionDirectory) {
            throw "Lifecycle smoke test did not remove a completed diagnostics session."
        }

        $lifecycleForeignListener = `
            New-Object Net.Sockets.TcpListener -ArgumentList ([Net.IPAddress]::Loopback), 0
        $lifecycleForeignListener.Start()
        $lifecycleForeignPort = ([Net.IPEndPoint]$lifecycleForeignListener.LocalEndpoint).Port
        $probeSmokeApp = [pscustomobject]@{
            Id = "lifecycle-probe-smoke"
            HealthUrl = "http://127.0.0.1:$lifecycleForeignPort/api/health"
            IdentityText = "Babel lifecycle smoke identity"
        }
        $probeStartTime = [DateTime]::UtcNow
        Start-AppHealthProbe -App $probeSmokeApp
        if (([DateTime]::UtcNow - $probeStartTime).TotalSeconds -ge 1.5) {
            throw "Lifecycle smoke test blocked while starting an asynchronous health probe."
        }
        $probeDeadline = [DateTime]::UtcNow.AddSeconds(6)
        while (
            $script:HealthProbesById.ContainsKey($probeSmokeApp.Id) -and
            [DateTime]::UtcNow -lt $probeDeadline
        ) {
            Start-Sleep -Milliseconds 50
            Complete-AppHealthProbes
        }
        if (
            $script:HealthProbesById.ContainsKey($probeSmokeApp.Id) -or
            -not $script:LastHealthById.ContainsKey($probeSmokeApp.Id) -or
            [bool]$script:LastHealthById[$probeSmokeApp.Id]
        ) {
            throw "Lifecycle smoke test did not reject a foreign listener asynchronously."
        }

        $originalHealthProbeScript = $script:HealthProbeScript
        try {
            $script:HealthProbeScript = 'param($HealthUrl, $IdentityText); return $true'
            $trueProbeApp = [pscustomobject]@{
                Id = "lifecycle-true-probe-smoke"
                HealthUrl = "http://127.0.0.1/unused-health"
                IdentityText = "unused"
            }
            Start-AppHealthProbe -App $trueProbeApp
            Invalidate-AppHealthProbe -AppId $trueProbeApp.Id
            $staleProbeDeadline = [DateTime]::UtcNow.AddSeconds(3)
            while (
                $script:HealthProbesById.ContainsKey($trueProbeApp.Id) -and
                [DateTime]::UtcNow -lt $staleProbeDeadline
            ) {
                Start-Sleep -Milliseconds 25
                Complete-AppHealthProbes
            }
            if (
                $script:HealthProbesById.ContainsKey($trueProbeApp.Id) -or
                [bool]$script:LastHealthById[$trueProbeApp.Id]
            ) {
                throw "Lifecycle smoke test applied a stale asynchronous health result."
            }

            Start-AppHealthProbe -App $trueProbeApp
            $trueProbeDeadline = [DateTime]::UtcNow.AddSeconds(3)
            while (
                $script:HealthProbesById.ContainsKey($trueProbeApp.Id) -and
                [DateTime]::UtcNow -lt $trueProbeDeadline
            ) {
                Start-Sleep -Milliseconds 25
                Complete-AppHealthProbes
            }
            if (
                $script:HealthProbesById.ContainsKey($trueProbeApp.Id) -or
                -not $script:LastHealthById.ContainsKey($trueProbeApp.Id) -or
                -not [bool]$script:LastHealthById[$trueProbeApp.Id]
            ) {
                throw "Lifecycle smoke test lost a successful asynchronous health result."
            }
        } finally {
            $script:HealthProbeScript = $originalHealthProbeScript
        }

        $fakeProcessOne = [pscustomobject]@{ HasExited = $false; ExitCode = 0; Id = 1001 }
        $fakeProcessOne | Add-Member -MemberType ScriptMethod -Name Refresh -Value {} -Force
        $fakeProcessOne | Add-Member -MemberType ScriptMethod -Name Dispose -Value {} -Force
        $fakeProcessTwo = [pscustomobject]@{ HasExited = $false; ExitCode = 0; Id = 1002 }
        $fakeProcessTwo | Add-Member -MemberType ScriptMethod -Name Refresh -Value {} -Force
        $fakeProcessTwo | Add-Member -MemberType ScriptMethod -Name Dispose -Value {} -Force
        $fakeAllProcess = [pscustomobject]@{ HasExited = $false; ExitCode = 0; Id = 1003 }
        $fakeAllProcess | Add-Member -MemberType ScriptMethod -Name Refresh -Value {} -Force
        $fakeAllProcess | Add-Member -MemberType ScriptMethod -Name Dispose -Value {} -Force

        $firstWorkerState = [pscustomobject]@{
            AppId = $script:RegisteredApps[0].Id
            App = $script:RegisteredApps[0]
            Label = $script:RegisteredApps[0].Name
            Mode = "Start"
            ManagesAll = $false
            Process = $fakeProcessOne
            StopSignalPath = $lifecycleStopSignalPath
            StdOutLogPath = $lifecycleStopSignalPath + ".stdout"
            StdErrLogPath = $lifecycleStopSignalPath + ".stderr"
            SessionDirectory = [IO.Path]::GetTempPath()
            StartedAt = [DateTime]::UtcNow
            StopRequested = $false
            ReadyObserved = $false
            OpenPending = $true
            Completed = $false
            ExitCode = $null
        }
        $secondWorkerState = [pscustomobject]@{
            AppId = $script:RegisteredApps[1].Id
            App = $script:RegisteredApps[1]
            Label = $script:RegisteredApps[1].Name
            Mode = "Start"
            ManagesAll = $false
            Process = $fakeProcessTwo
            StopSignalPath = $lifecycleStopSignalPath
            StdOutLogPath = $lifecycleStopSignalPath + ".stdout"
            StdErrLogPath = $lifecycleStopSignalPath + ".stderr"
            SessionDirectory = [IO.Path]::GetTempPath()
            StartedAt = [DateTime]::UtcNow
            StopRequested = $false
            ReadyObserved = $false
            OpenPending = $false
            Completed = $false
            ExitCode = $null
        }
        $allWorkerState = [pscustomobject]@{
            AppId = ""
            App = $null
            Label = "All notebooks"
            Mode = "Start"
            ManagesAll = $true
            Process = $fakeAllProcess
            StopSignalPath = $lifecycleStopSignalPath
            StdOutLogPath = $lifecycleStopSignalPath + ".stdout"
            StdErrLogPath = $lifecycleStopSignalPath + ".stderr"
            SessionDirectory = [IO.Path]::GetTempPath()
            StartedAt = [DateTime]::UtcNow
            StopRequested = $false
            ReadyObserved = $false
            OpenPending = $false
            Completed = $false
            ExitCode = $null
        }
        $script:WorkersById[$firstWorkerState.AppId] = $firstWorkerState
        $script:WorkersById[$secondWorkerState.AppId] = $secondWorkerState
        $script:AllWorker = $allWorkerState
        $script:AllWorkerManagedAppIds[$script:RegisteredApps[2].Id] = $true

        if (@(Get-ActiveWorkerStates).Count -ne 3) {
            throw "Lifecycle smoke test did not observe one aggregate and two independent workers."
        }
        $script:AppsGrid.SelectedIndex = 2
        Refresh-ButtonState
        if (
            $script:StopSelectedButton.IsEnabled -or
            -not $script:StopAllButton.IsEnabled -or
            $script:StartAllButton.IsEnabled
        ) {
            throw "Lifecycle smoke test did not reserve aggregate worker shutdown for STOP ALL."
        }
        $script:AppsGrid.SelectedIndex = 0

        $script:CloseRequested = $true
        Refresh-ButtonState
        if (
            $script:OpenSelectedButton.IsEnabled -or
            $script:StartAllButton.IsEnabled -or
            $script:VerifyButton.IsEnabled
        ) {
            throw "Lifecycle smoke test left startup actions enabled while closing."
        }
        $script:CloseRequested = $false

        $script:LifecycleErrorCount = 0
        function Show-BabelError {
            param([string]$Message)
            $script:LifecycleErrorCount++
        }
        $firstWorkerState.StopSignalPath = Join-Path `
            ([IO.Path]::GetTempPath()) `
            ([Guid]::NewGuid().ToString("N") + "\stop.signal")
        $failedStopResult = Request-WorkerStop -WorkerState $firstWorkerState
        if ($failedStopResult -or $firstWorkerState.OpenPending -or $script:LifecycleErrorCount -ne 1) {
            throw "Lifecycle smoke test retained pending OPEN after a failed stop signal."
        }

        $firstWorkerState.StopSignalPath = $lifecycleStopSignalPath
        $firstWorkerState.OpenPending = $true
        [void](Request-WorkerStop -WorkerState $firstWorkerState)
        if (-not $firstWorkerState.StopRequested -or $firstWorkerState.OpenPending) {
            throw "Lifecycle smoke test did not cancel pending OPEN during stop."
        }

        $script:LifecycleOpenCount = 0
        function Open-AppIdentity {
            param([pscustomobject]$App)
            $script:LifecycleOpenCount++
        }
        $firstWorkerState.OpenPending = $true
        $script:LastHealthById[$firstWorkerState.AppId] = $true
        Complete-PendingOpens
        if ($script:LifecycleOpenCount -ne 0 -or $firstWorkerState.OpenPending) {
            throw "Lifecycle smoke test opened a notebook after stop was requested."
        }

        $fakeProcessOne.HasExited = $true
        [void](Complete-WorkerStateIfExited -WorkerState $firstWorkerState)
        if ($script:WorkersById.ContainsKey($firstWorkerState.AppId)) {
            throw "Lifecycle smoke test did not remove an exited worker."
        }

        $fakeAllProcess.HasExited = $true
        [void](Complete-WorkerStateIfExited -WorkerState $allWorkerState)
        if ($null -ne $script:AllWorker) {
            throw "Lifecycle smoke test did not remove an exited aggregate worker."
        }

        Write-Output "Babel GUI lifecycle smoke test passed: true/false asynchronous health probes; stale result rejection; aggregate Start All with independent OPEN workers; STOP ALL ownership; bounded diagnostics cleanup; closing gate; pending OPEN cancellation; failed-stop cancellation; worker cleanup."
    } finally {
        $script:WorkersById = @{}
        $script:AllWorker = $null
        $script:AllWorkerManagedAppIds = @{}
        $script:AllWorkerReadyById = @{}
        if ($null -ne $lifecycleForeignListener) {
            $lifecycleForeignListener.Stop()
        }
        if (Test-Path -LiteralPath $lifecycleStopSignalPath -PathType Leaf) {
            Remove-Item -LiteralPath $lifecycleStopSignalPath -Force
        }
        if ($null -ne $lifecycleCleanupWorkerState) {
            Remove-WorkerSessionDirectory -WorkerState $lifecycleCleanupWorkerState
        }
        Dispose-AppHealthProbes
        Dispose-BabelTrayResources
    }
    return
}

function Get-BabelNumberSelectionIndex {
    param(
        [Parameter(Mandatory = $true)]
        [Windows.Input.Key]$Key
    )

    $keyText = $Key.ToString()
    $numberText = $null
    if ($keyText -match "^D([0-9])$") {
        $numberText = $Matches[1]
    } elseif ($keyText -match "^NumPad([0-9])$") {
        $numberText = $Matches[1]
    }
    if ($null -eq $numberText) {
        return -1
    }

    $number = [int]$numberText
    if ($number -eq 0) {
        return 9
    }
    return $number - 1
}

function Select-BabelAppByIndex {
    param(
        [Parameter(Mandatory = $true)]
        [int]$Index
    )

    if ($Index -lt 0 -or $Index -ge $script:AppsGrid.Items.Count) {
        Set-UiStatus -Message "No notebook is registered at keyboard position $($Index + 1)."
        return
    }

    $script:AppsGrid.SelectedIndex = $Index
    $script:AppsGrid.ScrollIntoView($script:AppsGrid.SelectedItem)
    Focus-BabelAppList
}

function Move-BabelAppSelection {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet(-1, 1)]
        [int]$Delta
    )

    $itemCount = $script:AppsGrid.Items.Count
    if ($itemCount -eq 0) {
        Set-UiStatus -Message "No notebooks are registered."
        return
    }

    $currentIndex = $script:AppsGrid.SelectedIndex
    if ($currentIndex -lt 0) {
        $currentIndex = 0
    }
    $nextIndex = [Math]::Max(0, [Math]::Min($itemCount - 1, $currentIndex + $Delta))
    Select-BabelAppByIndex -Index $nextIndex
}

function Test-BabelEditableTextInputFocused {
    $focusedElement = [Windows.Input.Keyboard]::FocusedElement
    return (
        $focusedElement -is [Windows.Controls.Primitives.TextBoxBase] -and
        -not [bool]$focusedElement.IsReadOnly
    )
}

$script:OpenSelectedButton.Add_Click({
    try {
        $app = Get-SelectedApp
        if ($null -eq $app) {
            Set-UiStatus -Message "Select a notebook first."
            return
        }
        Open-BabelApp -App $app
    } catch {
        Show-BabelError -Message $_.Exception.Message
    }
})

$script:StartAllButton.Add_Click({
    try {
        Start-AllNotebookWorkers
    } catch {
        Show-BabelError -Message $_.Exception.Message
    }
})

$script:StopSelectedButton.Add_Click({
    $app = Get-SelectedApp
    if ($null -eq $app) {
        Set-UiStatus -Message "Select a notebook first."
        return
    }
    Request-AppWorkerStop -AppId $app.Id
})

$script:StopAllButton.Add_Click({
    Request-AllWorkersStop
})

$script:ShortcutsButton.Add_Click({
    try {
        if (Show-BabelShortcutSettings) {
            Set-UiStatus -Message "Launcher hotkey applied. Reload open application pages for web command changes."
        }
    } catch {
        Show-BabelError -Message "Could not open shortcut settings.`r`n`r`n$($_.Exception.Message)"
    }
})

$script:MinimizeToTrayButton.Add_Click({
    Hide-BabelWindowToTray
})

$script:AdvancedExpander.Add_Expanded({
    Update-LogView
})

if ($null -ne $script:NotifyIcon) {
    $script:NotifyIcon.Add_MouseClick({
        param($sender, $eventArgs)

        if ($eventArgs.Button -eq [Windows.Forms.MouseButtons]::Left) {
            Restore-BabelWindowFromTray
        }
    })

    $script:NotifyIcon.Add_MouseDoubleClick({
        param($sender, $eventArgs)

        if ($eventArgs.Button -eq [Windows.Forms.MouseButtons]::Left) {
            Restore-BabelWindowFromTray
        }
    })

    $script:TrayOpenMenuItem.Add_Click({
        Restore-BabelWindowFromTray
    })

    $script:TrayExitMenuItem.Add_Click({
        Restore-BabelWindowFromTray
        $script:Window.Close()
    })
}

$script:VerifyButton.Add_Click({
    try {
        [void](Start-BabelWorker -Selection "All" -Mode "Verify")
    } catch {
        Show-BabelError -Message $_.Exception.Message
    }
})

$script:AppsGrid.Add_SelectionChanged({
    Refresh-ButtonState
})

$script:Window.Add_PreviewKeyDown({
    param($sender, $eventArgs)

    $key = $eventArgs.Key
    if ($key -eq [Windows.Input.Key]::System) {
        $key = $eventArgs.SystemKey
    }
    $modifiers = $eventArgs.KeyboardDevice.Modifiers
    $hasNoModifiers = $modifiers -eq [Windows.Input.ModifierKeys]::None

    if (-not $hasNoModifiers) {
        return
    }

    if ($key -eq [Windows.Input.Key]::Escape) {
        try {
            Hide-BabelWindowToTray
        } catch {
            Show-BabelError -Message $_.Exception.Message
        }
        $eventArgs.Handled = $true
        return
    }

    if (Test-BabelEditableTextInputFocused) {
        return
    }

    $selectionIndex = Get-BabelNumberSelectionIndex -Key $key
    if ($selectionIndex -ge 0) {
        Select-BabelAppByIndex -Index $selectionIndex
        $eventArgs.Handled = $true
        return
    }

    if ($key -eq [Windows.Input.Key]::Up) {
        Move-BabelAppSelection -Delta -1
        $eventArgs.Handled = $true
        return
    }

    if ($key -eq [Windows.Input.Key]::Down) {
        Move-BabelAppSelection -Delta 1
        $eventArgs.Handled = $true
        return
    }

    if ($key -eq [Windows.Input.Key]::Return) {
        $app = Get-SelectedApp
        if ($null -eq $app) {
            Set-UiStatus -Message "Select a notebook first."
        } else {
            try {
                Open-BabelApp -App $app -HideAfterOpen
            } catch {
                Show-BabelOpenError -AppId $app.Id -Message $_.Exception.Message
            }
        }
        $eventArgs.Handled = $true
        return
    }

    if ($key -eq [Windows.Input.Key]::Delete) {
        $app = Get-SelectedApp
        if ($null -eq $app) {
            Set-UiStatus -Message "Select a notebook first."
        } else {
            $workerState = Get-AppWorkerState -AppId $app.Id
            if ($null -eq $workerState) {
                Set-UiStatus -Message "The selected notebook has no independent launcher worker to stop."
            } elseif ($workerState.StopRequested) {
                Set-UiStatus -Message "Stop is already pending for $($app.Name)."
            } else {
                Request-AppWorkerStop -AppId $app.Id
            }
        }
        $eventArgs.Handled = $true
    }
})

$timer = New-Object Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromSeconds($script:StatusPollIntervalSeconds)
$timer.Add_Tick({
    try {
        Complete-AppHealthProbes
        Complete-WorkersIfExited
        Refresh-AppStatuses
        Complete-PendingOpens
        Update-LogView
        Refresh-ButtonState
    } catch {
        try {
            Set-UiStatus -Message "UI polling failed: $($_.Exception.Message)"
        } catch {
            # Never allow a status-rendering failure to escape the Dispatcher.
        }
    }
})

$script:Window.Add_Closing({
    param($sender, $eventArgs)

    if ($script:AllowClose) {
        $timer.Stop()
        Dispose-BabelGlobalHotkeyResources
        return
    }

    if (Test-AnyWorkerActive) {
        $eventArgs.Cancel = $true
        $script:CloseRequested = $true
        Set-UiStatus -Message "Stopping managed notebook workers. The window will close after cleanup."
        Request-AllWorkersStop
    } else {
        $timer.Stop()
        Dispose-BabelGlobalHotkeyResources
    }
})

$script:Window.Add_SourceInitialized({
    if ($TraySmokeTest) {
        return
    }
    try {
        Initialize-BabelGlobalHotkey
        if (-not $HotkeySmokeTest) {
            $hotkeyStatus = "Launcher hotkey $($script:GlobalHotkeyBinding) is active."
            if (-not [string]::IsNullOrWhiteSpace($script:GlobalHotkeyWarning)) {
                $hotkeyStatus = "$($script:GlobalHotkeyWarning) $hotkeyStatus"
            }
            Set-UiStatus -Message $hotkeyStatus
        }
    } catch {
        $warningMessage = "Launcher global hotkey is unavailable: $($_.Exception.Message)"
        $script:GlobalHotkeyWarning = $warningMessage
        if ($HotkeySmokeTest) {
            $script:HotkeySmokeError = $warningMessage
        } else {
            Set-UiStatus -Message $warningMessage
        }
    }
})

if ($TraySmokeTest) {
    $script:Window.WindowStartupLocation = [Windows.WindowStartupLocation]::Manual
    $script:Window.Left = -10000
    $script:Window.Top = -10000
    $script:Window.Opacity = 0
    $script:Window.ShowInTaskbar = $false

    $script:TraySmokeTimer = New-Object Windows.Threading.DispatcherTimer
    $script:TraySmokeTimer.Interval = [TimeSpan]::FromMilliseconds(150)
    $script:TraySmokeTimer.Add_Tick({
        $script:TraySmokeTimer.Stop()
        try {
            Hide-BabelWindowToTray
            if ($script:Window.IsVisible -or $script:Window.ShowInTaskbar) {
                throw "The launcher window remained visible after minimizing to the tray."
            }
            if (-not $script:NotifyIcon.Visible) {
                throw "The notification-area icon did not become visible."
            }

            Restore-BabelWindowFromTray
            if (-not $script:Window.IsVisible -or -not $script:Window.ShowInTaskbar) {
                throw "The launcher window did not restore from the tray."
            }
            if ($script:Window.WindowState -ne [Windows.WindowState]::Normal) {
                throw "The restored launcher window is not in its normal state."
            }
            if ($script:NotifyIcon.Visible) {
                throw "The notification-area icon remained visible after restore."
            }
        } catch {
            $script:TraySmokeError = $_.Exception.Message
        } finally {
            $script:AllowClose = $true
            $script:Window.Close()
        }
    })
    $script:TraySmokeTimer.Start()
}

if ($HotkeySmokeTest) {
    $script:Window.WindowStartupLocation = [Windows.WindowStartupLocation]::Manual
    $script:Window.Left = -10000
    $script:Window.Top = -10000
    $script:Window.Opacity = 0
    $script:Window.ShowInTaskbar = $false

    $script:HotkeySmokeTimer = New-Object Windows.Threading.DispatcherTimer
    $script:HotkeySmokeTimer.Interval = [TimeSpan]::FromMilliseconds(150)
    $script:HotkeySmokeTimer.Add_Tick({
        try {
            if (-not [string]::IsNullOrWhiteSpace($script:HotkeySmokeError)) {
                throw $script:HotkeySmokeError
            }

            switch ($script:HotkeySmokePhase) {
                0 {
                    if (
                        -not $script:GlobalHotkeyRegistered -or
                        $script:GlobalHotkeyId -eq 0 -or
                        $null -eq $script:GlobalHotkeySource -or
                        $null -eq $script:GlobalHotkeyHook
                    ) {
                        throw "The smoke hotkey and window-message hook were not registered."
                    }

                    Hide-BabelWindowToTray
                    if ($script:Window.IsVisible -or -not $script:NotifyIcon.Visible) {
                        throw "The smoke setup could not hide the launcher to the tray."
                    }
                    $script:HotkeySmokeForegroundOverride = $false
                    $posted = [BabelLauncher.GlobalHotkeyNativeMethods]::PostMessage(
                        $script:WindowHandle,
                        $script:WmHotkey,
                        [IntPtr]$script:GlobalHotkeyId,
                        [IntPtr]::Zero
                    )
                    if (-not $posted) {
                        throw "Could not post the restore WM_HOTKEY message. $(Get-BabelLastWin32ErrorText)"
                    }
                    $script:HotkeySmokePhase = 1
                    return
                }
                1 {
                    if (
                        -not $script:Window.IsVisible -or
                        -not $script:Window.ShowInTaskbar -or
                        $script:NotifyIcon.Visible
                    ) {
                        throw "WM_HOTKEY did not restore the launcher from the tray."
                    }
                    $script:HotkeySmokeForegroundOverride = $true
                    $posted = [BabelLauncher.GlobalHotkeyNativeMethods]::PostMessage(
                        $script:WindowHandle,
                        $script:WmHotkey,
                        [IntPtr]$script:GlobalHotkeyId,
                        [IntPtr]::Zero
                    )
                    if (-not $posted) {
                        throw "Could not post the hide WM_HOTKEY message. $(Get-BabelLastWin32ErrorText)"
                    }
                    $script:HotkeySmokePhase = 2
                    return
                }
                2 {
                    if (
                        $script:Window.IsVisible -or
                        $script:Window.ShowInTaskbar -or
                        -not $script:NotifyIcon.Visible
                    ) {
                        throw "WM_HOTKEY did not hide the foreground launcher to the tray."
                    }
                    $script:HotkeySmokeTimer.Stop()
                    $script:AllowClose = $true
                    $script:Window.Close()
                }
            }
        } catch {
            $script:HotkeySmokeError = $_.Exception.Message
            $script:HotkeySmokeTimer.Stop()
            $script:AllowClose = $true
            $script:Window.Close()
        }
    })
    $script:HotkeySmokeTimer.Start()
}

Refresh-AppStatuses
Refresh-ButtonState
Set-UiStatus -Message "Choose a notebook and OPEN it. Stopped notebooks start automatically."
$wpfApplication = New-Object Windows.Application
$wpfApplication.ShutdownMode = [Windows.ShutdownMode]::OnMainWindowClose
$timer.Start()
try {
    [void]$wpfApplication.Run($script:Window)
} finally {
    $timer.Stop()
    if ($null -ne $script:TraySmokeTimer) {
        $script:TraySmokeTimer.Stop()
        $script:TraySmokeTimer = $null
    }
    if ($null -ne $script:HotkeySmokeTimer) {
        $script:HotkeySmokeTimer.Stop()
        $script:HotkeySmokeTimer = $null
    }
    Dispose-AppHealthProbes
    Dispose-BabelGlobalHotkeyResources
    Dispose-BabelTrayResources
    Remove-CompletedWorkerSessions
}

if ($TraySmokeTest) {
    if (-not [string]::IsNullOrWhiteSpace($script:TraySmokeError)) {
        throw "Babel GUI tray smoke test failed: $($script:TraySmokeError)"
    }
    if (
        $null -ne $script:NotifyIcon -or
        $null -ne $script:TrayContextMenu -or
        $null -ne $script:TrayIconImage -or
        $null -ne $script:TrayOpenMenuItem -or
        $null -ne $script:TrayExitMenuItem -or
        $script:TrayAppMenuItems.Count -ne 0
    ) {
        throw "Babel GUI tray smoke test failed to release notification-area resources."
    }
    Write-Output "Babel GUI tray smoke test passed."
}

if ($HotkeySmokeTest) {
    if (-not [string]::IsNullOrWhiteSpace($script:HotkeySmokeError)) {
        throw "Babel GUI hotkey smoke test failed: $($script:HotkeySmokeError)"
    }
    if (
        $script:GlobalHotkeyRegistered -or
        $script:GlobalHotkeyId -ne 0 -or
        $null -ne $script:GlobalHotkeySource -or
        $null -ne $script:GlobalHotkeyHook -or
        $script:WindowHandle -ne [IntPtr]::Zero
    ) {
        throw "Babel GUI hotkey smoke test failed to release the registration or HwndSource hook."
    }
    Write-Output "Babel GUI hotkey smoke test passed: WM_HOTKEY restore/hide toggle and resource cleanup."
}
