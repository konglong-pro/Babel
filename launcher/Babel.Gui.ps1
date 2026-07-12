[CmdletBinding()]
param(
    [switch]$SmokeTest,

    [switch]$TraySmokeTest
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

if ($SmokeTest -and $TraySmokeTest) {
    throw "SmokeTest and TraySmokeTest cannot be used together."
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
        foreach ($propertyName in @("name", "id", "port", "identityPath")) {
            if (-not (Test-RequiredProperty -InputObject $definition -Name $propertyName)) {
                throw "Application registry entry is missing $propertyName."
            }
        }

        $name = ([string]$definition.name).Trim()
        $id = ([string]$definition.id).Trim()
        $port = 0
        $identityPath = ([string]$definition.identityPath).Trim()

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
        if (-not $identityPath.StartsWith("/")) {
            throw "Application '$name' identityPath must start with /."
        }

        $apps += [pscustomobject]@{
            Name = $name
            Id = $id
            Port = $port
        }
        $ids[$id] = $true
        $ports[[string]$port] = $true
    }

    return @($apps)
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

$registeredApps = @(Get-RegisteredApps -Path $registryPath)
$window = Import-BabelWindow -Path $xamlPath

$requiredControlNames = @(
    "BrandLogo",
    "AppsGrid",
    "StartSelectedButton",
    "StartAllButton",
    "StopButton",
    "VerifyButton",
    "MinimizeToTrayButton",
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
    Write-Output "Babel GUI smoke test passed: $($registeredApps.Count) app(s), $($controls.Count) required control(s)."
    return
}

if (-not (Test-Path -LiteralPath $workerScriptPath -PathType Leaf)) {
    throw "Babel worker not found: $workerScriptPath"
}

$script:Window = $window
$script:AppsGrid = $controls.AppsGrid
$script:StartSelectedButton = $controls.StartSelectedButton
$script:StartAllButton = $controls.StartAllButton
$script:StopButton = $controls.StopButton
$script:VerifyButton = $controls.VerifyButton
$script:MinimizeToTrayButton = $controls.MinimizeToTrayButton
$script:LogTextBox = $controls.LogTextBox
$script:StatusText = $controls.StatusText
$script:WorkerText = $controls.WorkerText
$script:RegisteredApps = $registeredApps
$script:AppsById = @{}
$script:RowsById = @{}
$script:Worker = $null
$script:WorkerMode = $null
$script:WorkerTargets = @()
$script:StopSignalPath = $null
$script:StdOutLogPath = $null
$script:StdErrLogPath = $null
$script:StopRequested = $false
$script:CloseRequested = $false
$script:AllowClose = $false
$script:LastRenderedLog = ""
$script:NotifyIcon = $null
$script:TrayIconImage = $null
$script:TrayContextMenu = $null
$script:TrayOpenMenuItem = $null
$script:TrayExitMenuItem = $null
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
    $row.Status = "CHECKING"
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
    $script:TrayOpenMenuItem = New-Object System.Windows.Forms.ToolStripMenuItem
    $script:TrayOpenMenuItem.Text = "Open Babel"
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

function Test-WorkerActive {
    if ($null -eq $script:Worker) {
        return $false
    }

    try {
        $script:Worker.Refresh()
        return -not $script:Worker.HasExited
    } catch {
        return $false
    }
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
    $workerActive = Test-WorkerActive
    $hasSelection = $null -ne (Get-SelectedApp)

    $script:StartSelectedButton.IsEnabled = $hasSelection -and -not $workerActive
    $script:StartAllButton.IsEnabled = -not $workerActive
    $script:VerifyButton.IsEnabled = -not $workerActive
    $script:StopButton.IsEnabled = $workerActive -and -not $script:StopRequested

    if ($workerActive) {
        $action = "RUNNING"
        if ($script:WorkerMode -eq "Verify") {
            $action = "VERIFYING"
        }
        if ($script:StopRequested) {
            $action = "STOPPING"
        }
        $script:WorkerText.Text = "WORKER / $action / PID $($script:Worker.Id)"
    } else {
        $script:WorkerText.Text = "WORKER / IDLE"
    }
}

function Refresh-AppStatuses {
    $workerActive = Test-WorkerActive

    foreach ($app in $script:RegisteredApps) {
        $status = "STOPPED"
        if (Test-LocalPort -Port $app.Port) {
            $status = "RUNNING"
        } elseif ($workerActive -and $script:WorkerTargets -contains $app.Id) {
            if ($script:StopRequested) {
                $status = "STOPPING"
            } elseif ($script:WorkerMode -eq "Verify") {
                $status = "VERIFYING"
            } else {
                $status = "STARTING"
            }
        }
        $script:RowsById[$app.Id].Status = $status
    }

    $script:AppsGrid.Items.Refresh()
}

function Update-LogView {
    $standardOutput = ""
    $standardError = ""

    if ($null -ne $script:StdOutLogPath -and (Test-Path -LiteralPath $script:StdOutLogPath -PathType Leaf)) {
        try {
            $standardOutput = [string](Get-Content -LiteralPath $script:StdOutLogPath -Raw -ErrorAction Stop)
        } catch {
            # The worker can briefly hold the redirected log while writing it.
        }
    }
    if ($null -ne $script:StdErrLogPath -and (Test-Path -LiteralPath $script:StdErrLogPath -PathType Leaf)) {
        try {
            $standardError = [string](Get-Content -LiteralPath $script:StdErrLogPath -Raw -ErrorAction Stop)
        } catch {
            # The worker can briefly hold the redirected log while writing it.
        }
    }

    $rendered = [string]$standardOutput
    if (-not [string]::IsNullOrWhiteSpace($standardError)) {
        if (-not [string]::IsNullOrWhiteSpace($rendered)) {
            $rendered += "`r`n"
        }
        $rendered += "[stderr]`r`n$standardError"
    }

    $maximumLogCharacters = 50000
    if ($rendered.Length -gt $maximumLogCharacters) {
        $rendered = "[Showing only the last $maximumLogCharacters characters]`r`n" + $rendered.Substring(
            $rendered.Length - $maximumLogCharacters
        )
    }

    if ($rendered -ne $script:LastRenderedLog) {
        $script:LastRenderedLog = $rendered
        $script:LogTextBox.Text = $rendered
        $script:LogTextBox.ScrollToEnd()
    }
}

function Request-WorkerStop {
    if (-not (Test-WorkerActive)) {
        Set-UiStatus -Message "No worker is currently managed by this window."
        return
    }
    if ($script:StopRequested) {
        return
    }

    try {
        if ([string]::IsNullOrWhiteSpace($script:StopSignalPath)) {
            throw "The worker stop signal path is unavailable."
        }
        [IO.File]::WriteAllText(
            $script:StopSignalPath,
            [DateTime]::UtcNow.ToString("o"),
            (New-Object Text.UTF8Encoding($false))
        )
        $script:StopRequested = $true
        Set-UiStatus -Message "Graceful stop requested. Waiting for managed services to shut down."
        Refresh-ButtonState
        Refresh-AppStatuses
    } catch {
        Set-UiStatus -Message "Could not write the stop signal: $($_.Exception.Message)"
        [Windows.MessageBox]::Show(
            $script:Window,
            "Could not request worker shutdown.`r`n`r`n$($_.Exception.Message)",
            "Babel Launcher",
            [Windows.MessageBoxButton]::OK,
            [Windows.MessageBoxImage]::Error
        ) | Out-Null
    }
}

function Complete-WorkerIfExited {
    if ($null -eq $script:Worker) {
        return
    }

    try {
        $script:Worker.Refresh()
        if (-not $script:Worker.HasExited) {
            return
        }
        $exitCode = $script:Worker.ExitCode
    } catch {
        $exitCode = -1
    }

    Update-LogView
    try {
        $script:Worker.Dispose()
    } catch {
        # The process object may already have been released by Windows.
    }

    $completedMode = $script:WorkerMode
    $script:Worker = $null
    $script:WorkerMode = $null
    $script:WorkerTargets = @()
    $script:StopRequested = $false

    if ($exitCode -eq 0) {
        if ($completedMode -eq "Verify") {
            Set-UiStatus -Message "All applications passed verification."
        } else {
            Set-UiStatus -Message "Worker exited cleanly. Managed services are stopped."
        }
    } else {
        Set-UiStatus -Message "Worker exited unexpectedly (code $exitCode). Review the session log."
    }

    Refresh-AppStatuses
    Refresh-ButtonState

    if ($script:CloseRequested) {
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

    Complete-WorkerIfExited
    if (Test-WorkerActive) {
        Set-UiStatus -Message "A Babel worker is already running. Stop it before starting another."
        return
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

    $script:Worker = $process
    $script:WorkerMode = $Mode
    if ($Selection.Equals("All", [StringComparison]::OrdinalIgnoreCase)) {
        $script:WorkerTargets = @($script:RegisteredApps | ForEach-Object { $_.Id })
    } else {
        $script:WorkerTargets = @($Selection)
    }
    $script:StopSignalPath = $stopSignalPath
    $script:StdOutLogPath = $stdOutLogPath
    $script:StdErrLogPath = $stdErrLogPath
    $script:StopRequested = $false
    $script:LastRenderedLog = ""
    $script:LogTextBox.Text = ""

    if ($Mode -eq "Verify") {
        Set-UiStatus -Message "Verifying all applications. Temporary services will stop automatically."
    } else {
        Set-UiStatus -Message "Worker started. Preparing applications. Session logs: $sessionDirectory"
    }
    Refresh-AppStatuses
    Refresh-ButtonState
}

$script:StartSelectedButton.Add_Click({
    try {
        $app = Get-SelectedApp
        if ($null -eq $app) {
            Set-UiStatus -Message "Select an application first."
            return
        }
        Start-BabelWorker -Selection $app.Id -Mode "Start"
    } catch {
        Set-UiStatus -Message $_.Exception.Message
        [Windows.MessageBox]::Show(
            $script:Window,
            $_.Exception.Message,
            "Babel Launcher",
            [Windows.MessageBoxButton]::OK,
            [Windows.MessageBoxImage]::Error
        ) | Out-Null
    }
})

$script:StartAllButton.Add_Click({
    try {
        Start-BabelWorker -Selection "All" -Mode "Start"
    } catch {
        Set-UiStatus -Message $_.Exception.Message
        [Windows.MessageBox]::Show(
            $script:Window,
            $_.Exception.Message,
            "Babel Launcher",
            [Windows.MessageBoxButton]::OK,
            [Windows.MessageBoxImage]::Error
        ) | Out-Null
    }
})

$script:StopButton.Add_Click({
    Request-WorkerStop
})

$script:MinimizeToTrayButton.Add_Click({
    Hide-BabelWindowToTray
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
        Start-BabelWorker -Selection "All" -Mode "Verify"
    } catch {
        Set-UiStatus -Message $_.Exception.Message
        [Windows.MessageBox]::Show(
            $script:Window,
            $_.Exception.Message,
            "Babel Launcher",
            [Windows.MessageBoxButton]::OK,
            [Windows.MessageBoxImage]::Error
        ) | Out-Null
    }
})

$script:AppsGrid.Add_SelectionChanged({
    Refresh-ButtonState
})

$timer = New-Object Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds(900)
$timer.Add_Tick({
    try {
        Complete-WorkerIfExited
        Update-LogView
        Refresh-AppStatuses
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

    if (Test-WorkerActive) {
        $eventArgs.Cancel = $true
        $script:CloseRequested = $true
        Set-UiStatus -Message "Stopping the worker gracefully. The window will close after cleanup."
        Request-WorkerStop
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
Set-UiStatus -Message "Loaded $($script:RegisteredApps.Count) applications. Select one to begin."
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
        $null -ne $script:TrayExitMenuItem
    ) {
        throw "Babel GUI tray smoke test failed to release notification-area resources."
    }
    Write-Output "Babel GUI tray smoke test passed."
}
