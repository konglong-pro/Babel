[CmdletBinding()]
param(
    [switch]$SmokeTest
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

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
        throw "找不到应用注册表：$Path"
    }

    try {
        $registry = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    } catch {
        throw "应用注册表不是有效 JSON：$($_.Exception.Message)"
    }

    if (-not (Test-RequiredProperty -InputObject $registry -Name "schemaVersion")) {
        throw "应用注册表缺少 schemaVersion。"
    }
    if ([string]$registry.schemaVersion -ne "1") {
        throw "不支持应用注册表 schemaVersion '$($registry.schemaVersion)'。"
    }
    if (-not (Test-RequiredProperty -InputObject $registry -Name "apps")) {
        throw "应用注册表缺少 apps。"
    }

    $definitions = @($registry.apps)
    if ($definitions.Count -eq 0) {
        throw "应用注册表中没有应用。"
    }

    $ids = @{}
    $ports = @{}
    $apps = @()

    foreach ($definition in $definitions) {
        foreach ($propertyName in @("name", "id", "port", "identityPath")) {
            if (-not (Test-RequiredProperty -InputObject $definition -Name $propertyName)) {
                throw "应用注册表条目缺少 $propertyName。"
            }
        }

        $name = ([string]$definition.name).Trim()
        $id = ([string]$definition.id).Trim()
        $port = 0
        $identityPath = ([string]$definition.identityPath).Trim()

        if ([string]::IsNullOrWhiteSpace($name)) {
            throw "应用名称不能为空。"
        }
        if ($id -notmatch "^[a-z0-9][a-z0-9-]*$") {
            throw "应用 id '$id' 只能使用小写字母、数字和连字符。"
        }
        if ($ids.ContainsKey($id)) {
            throw "应用 id '$id' 重复。"
        }
        if (-not [int]::TryParse([string]$definition.port, [ref]$port) -or $port -lt 1 -or $port -gt 65535) {
            throw "应用 '$name' 的端口无效。"
        }
        if ($ports.ContainsKey([string]$port)) {
            throw "应用端口 '$port' 重复。"
        }
        if (-not $identityPath.StartsWith("/")) {
            throw "应用 '$name' 的 identityPath 必须以 / 开头。"
        }

        $apps += [pscustomobject]@{
            Name = $name
            Id = $id
            Port = $port
            OpenUrl = "http://127.0.0.1:$port$identityPath"
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
        throw "找不到界面文件：$Path"
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
        throw "无法加载 Babel XAML：$($_.Exception.Message)"
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
        throw "XAML 缺少必需控件 '$Name'。"
    }
    return $control
}

$registeredApps = @(Get-RegisteredApps -Path $registryPath)
$window = Import-BabelWindow -Path $xamlPath

$requiredControlNames = @(
    "AppsGrid",
    "StartSelectedButton",
    "StartAllButton",
    "StopButton",
    "OpenButton",
    "VerifyButton",
    "LogTextBox",
    "StatusText",
    "WorkerText"
)
$controls = @{}
foreach ($controlName in $requiredControlNames) {
    $controls[$controlName] = Get-RequiredControl -Window $window -Name $controlName
}

if ($SmokeTest) {
    Write-Output "Babel GUI smoke test passed: $($registeredApps.Count) app(s), $($controls.Count) required control(s)."
    return
}

if (-not (Test-Path -LiteralPath $workerScriptPath -PathType Leaf)) {
    throw "找不到 Babel worker：$workerScriptPath"
}

$script:Window = $window
$script:AppsGrid = $controls.AppsGrid
$script:StartSelectedButton = $controls.StartSelectedButton
$script:StartAllButton = $controls.StartAllButton
$script:StopButton = $controls.StopButton
$script:OpenButton = $controls.OpenButton
$script:VerifyButton = $controls.VerifyButton
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
    $row.Status = "检查中"
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
        # A missing or unreadable icon must not make the launcher unusable.
    }
}

function Set-UiStatus {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Message
    )

    $script:StatusText.Text = $Message
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
    $script:OpenButton.IsEnabled = $hasSelection

    if ($workerActive) {
        $action = "运行中"
        if ($script:WorkerMode -eq "Verify") {
            $action = "验证中"
        }
        if ($script:StopRequested) {
            $action = "停止中"
        }
        $script:WorkerText.Text = "worker：$action / PID $($script:Worker.Id)"
    } else {
        $script:WorkerText.Text = "worker：空闲"
    }
}

