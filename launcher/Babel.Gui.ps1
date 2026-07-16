[CmdletBinding()]
param(
    [switch]$SmokeTest,

    [switch]$TraySmokeTest,

    [switch]$StateSmokeTest,

    [switch]$LifecycleSmokeTest
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

$testModeCount = 0
foreach ($testModeEnabled in @($SmokeTest, $TraySmokeTest, $StateSmokeTest, $LifecycleSmokeTest)) {
    if ($testModeEnabled) {
        $testModeCount++
    }
}
if ($testModeCount -gt 1) {
    throw "GUI smoke-test modes cannot be used together."
}

if ($PSVersionTable.PSEdition -ne "Desktop" -or $PSVersionTable.PSVersion.Major -ne 5) {
    throw "Babel GUI requires Windows PowerShell 5.1."
}
if ([Threading.Thread]::CurrentThread.ApartmentState -ne [Threading.ApartmentState]::STA) {
    throw "Babel GUI requires an STA thread. Start it with powershell.exe -STA -File launcher\Babel.Gui.ps1."
}

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Data
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$babelRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$registryPath = Join-Path $babelRoot "babel.apps.json"
$xamlPath = Join-Path $PSScriptRoot "Babel.xaml"
$workerScriptPath = Join-Path $PSScriptRoot "Babel.ps1"
$shortcutHelperPath = Join-Path $PSScriptRoot "Babel.Shortcuts.ps1"
$shortcutXamlPath = Join-Path $PSScriptRoot "Babel.Shortcuts.xaml"
$shortcutDefaultsPath = Join-Path $babelRoot "packages\platform\shortcuts.defaults.json"

if (-not (Test-Path -LiteralPath $shortcutHelperPath -PathType Leaf)) {
    throw "Shortcut helper not found: $shortcutHelperPath"
}
try {
    . $shortcutHelperPath
} catch {
    throw "Could not load the shortcut helper: $($_.Exception.Message)"
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
            IdentityHealthUrl = $internalBaseUrl + $identityPath
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

        $identityResponse = Invoke-WebRequest `
            -Uri $App.IdentityHealthUrl `
            -UseBasicParsing `
            -TimeoutSec 2
        if ($identityResponse.StatusCode -lt 200 -or $identityResponse.StatusCode -ge 400) {
            return $false
        }

        return $identityResponse.Content.IndexOf(
            $App.IdentityText,
            [StringComparison]::OrdinalIgnoreCase
        ) -ge 0
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
    "commandPalette"
)
$shortcutDefinitions = @(Get-BabelShortcutDefinitions -Path $shortcutDefaultsPath)
$actualShortcutCommands = @($shortcutDefinitions | ForEach-Object { [string]$_.Id })
if (($actualShortcutCommands -join "|") -cne ($expectedShortcutCommands -join "|")) {
    throw "Shortcut defaults must define the nine commands in their registered order."
}
$shortcutDefaultBindings = Get-BabelDefaultShortcutBindings -Definitions $shortcutDefinitions

$shortcutControlNames = @(
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
            IdentityHealthUrl = "http://127.0.0.1:$foreignPort/notes"
            IdentityText = "Babel state smoke identity"
        }
        if (Test-AppHealth -App $foreignApp) {
            throw "A port-only foreign listener passed the Babel health and identity checks."
        }
    } finally {
        $foreignListener.Stop()
    }

    $independentWorkers = @{
        retex = [pscustomobject]@{ AppId = "retex" }
        vali = [pscustomobject]@{ AppId = "vali" }
    }
    if ($independentWorkers.Count -ne 2 -or $independentWorkers.retex.AppId -eq $independentWorkers.vali.AppId) {
        throw "State smoke test could not model independent workers."
    }

    Write-Output "Babel GUI state smoke test passed: Stopped, Starting, Ready, Unhealthy, External; foreign listener rejected; independent workers."
    return
}

if (-not (Test-Path -LiteralPath $workerScriptPath -PathType Leaf)) {
    throw "Babel worker not found: $workerScriptPath"
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
$script:VerifyWorker = $null
$script:WorkerHistory = New-Object System.Collections.ArrayList
$script:LastPortOpenById = @{}
$script:LastHealthById = @{}
$script:LastProbeAtById = @{}
$script:HealthProbesById = @{}
$script:ProbeGenerationById = @{}
$script:ExternalOpenRequestsById = @{}
$script:HealthProbeScript = @'
param(
    [string]$HealthUrl,
    [string]$IdentityHealthUrl,
    [string]$IdentityText
)

$ErrorActionPreference = "Stop"
try {
    $healthResponse = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 2
    if ($healthResponse.StatusCode -lt 200 -or $healthResponse.StatusCode -ge 400) {
        return $false
    }

    $identityResponse = Invoke-WebRequest -Uri $IdentityHealthUrl -UseBasicParsing -TimeoutSec 2
    if ($identityResponse.StatusCode -lt 200 -or $identityResponse.StatusCode -ge 400) {
        return $false
    }

    return $identityResponse.Content.IndexOf(
        $IdentityText,
        [StringComparison]::OrdinalIgnoreCase
    ) -ge 0
} catch {
    return $false
}
'@
$script:HealthProbeRunspacePool = `
    [Management.Automation.Runspaces.RunspaceFactory]::CreateRunspacePool(1, $script:RegisteredApps.Count)
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

    $state = [pscustomobject]@{
        Window = $shortcutWindow
        Controls = $shortcutControls
        Table = $shortcutTable
        Definitions = @($script:ShortcutDefinitions)
        DefaultBindings = $script:ShortcutDefaultBindings
        Saved = $false
    }
    $shortcutWindow.Tag = $state
    if (-not [string]::IsNullOrWhiteSpace([string]$settings.Warning)) {
        $shortcutControls.ShortcutStatusText.Text = [string]$settings.Warning
    }

    $shortcutWindow.Add_PreviewKeyDown({
        param($sender, $eventArgs)

        $focusedElement = [Windows.Input.Keyboard]::FocusedElement
        if (
            $null -eq $focusedElement -or
            -not ($focusedElement -is [Windows.Controls.TextBox]) -or
            $focusedElement.Name -ne "ShortcutCaptureBox" -or
            [string]::IsNullOrWhiteSpace([string]$focusedElement.Tag)
        ) {
            return
        }

        $dialogState = Get-BabelShortcutDialogState -Sender $sender
        try {
            $canonicalBinding = ConvertFrom-WpfShortcutKeyEvent -EventArgs $eventArgs
            $commandId = [string]$focusedElement.Tag
            foreach ($otherRow in $dialogState.Table.Rows) {
                if (
                    [string]$otherRow.Id -ne $commandId -and
                    [string]::Equals(
                        [string]$otherRow.Shortcut,
                        $canonicalBinding,
                        [StringComparison]::OrdinalIgnoreCase
                    )
                ) {
                    throw "Shortcut '$canonicalBinding' is already assigned to $($otherRow.Label)."
                }
            }

            $currentRows = @($dialogState.Table.Select("Id = '" + $commandId.Replace("'", "''") + "'"))
            if ($currentRows.Count -ne 1) {
                throw "Could not find shortcut command '$commandId'."
            }
            $currentRows[0].Shortcut = $canonicalBinding
            $dialogState.Controls.ShortcutGrid.Items.Refresh()
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
        try {
            $bindings = [ordered]@{}
            foreach ($row in $dialogState.Table.Rows) {
                $bindings[[string]$row.Id] = [string]$row.Shortcut
            }
            $savedPath = Write-BabelShortcutSettings `
                -Definitions $dialogState.Definitions `
                -Bindings $bindings
            $dialogState.Saved = $true
            $dialogState.Controls.ShortcutErrorText.Text = ""
            $dialogState.Controls.ShortcutStatusText.Text = "Saved. Reload open application pages to use the new shortcuts."
            [Windows.MessageBox]::Show(
                $dialogState.Window,
                "Global shortcuts were saved to:`r`n$savedPath`r`n`r`nReload open application pages to use the new shortcuts.",
                "Babel Shortcuts",
                [Windows.MessageBoxButton]::OK,
                [Windows.MessageBoxImage]::Information
            ) | Out-Null
            $dialogState.Window.DialogResult = $true
        } catch {
            $dialogState.Controls.ShortcutErrorText.Text = $_.Exception.Message
        }
    })

    [void]$shortcutWindow.ShowDialog()
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

function Get-ActiveWorkerStates {
    $activeWorkers = @()
    foreach ($appId in @($script:WorkersById.Keys)) {
        $workerState = $script:WorkersById[$appId]
        if (Test-WorkerStateActive -WorkerState $workerState) {
            $activeWorkers += $workerState
        }
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
    $hasStartingWorker = @(
        $activeWorkers | Where-Object {
            $_.Mode -eq "Start" -and -not $_.ReadyObserved
        }
    ).Count -gt 0

    $script:OpenSelectedButton.IsEnabled = $hasSelection -and -not $script:CloseRequested
    $script:StartAllButton.IsEnabled = -not $verifyActive -and -not $script:CloseRequested
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
        [void]$probePowerShell.AddArgument($App.IdentityHealthUrl)
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
            $workerState = Get-AppWorkerState -AppId $appId
            if ($null -ne $workerState) {
                $workerState.ReadyObserved = $true
            }
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
        $workerActive = $null -ne $workerState

        if ($portOpen) {
            $probeDue = $ForceProbe -or -not $script:LastProbeAtById.ContainsKey($app.Id)
            if (-not $probeDue) {
                $probeDue = ($now - [DateTime]$script:LastProbeAtById[$app.Id]).TotalSeconds -ge 2
            }
            if ($workerActive -and $workerState.OpenPending) {
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
            $workerState.ReadyObserved = $true
        }

        $readyObserved = $workerActive -and [bool]$workerState.ReadyObserved
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

function Update-LogView {
    if (-not $script:AdvancedExpander.IsExpanded) {
        return
    }

    $logSections = New-Object System.Collections.ArrayList
    foreach ($workerState in @($script:WorkerHistory)) {
        $standardOutput = ""
        $standardError = ""

        if (Test-Path -LiteralPath $workerState.StdOutLogPath -PathType Leaf) {
            try {
                $standardOutput = [string](Get-Content -LiteralPath $workerState.StdOutLogPath -Raw -ErrorAction Stop)
            } catch {
                # The worker can briefly hold the redirected log while writing it.
            }
        }
        if (Test-Path -LiteralPath $workerState.StdErrLogPath -PathType Leaf) {
            try {
                $standardError = [string](Get-Content -LiteralPath $workerState.StdErrLogPath -Raw -ErrorAction Stop)
            } catch {
                # The worker can briefly hold the redirected log while writing it.
            }
        }

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

    if ($WorkerState.Mode -eq "Start") {
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
            Show-BabelError -Message "$($WorkerState.Label) did not become ready. Review Diagnostics."
        }
    }
    return $true
}

function Complete-WorkersIfExited {
    foreach ($appId in @($script:WorkersById.Keys)) {
        [void](Complete-WorkerStateIfExited -WorkerState $script:WorkersById[$appId])
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
    if ($Mode -eq "Start") {
        if (Test-WorkerStateActive -WorkerState $script:VerifyWorker) {
            throw "Verification is running. Wait for it to finish before starting another notebook."
        }
        if (-not $script:AppsById.ContainsKey($Selection)) {
            throw "Unknown notebook '$Selection'."
        }
        $app = $script:AppsById[$Selection]
        $existingWorker = Get-AppWorkerState -AppId $Selection
        if ($null -ne $existingWorker) {
            return $existingWorker
        }
    } elseif (Test-WorkerStateActive -WorkerState $script:VerifyWorker) {
        Set-UiStatus -Message "Verification is already running."
        return $script:VerifyWorker
    }

    $powershellPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
    if (-not (Test-Path -LiteralPath $powershellPath -PathType Leaf)) {
        throw "Windows PowerShell 5.1 not found: $powershellPath"
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

    # Keep each native stream in a pollable temporary file while preserving the
    # worker's exit code. EncodedCommand avoids nested Windows quoting hazards.
    $workerCommand += " 2> " + (ConvertTo-PowerShellLiteral -Value $stdErrLogPath) +
        " 3>&1 4>&1 5>&1 6>&1 1> " + (ConvertTo-PowerShellLiteral -Value $stdOutLogPath) +
        '; $workerExitCode = $LASTEXITCODE; exit $workerExitCode'
    $encodedCommand = [Convert]::ToBase64String(
        [Text.Encoding]::Unicode.GetBytes($workerCommand)
    )

    try {
        $startInfo = New-Object Diagnostics.ProcessStartInfo
        $startInfo.FileName = $powershellPath
        $startInfo.Arguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand $encodedCommand"
        $startInfo.WorkingDirectory = $babelRoot
        $startInfo.UseShellExecute = $false
        $startInfo.CreateNoWindow = $true
        $startInfo.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden

        $process = New-Object Diagnostics.Process
        $process.StartInfo = $startInfo
        if (-not $process.Start()) {
            throw "Windows did not create the worker process."
        }
    } catch {
        throw "Could not start the Babel worker: $($_.Exception.Message)"
    }

    $label = "Verify all"
    $appId = ""
    if ($Mode -eq "Start") {
        $label = $app.Name
        $appId = $app.Id
    }
    $workerState = [pscustomobject]@{
        AppId = $appId
        App = $app
        Label = $label
        Mode = $Mode
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
    } else {
        $script:WorkersById[$app.Id] = $workerState
    }
    [void]$script:WorkerHistory.Add($workerState)
    $script:LastRenderedLog = ""

    if ($Mode -eq "Verify") {
        Set-UiStatus -Message "Verifying all applications. Temporary services will stop automatically."
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

function Open-BabelApp {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$App
    )

    if ($script:CloseRequested) {
        throw "The launcher is closing and cannot open another notebook."
    }

    if (Test-AppHealthRecentlyPassed -App $App) {
        $script:LastPortOpenById[$App.Id] = $true
        $workerState = Get-AppWorkerState -AppId $App.Id
        if ($null -ne $workerState) {
            $workerState.ReadyObserved = $true
        }
        Open-AppIdentity -App $App
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
    if (Test-LocalPort -Port $App.Port) {
        if (-not $script:ExternalOpenRequestsById.ContainsKey($App.Id)) {
            Invalidate-AppHealthProbe -AppId $App.Id
            $script:ExternalOpenRequestsById[$App.Id] = [pscustomobject]@{
                App = $App
                RequestedAt = [DateTime]::UtcNow
            }
        }
        Start-AppHealthProbe -App $App
        Set-UiStatus -Message "Checking the $($App.Name) health endpoint and page identity before OPEN."
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
            Open-AppIdentity -App $workerState.App
        } catch {
            Show-BabelError -Message "Could not open the default browser.`r`n`r`n$($_.Exception.Message)"
        }
    }

    foreach ($appId in @($script:ExternalOpenRequestsById.Keys)) {
        $openRequest = $script:ExternalOpenRequestsById[$appId]
        $app = $openRequest.App
        if ($script:CloseRequested) {
            $script:ExternalOpenRequestsById.Remove($appId)
            continue
        }
        if ($script:HealthProbesById.ContainsKey($appId)) {
            continue
        }

        if (-not (Test-LocalPort -Port $app.Port)) {
            $script:ExternalOpenRequestsById.Remove($appId)
            if (Test-WorkerStateActive -WorkerState $script:VerifyWorker) {
                Show-BabelError -Message "$($app.Name) stopped during its identity check while verification is running."
                continue
            }
            try {
                Invalidate-AppHealthProbe -AppId $appId
                $workerState = Start-BabelWorker -Selection $appId -Mode "Start"
                $workerState.OpenPending = $true
            } catch {
                Show-BabelError -Message $_.Exception.Message
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
                Open-AppIdentity -App $app
            } catch {
                Show-BabelError -Message "Could not open the default browser.`r`n`r`n$($_.Exception.Message)"
            }
        } else {
            Show-BabelError -Message "Port $($app.Port) is occupied, but the listener is not a healthy $($app.Name) instance. OPEN was blocked."
        }
    }
}

function Start-AllNotebookWorkers {
    if ($script:CloseRequested) {
        throw "The launcher is closing and cannot start more notebooks."
    }

    $startedNames = New-Object System.Collections.ArrayList
    $blockedNames = New-Object System.Collections.ArrayList

    foreach ($app in $script:RegisteredApps) {
        if ($null -ne (Get-AppWorkerState -AppId $app.Id)) {
            continue
        }

        $portOpen = Test-LocalPort -Port $app.Port
        if ($portOpen) {
            $script:LastPortOpenById[$app.Id] = $true
            if (-not (Test-AppHealthRecentlyPassed -App $app)) {
                Start-AppHealthProbe -App $app
                [void]$blockedNames.Add($app.Name)
            }
            continue
        }

        Invalidate-AppHealthProbe -AppId $app.Id
        [void](Start-BabelWorker -Selection $app.Id -Mode "Start")
        [void]$startedNames.Add($app.Name)
    }

    if ($blockedNames.Count -gt 0) {
        Set-UiStatus -Message "Started $($startedNames.Count) notebook(s). Skipped occupied ports pending or failing identity: $($blockedNames -join ', ')."
    } elseif ($startedNames.Count -gt 0) {
        Set-UiStatus -Message "Started $($startedNames.Count) independent notebook worker(s)."
    } else {
        Set-UiStatus -Message "All notebooks are already running or starting."
    }
}

if ($LifecycleSmokeTest) {
    $lifecycleStopSignalPath = [IO.Path]::GetTempFileName()
    $lifecycleForeignListener = $null
    try {
        $lifecycleForeignListener = `
            New-Object Net.Sockets.TcpListener -ArgumentList ([Net.IPAddress]::Loopback), 0
        $lifecycleForeignListener.Start()
        $lifecycleForeignPort = ([Net.IPEndPoint]$lifecycleForeignListener.LocalEndpoint).Port
        $probeSmokeApp = [pscustomobject]@{
            Id = "lifecycle-probe-smoke"
            HealthUrl = "http://127.0.0.1:$lifecycleForeignPort/api/health"
            IdentityHealthUrl = "http://127.0.0.1:$lifecycleForeignPort/notes"
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
            $script:HealthProbeScript = 'param($HealthUrl, $IdentityHealthUrl, $IdentityText); return $true'
            $trueProbeApp = [pscustomobject]@{
                Id = "lifecycle-true-probe-smoke"
                HealthUrl = "http://127.0.0.1/unused-health"
                IdentityHealthUrl = "http://127.0.0.1/unused-identity"
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

        $firstWorkerState = [pscustomobject]@{
            AppId = $script:RegisteredApps[0].Id
            App = $script:RegisteredApps[0]
            Label = $script:RegisteredApps[0].Name
            Mode = "Start"
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
        $script:WorkersById[$firstWorkerState.AppId] = $firstWorkerState
        $script:WorkersById[$secondWorkerState.AppId] = $secondWorkerState

        if (@(Get-ActiveWorkerStates).Count -ne 2) {
            throw "Lifecycle smoke test did not observe two independent workers."
        }

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

        Write-Output "Babel GUI lifecycle smoke test passed: true/false asynchronous health probes; stale result rejection; independent workers; closing gate; pending OPEN cancellation; failed-stop cancellation; worker cleanup."
    } finally {
        $script:WorkersById = @{}
        if ($null -ne $lifecycleForeignListener) {
            $lifecycleForeignListener.Stop()
        }
        if (Test-Path -LiteralPath $lifecycleStopSignalPath -PathType Leaf) {
            Remove-Item -LiteralPath $lifecycleStopSignalPath -Force
        }
        Dispose-AppHealthProbes
        Dispose-BabelTrayResources
    }
    return
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
            Set-UiStatus -Message "Global shortcuts saved. Reload open application pages to use them."
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

$timer = New-Object Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds(900)
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
        return
    }

    if (Test-AnyWorkerActive) {
        $eventArgs.Cancel = $true
        $script:CloseRequested = $true
        Set-UiStatus -Message "Stopping managed notebook workers. The window will close after cleanup."
        Request-AllWorkersStop
    } else {
        $timer.Stop()
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
    Dispose-AppHealthProbes
    Dispose-BabelTrayResources
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