function Refresh-AppStatuses {
    $workerActive = Test-WorkerActive

    foreach ($app in $script:RegisteredApps) {
        $status = "已停止"
        if (Test-LocalPort -Port $app.Port) {
            $status = "运行中"
        } elseif ($workerActive -and $script:WorkerTargets -contains $app.Id) {
            if ($script:StopRequested) {
                $status = "正在停止"
            } elseif ($script:WorkerMode -eq "Verify") {
                $status = "正在验证"
            } else {
                $status = "正在启动"
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
        $rendered = "…仅显示最后 $maximumLogCharacters 个字符…`r`n" + $rendered.Substring(
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
        Set-UiStatus -Message "当前没有由此窗口管理的 worker。"
        return
    }
    if ($script:StopRequested) {
        return
    }

    try {
        if ([string]::IsNullOrWhiteSpace($script:StopSignalPath)) {
            throw "worker 没有停止信号路径。"
        }
        [IO.File]::WriteAllText(
            $script:StopSignalPath,
            [DateTime]::UtcNow.ToString("o"),
            (New-Object Text.UTF8Encoding($false))
        )
        $script:StopRequested = $true
        Set-UiStatus -Message "已请求 worker 正常停止，请等待服务清理完成。"
        Refresh-ButtonState
        Refresh-AppStatuses
    } catch {
        Set-UiStatus -Message "无法写入停止信号：$($_.Exception.Message)"
        [Windows.MessageBox]::Show(
            $script:Window,
            "无法请求 worker 停止。`r`n`r`n$($_.Exception.Message)",
            "Babel 启动器",
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
            Set-UiStatus -Message "全部应用验证通过。"
        } else {
            Set-UiStatus -Message "worker 已正常结束，所管理的服务已停止。"
        }
    } else {
        Set-UiStatus -Message "worker 异常结束（退出码 $exitCode），请查看日志。"
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
        Set-UiStatus -Message "已有一个 Babel worker 正在运行；请先停止它。"
        return
    }

    $powershellPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
    if (-not (Test-Path -LiteralPath $powershellPath -PathType Leaf)) {
        throw "找不到 Windows PowerShell 5.1：$powershellPath"
    }

    $sessionDirectory = Join-Path ([IO.Path]::GetTempPath()) ("BabelLauncher\" + [Guid]::NewGuid().ToString("N"))
    [void](New-Item -ItemType Directory -Path $sessionDirectory -Force)

    $stopSignalPath = [IO.Path]::GetFullPath((Join-Path $sessionDirectory "stop.signal"))
    $stdOutLogPath = Join-Path $sessionDirectory "stdout.log"
    $stdErrLogPath = Join-Path $sessionDirectory "stderr.log"
    if (Test-Path -LiteralPath $stopSignalPath) {
        throw "停止信号路径在 worker 启动前已经存在：$stopSignalPath"
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
        throw "无法启动 Babel worker：$($_.Exception.Message)"
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
        Set-UiStatus -Message "正在验证全部应用；完成后临时启动的服务会自动停止。"
    } else {
        Set-UiStatus -Message "worker 已启动，正在准备应用。日志目录：$sessionDirectory"
    }
    Refresh-AppStatuses
    Refresh-ButtonState
}

$script:StartSelectedButton.Add_Click({
    try {
        $app = Get-SelectedApp
        if ($null -eq $app) {
            Set-UiStatus -Message "请先选择一个应用。"
            return
        }
        Start-BabelWorker -Selection $app.Id -Mode "Start"
    } catch {
        Set-UiStatus -Message $_.Exception.Message
        [Windows.MessageBox]::Show(
            $script:Window,
            $_.Exception.Message,
            "Babel 启动器",
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
            "Babel 启动器",
            [Windows.MessageBoxButton]::OK,
            [Windows.MessageBoxImage]::Error
        ) | Out-Null
    }
})

$script:StopButton.Add_Click({
    Request-WorkerStop
})

$script:OpenButton.Add_Click({
    try {
        $app = Get-SelectedApp
        if ($null -eq $app) {
            Set-UiStatus -Message "请先选择一个应用。"
            return
        }
        if (-not (Test-LocalPort -Port $app.Port -TimeoutMilliseconds 200)) {
            Set-UiStatus -Message "$($app.Name) 尚未运行，无法打开页面。"
            return
        }
        Start-Process -FilePath $app.OpenUrl | Out-Null
        Set-UiStatus -Message "已在浏览器打开 $($app.Name)。"
    } catch {
        Set-UiStatus -Message "无法打开页面：$($_.Exception.Message)"
    }
})

$script:VerifyButton.Add_Click({
    try {
        Start-BabelWorker -Selection "All" -Mode "Verify"
    } catch {
        Set-UiStatus -Message $_.Exception.Message
        [Windows.MessageBox]::Show(
            $script:Window,
            $_.Exception.Message,
            "Babel 启动器",
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
            Set-UiStatus -Message "界面轮询失败：$($_.Exception.Message)"
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
        Set-UiStatus -Message "正在正常停止 worker，清理完成后窗口会自动关闭。"
        Request-WorkerStop
    } else {
        $timer.Stop()
    }
})

Refresh-AppStatuses
Refresh-ButtonState
Set-UiStatus -Message "已载入 $($script:RegisteredApps.Count) 个应用。选择应用后即可启动。"
$timer.Start()
[void]$script:Window.ShowDialog()
