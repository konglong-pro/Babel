[CmdletBinding()]
param(
    [string]$Selection = "Menu",

    [switch]$NoBrowser,

    [switch]$VerifyAndExit,

    [string]$StopSignalPath
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"
$global:BabelLauncherExitCode = 0

$processHelperPath = Join-Path $PSScriptRoot "Babel.Process.ps1"
if (-not (Test-Path -LiteralPath $processHelperPath -PathType Leaf)) {
    throw "Process helper not found: $processHelperPath"
}
. $processHelperPath

try {
    $Host.UI.RawUI.WindowTitle = "Babel"
} catch {
    # Some non-interactive hosts do not expose a writable window title.
}

function Set-ConsoleWindowIcon {
    param(
        [Parameter(Mandatory = $true)]
        [string]$IconPath
    )

    if (-not (Test-Path -LiteralPath $IconPath -PathType Leaf)) {
        return
    }

    try {
        if ($null -eq ("Babel.NativeMethods" -as [type])) {
            Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

namespace Babel {
    public static class NativeMethods {
        [DllImport("kernel32.dll")]
        public static extern IntPtr GetConsoleWindow();

        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern IntPtr LoadImage(
            IntPtr instance,
            string name,
            uint type,
            int desiredWidth,
            int desiredHeight,
            uint loadFlags
        );

        [DllImport("user32.dll")]
        public static extern IntPtr SendMessage(
            IntPtr window,
            uint message,
            IntPtr wordParameter,
            IntPtr longParameter
        );
    }
}
"@
        }

        $windowHandle = [Babel.NativeMethods]::GetConsoleWindow()
        if ($windowHandle -eq [IntPtr]::Zero) {
            return
        }

        $imageIcon = 1
        $loadFromFile = 0x10
        $setIconMessage = 0x80
        $smallIcon = [Babel.NativeMethods]::LoadImage(
            [IntPtr]::Zero,
            $IconPath,
            $imageIcon,
            16,
            16,
            $loadFromFile
        )
        $largeIcon = [Babel.NativeMethods]::LoadImage(
            [IntPtr]::Zero,
            $IconPath,
            $imageIcon,
            32,
            32,
            $loadFromFile
        )

        if ($smallIcon -ne [IntPtr]::Zero) {
            $null = [Babel.NativeMethods]::SendMessage(
                $windowHandle,
                $setIconMessage,
                [IntPtr]0,
                $smallIcon
            )
        }
        if ($largeIcon -ne [IntPtr]::Zero) {
            $null = [Babel.NativeMethods]::SendMessage(
                $windowHandle,
                $setIconMessage,
                [IntPtr]1,
                $largeIcon
            )
        }
    } catch {
        # The launcher remains usable in hosts that do not expose a console window.
    }
}

Set-ConsoleWindowIcon -IconPath (Join-Path $PSScriptRoot "assets\Babel.ico")

function Test-ObjectProperty {
    param(
        [Parameter(Mandatory = $true)]
        [object]$InputObject,

        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    return $null -ne $InputObject.PSObject.Properties[$Name]
}

function Resolve-NodeRuntime {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RootPath
    )

    $manifestPath = Join-Path $RootPath "package.json"
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw "Babel root manifest is missing: '$manifestPath'."
    }

    try {
        $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    } catch {
        throw "Babel root manifest is not valid JSON: $($_.Exception.Message)"
    }

    if (
        -not (Test-ObjectProperty -InputObject $manifest -Name "engines") -or
        -not (Test-ObjectProperty -InputObject $manifest.engines -Name "node")
    ) {
        throw "Babel root manifest must declare engines.node."
    }

    $engineRange = ([string]$manifest.engines.node).Trim()
    $rangeMatch = [regex]::Match(
        $engineRange,
        "^>=\s*(?<minimum>[0-9]+\.[0-9]+\.[0-9]+)\s+<\s*(?<maximumMajor>[0-9]+)\s*$"
    )
    if (-not $rangeMatch.Success) {
        throw "Unsupported engines.node range '$engineRange'; expected '>=x.y.z <major'."
    }

    $minimumVersion = [Version]::Parse($rangeMatch.Groups["minimum"].Value)
    $maximumMajor = [int]$rangeMatch.Groups["maximumMajor"].Value
    $candidatePaths = @()

    foreach ($command in @(Get-Command node.exe -All -CommandType Application -ErrorAction SilentlyContinue)) {
        $candidatePaths += [string]$command.Source
    }

    $fnmRoots = @()
    if (-not [string]::IsNullOrWhiteSpace($env:FNM_DIR)) {
        $fnmRoots += $env:FNM_DIR
    }
    if (-not [string]::IsNullOrWhiteSpace($env:APPDATA)) {
        $fnmRoots += Join-Path $env:APPDATA "fnm"
    }
    foreach ($fnmRoot in $fnmRoots) {
        $candidatePaths += Join-Path $fnmRoot "aliases\default\node.exe"
    }

    $seenPaths = @{}
    $discoveredRuntimes = @()
    foreach ($candidatePath in $candidatePaths) {
        if ([string]::IsNullOrWhiteSpace($candidatePath)) {
            continue
        }

        try {
            $resolvedCandidate = [IO.Path]::GetFullPath($candidatePath)
        } catch {
            continue
        }
        if ($seenPaths.ContainsKey($resolvedCandidate)) {
            continue
        }
        $seenPaths[$resolvedCandidate] = $true
        if (-not (Test-Path -LiteralPath $resolvedCandidate -PathType Leaf)) {
            continue
        }

        try {
            $versionOutput = @(& $resolvedCandidate --version 2>$null)
            $versionExitCode = $LASTEXITCODE
        } catch {
            continue
        }
        if ($versionExitCode -ne 0 -or $versionOutput.Count -eq 0) {
            continue
        }

        $versionText = ([string]$versionOutput[0]).Trim()
        $versionMatch = [regex]::Match(
            $versionText,
            "^v?(?<version>[0-9]+\.[0-9]+\.[0-9]+)(?:[-+].*)?$"
        )
        if (-not $versionMatch.Success) {
            continue
        }

        $version = [Version]::Parse($versionMatch.Groups["version"].Value)
        $discoveredRuntimes += "$versionText at '$resolvedCandidate'"
        if ($version -lt $minimumVersion -or $version.Major -ge $maximumMajor) {
            continue
        }

        $runtimeDirectory = Split-Path -Parent $resolvedCandidate
        $npmPath = Join-Path $runtimeDirectory "npm.cmd"
        if (-not (Test-Path -LiteralPath $npmPath -PathType Leaf)) {
            $discoveredRuntimes += "compatible $versionText at '$resolvedCandidate' without npm.cmd"
            continue
        }

        return [pscustomobject]@{
            NodePath = $resolvedCandidate
            NpmPath = $npmPath
            Directory = $runtimeDirectory
            Version = $version
            EngineRange = $engineRange
        }
    }

    $discoveredSummary = "none"
    if ($discoveredRuntimes.Count -gt 0) {
        $discoveredSummary = $discoveredRuntimes -join "; "
    }
    throw "No Node.js runtime satisfies engines.node '$engineRange'. Found: $discoveredSummary. Select a compatible Node version and retry."
}

function Resolve-BabelRelativePath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RootPath,

        [Parameter(Mandatory = $true)]
        [string]$RelativePath,

        [Parameter(Mandatory = $true)]
        [string]$FieldName
    )

    if ([string]::IsNullOrWhiteSpace($RelativePath)) {
        throw "$FieldName must be a non-empty repository-relative path."
    }
    if ([System.IO.Path]::IsPathRooted($RelativePath)) {
        throw "$FieldName must be relative to the Babel root, not '$RelativePath'."
    }

    $normalizedRoot = [System.IO.Path]::GetFullPath($RootPath).TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    )
    $resolvedPath = [System.IO.Path]::GetFullPath((Join-Path $normalizedRoot $RelativePath))
    $rootPrefix = $normalizedRoot + [System.IO.Path]::DirectorySeparatorChar

    if (-not $resolvedPath.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "$FieldName escapes the Babel root: '$RelativePath'."
    }

    return $resolvedPath
}

function Resolve-StopSignalPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if ([string]::IsNullOrWhiteSpace($Path)) {
        throw "StopSignalPath must be a non-empty absolute path."
    }
    if (-not [System.IO.Path]::IsPathRooted($Path)) {
        throw "StopSignalPath must be an absolute path, not '$Path'."
    }

    try {
        $resolvedPath = [System.IO.Path]::GetFullPath($Path)
    } catch {
        throw "StopSignalPath is not a valid absolute path: '$Path'."
    }

    $temporaryRoot = [System.IO.Path]::GetFullPath(
        [System.IO.Path]::GetTempPath()
    ).TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    )
    $temporaryPrefix = $temporaryRoot + [System.IO.Path]::DirectorySeparatorChar

    if (-not $resolvedPath.StartsWith(
        $temporaryPrefix,
        [System.StringComparison]::OrdinalIgnoreCase
    )) {
        throw "StopSignalPath must be inside the system temporary directory '$temporaryRoot'."
    }

    if (Test-Path -LiteralPath $resolvedPath) {
        throw "StopSignalPath must not already exist: '$resolvedPath'."
    }

    return $resolvedPath
}

function Get-BabelApps {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RootPath
    )

    $registryPath = Join-Path $RootPath "babel.apps.json"
    if (-not (Test-Path -LiteralPath $registryPath -PathType Leaf)) {
        throw "Babel app registry is missing: '$registryPath'."
    }

    try {
        $registry = Get-Content -LiteralPath $registryPath -Raw | ConvertFrom-Json
    } catch {
        throw "Babel app registry is not valid JSON: $($_.Exception.Message)"
    }

    if (-not (Test-ObjectProperty -InputObject $registry -Name "schemaVersion")) {
        throw "Babel app registry is missing 'schemaVersion'."
    }
    if ([string]$registry.schemaVersion -ne "1") {
        throw "Unsupported Babel app registry schemaVersion '$($registry.schemaVersion)'; expected 1."
    }
    if (-not (Test-ObjectProperty -InputObject $registry -Name "apps")) {
        throw "Babel app registry is missing 'apps'."
    }

    $nodeRuntime = Resolve-NodeRuntime -RootPath $RootPath
    Write-Host "[runtime] Node v$($nodeRuntime.Version) ($($nodeRuntime.NodePath))"

    $definitions = @($registry.apps)
    if ($definitions.Count -eq 0) {
        throw "Babel app registry must contain at least one app."
    }

    $names = @{}
    $ids = @{}
    $ports = @{}
    $apps = @()

    foreach ($definition in $definitions) {
        if ($null -eq $definition) {
            throw "Babel app registry contains an empty app entry."
        }

        foreach ($fieldName in @(
            "name",
            "id",
            "workspace",
            "port",
            "healthPath",
            "identityPath",
            "identityText",
            "env",
            "requiredDataPaths"
        )) {
            if (-not (Test-ObjectProperty -InputObject $definition -Name $fieldName)) {
                throw "Babel app registry entry is missing '$fieldName'."
            }
        }

        $name = ([string]$definition.name).Trim()
        $id = ([string]$definition.id).Trim()
        if ([string]::IsNullOrWhiteSpace($name)) {
            throw "Babel app name must not be empty."
        }
        if ($id -notmatch "^[a-z0-9][a-z0-9-]*$") {
            throw "Babel app id '$id' must use lowercase letters, digits, and hyphens."
        }
        if ($names.ContainsKey($name)) {
            throw "Babel app name '$name' is duplicated (names are case-insensitive)."
        }
        if ($ids.ContainsKey($id)) {
            throw "Babel app id '$id' is duplicated (ids are case-insensitive)."
        }

        $port = 0
        if (-not [int]::TryParse([string]$definition.port, [ref]$port) -or $port -lt 1 -or $port -gt 65535) {
            throw "Babel app '$name' has invalid port '$($definition.port)'."
        }
        if ($ports.ContainsKey([string]$port)) {
            throw "Babel app port '$port' is duplicated."
        }

        $healthPath = [string]$definition.healthPath
        $identityPath = [string]$definition.identityPath
        $identityText = [string]$definition.identityText
        if (-not $healthPath.StartsWith("/")) {
            throw "Babel app '$name' healthPath must start with '/'."
        }
        if (-not $identityPath.StartsWith("/")) {
            throw "Babel app '$name' identityPath must start with '/'."
        }
        if ([string]::IsNullOrWhiteSpace($identityText)) {
            throw "Babel app '$name' identityText must not be empty."
        }

        $readyTimeoutSeconds = 60
        if (Test-ObjectProperty -InputObject $definition -Name "readyTimeoutSeconds") {
            if (
                -not [int]::TryParse([string]$definition.readyTimeoutSeconds, [ref]$readyTimeoutSeconds) -or
                $readyTimeoutSeconds -lt 1 -or
                $readyTimeoutSeconds -gt 600
            ) {
                throw "Babel app '$name' has invalid readyTimeoutSeconds '$($definition.readyTimeoutSeconds)'."
            }
        }

        $workspace = Resolve-BabelRelativePath `
            -RootPath $RootPath `
            -RelativePath ([string]$definition.workspace) `
            -FieldName "$name.workspace"
        if (-not (Test-Path -LiteralPath $workspace -PathType Container)) {
            throw "Babel app '$name' workspace is missing: '$workspace'."
        }

        $workspaceManifestPath = Join-Path $workspace "package.json"
        if (-not (Test-Path -LiteralPath $workspaceManifestPath -PathType Leaf)) {
            throw "Babel app '$name' workspace manifest is missing: '$workspaceManifestPath'."
        }
        try {
            $workspaceManifest = Get-Content -LiteralPath $workspaceManifestPath -Raw | ConvertFrom-Json
        } catch {
            throw "Babel app '$name' workspace manifest is not valid JSON: $($_.Exception.Message)"
        }
        $expectedPackageName = "@babel-apps/$id"
        if (
            -not (Test-ObjectProperty -InputObject $workspaceManifest -Name "name") -or
            [string]$workspaceManifest.name -cne $expectedPackageName
        ) {
            throw "Babel app '$name' workspace package name must be '$expectedPackageName'."
        }

        $databaseCheckArguments = @()
        if (
            (Test-ObjectProperty -InputObject $workspaceManifest -Name "scripts") -and
            (Test-ObjectProperty -InputObject $workspaceManifest.scripts -Name "db:check")
        ) {
            $databaseCheckArguments = @("run", "db:check", "-w", $expectedPackageName)
        }

        $environment = @{}
        foreach ($property in @($definition.env.PSObject.Properties)) {
            if ($property.Name -notmatch "^[A-Za-z_][A-Za-z0-9_]*$") {
                throw "Babel app '$name' has invalid environment variable name '$($property.Name)'."
            }
            $environment[$property.Name] = Resolve-BabelRelativePath `
                -RootPath $RootPath `
                -RelativePath ([string]$property.Value) `
                -FieldName "$name.env.$($property.Name)"
        }
        $environment["PATH"] = $nodeRuntime.Directory
        $processPath = [Environment]::GetEnvironmentVariable(
            "PATH",
            [EnvironmentVariableTarget]::Process
        )
        if (-not [string]::IsNullOrWhiteSpace($processPath)) {
            $environment["PATH"] += [IO.Path]::PathSeparator + $processPath
        }

        $requiredDataPaths = @()
        foreach ($relativeDataPath in @($definition.requiredDataPaths)) {
            $requiredDataPaths += Resolve-BabelRelativePath `
                -RootPath $RootPath `
                -RelativePath ([string]$relativeDataPath) `
                -FieldName "$name.requiredDataPaths"
        }
        if ($requiredDataPaths.Count -eq 0) {
            throw "Babel app '$name' must declare at least one requiredDataPath."
        }

        $buildMarker = Join-Path $workspace ".next\BUILD_ID"
        $nextEntrypoint = Join-Path $RootPath "node_modules\next\dist\bin\next"
        $internalBaseUrl = "http://127.0.0.1:$port"
        $publicBaseUrl = "http://localhost:$port"
        $buildInputPaths = @(
            (Join-Path $workspace "src"),
            (Join-Path $workspace "public"),
            (Join-Path $workspace "package.json"),
            (Join-Path $workspace "tsconfig.json"),
            (Join-Path $workspace "next.config.ts"),
            (Join-Path $workspace "next.config.js"),
            (Join-Path $workspace "next-env.d.ts"),
            (Join-Path $workspace "middleware.ts"),
            (Join-Path $workspace "middleware.js"),
            (Join-Path $workspace "proxy.ts"),
            (Join-Path $workspace "proxy.js"),
            (Join-Path $workspace "instrumentation.ts"),
            (Join-Path $workspace "instrumentation.js"),
            (Join-Path $workspace ".env"),
            (Join-Path $workspace ".env.local"),
            (Join-Path $workspace ".env.production"),
            (Join-Path $workspace ".env.production.local"),
            (Join-Path $RootPath "packages\config"),
            (Join-Path $RootPath "packages\markdown"),
            (Join-Path $RootPath "packages\platform"),
            (Join-Path $RootPath "package.json"),
            (Join-Path $RootPath "package-lock.json"),
            $registryPath
        )

        $apps += [pscustomobject]@{
            Name = $name
            Id = $id
            Port = $port
            Url = $internalBaseUrl
            HealthUrl = $internalBaseUrl + $healthPath
            IdentityUrl = $publicBaseUrl + $identityPath
            IdentityText = $identityText
            ReadyTimeoutSeconds = $readyTimeoutSeconds
            RequiredPaths = $requiredDataPaths
            DependencyPath = Join-Path $RootPath "node_modules"
            NextEntrypoint = $nextEntrypoint
            BuildMarker = $buildMarker
            BuildRequiredOutputs = @(
                $buildMarker,
                (Join-Path $workspace ".next\server"),
                (Join-Path $workspace ".next\static"),
                (Join-Path $workspace ".next\required-server-files.json")
            )
            BuildInputPaths = $buildInputPaths
            BuildCommand = $nodeRuntime.NpmPath
            BuildArguments = @("run", "build", "-w", $expectedPackageName)
            BuildWorkingDirectory = $RootPath
            PackageName = $expectedPackageName
            DatabaseCheckCommand = $nodeRuntime.NpmPath
            DatabaseCheckArguments = $databaseCheckArguments
            DatabaseCheckWorkingDirectory = $RootPath
            StartCommand = $nodeRuntime.NodePath
            StartArguments = @(
                $nextEntrypoint,
                "start",
                "-H", "127.0.0.1",
                "-p", [string]$port
            )
            StartWorkingDirectory = $workspace
            RequireDependencyForStart = $true
            Environment = $environment
        }

        $names[$name] = $true
        $ids[$id] = $true
        $ports[[string]$port] = $true
    }

    return @($apps)
}

function Test-TcpPort {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ComputerName,

        [Parameter(Mandatory = $true)]
        [int]$Port,

        [int]$TimeoutMilliseconds = 400
    )

    $client = New-Object System.Net.Sockets.TcpClient
    $asyncResult = $null

    try {
        $asyncResult = $client.BeginConnect($ComputerName, $Port, $null, $null)
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

function Test-AppHealth {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$App
    )

    try {
        $response = Invoke-WebRequest `
            -Uri $App.HealthUrl `
            -UseBasicParsing `
            -TimeoutSec 2

        if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 400) {
            return $false
        }

        $health = $response.Content | ConvertFrom-Json -ErrorAction Stop
        return `
            [string]$health.status -ieq "ok" -and
            [string]$health.app -ieq [string]$App.IdentityText
    } catch {
        return $false
    }
}

function Get-NewestInputTimeUtc {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Paths
    )

    $newest = [DateTime]::MinValue

    foreach ($path in $Paths) {
        if (Test-Path -LiteralPath $path -PathType Container) {
            $rootDirectory = Get-Item -LiteralPath $path
            if ($rootDirectory.LastWriteTimeUtc -gt $newest) {
                $newest = $rootDirectory.LastWriteTimeUtc
            }

            foreach ($directory in Get-ChildItem -LiteralPath $path -Recurse -Directory) {
                if ($directory.LastWriteTimeUtc -gt $newest) {
                    $newest = $directory.LastWriteTimeUtc
                }
            }

            foreach ($file in Get-ChildItem -LiteralPath $path -Recurse -File) {
                if ($file.LastWriteTimeUtc -gt $newest) {
                    $newest = $file.LastWriteTimeUtc
                }
            }
        } elseif (Test-Path -LiteralPath $path -PathType Leaf) {
            $file = Get-Item -LiteralPath $path
            if ($file.LastWriteTimeUtc -gt $newest) {
                $newest = $file.LastWriteTimeUtc
            }
        }
    }

    return $newest
}

function Test-BuildRequired {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$App
    )

    foreach ($outputPath in $App.BuildRequiredOutputs) {
        if (-not (Test-Path -LiteralPath $outputPath)) {
            return $true
        }
    }

    $markerTime = (Get-Item -LiteralPath $App.BuildMarker).LastWriteTimeUtc
    $newestInput = Get-NewestInputTimeUtc -Paths $App.BuildInputPaths
    if ($newestInput -gt $markerTime) {
        return $true
    }

    return $false
}

function Set-TemporaryEnvironment {
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Environment
    )

    $snapshot = @{}

    foreach ($name in $Environment.Keys) {
        $snapshot[$name] = [Environment]::GetEnvironmentVariable(
            [string]$name,
            [EnvironmentVariableTarget]::Process
        )
        [Environment]::SetEnvironmentVariable(
            [string]$name,
            [string]$Environment[$name],
            [EnvironmentVariableTarget]::Process
        )
    }

    return $snapshot
}

function Restore-Environment {
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Snapshot
    )

    foreach ($name in $Snapshot.Keys) {
        [Environment]::SetEnvironmentVariable(
            [string]$name,
            $Snapshot[$name],
            [EnvironmentVariableTarget]::Process
        )
    }
}

function Assert-AppDatabaseReady {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$App
    )

    if ($App.DatabaseCheckArguments.Count -eq 0) {
        return
    }

    $command = Get-Command $App.DatabaseCheckCommand -ErrorAction SilentlyContinue
    if ($null -eq $command) {
        throw "Cannot find '$($App.DatabaseCheckCommand)' required to check $($App.Name)'s database."
    }

    $exitCode = 1
    $environmentSnapshot = Set-TemporaryEnvironment -Environment $App.Environment
    Push-Location -LiteralPath $App.DatabaseCheckWorkingDirectory

    try {
        & $command.Source @($App.DatabaseCheckArguments) | Out-Host
        $exitCode = $LASTEXITCODE
    } finally {
        Pop-Location
        Restore-Environment -Snapshot $environmentSnapshot
    }

    if ($exitCode -ne 0) {
        throw "$($App.Name) database readiness check failed. Review the diagnostic output above and retry."
    }
}

function Assert-AppPreflight {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$App
    )

    foreach ($requiredPath in $App.RequiredPaths) {
        if (-not (Test-Path -LiteralPath $requiredPath)) {
            throw "$($App.Name) requires '$requiredPath'. The launcher will not create or migrate user data."
        }
    }

    if ($App.RequireDependencyForStart -and -not (Test-Path -LiteralPath $App.DependencyPath -PathType Container)) {
        throw "$($App.Name) dependencies are missing. Run 'npm install' manually in '$($App.BuildWorkingDirectory)', then retry."
    }

    if ($App.RequireDependencyForStart -and -not (Test-Path -LiteralPath $App.NextEntrypoint -PathType Leaf)) {
        throw "$($App.Name) Next.js entrypoint is missing from the root node_modules. Run 'npm install' manually in '$($App.BuildWorkingDirectory)', then retry."
    }
}

function Invoke-AppBuild {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$App
    )

    if (-not (Test-Path -LiteralPath $App.DependencyPath -PathType Container)) {
        throw "$($App.Name) build dependencies are missing. Run 'npm install' manually in '$($App.BuildWorkingDirectory)'."
    }

    $command = Get-Command $App.BuildCommand -ErrorAction SilentlyContinue
    if ($null -eq $command) {
        throw "Cannot find '$($App.BuildCommand)' required to build $($App.Name)."
    }

    Write-Host "[build] $($App.Name) sources are newer than its build output." -ForegroundColor Yellow
    Write-Host "[build] Running: npm $(@($App.BuildArguments) -join ' ')"

    $environmentSnapshot = Set-TemporaryEnvironment -Environment $App.Environment
    Push-Location -LiteralPath $App.BuildWorkingDirectory

    try {
        & $command.Source @($App.BuildArguments) | Out-Host
        $exitCode = $LASTEXITCODE
    } finally {
        Pop-Location
        Restore-Environment -Snapshot $environmentSnapshot
    }

    if ($exitCode -ne 0) {
        throw "$($App.Name) build failed with exit code $exitCode."
    }

    if (-not (Test-Path -LiteralPath $App.BuildMarker -PathType Leaf)) {
        throw "$($App.Name) build completed without creating '$($App.BuildMarker)'."
    }

    Write-Host "[build] $($App.Name) build is ready." -ForegroundColor Green
}

function Ensure-AppBuild {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$App
    )

    if (Test-BuildRequired -App $App) {
        Invoke-AppBuild -App $App
    } else {
        Write-Host "[build] $($App.Name) build is current."
    }
}

function Start-AppProcess {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$App
    )

    $command = Get-Command $App.StartCommand -ErrorAction SilentlyContinue
    if ($null -eq $command) {
        throw "Cannot find '$($App.StartCommand)' required to start $($App.Name)."
    }

    $environmentSnapshot = Set-TemporaryEnvironment -Environment $App.Environment

    try {
        return Start-BabelDetachedProcess `
            -FilePath $command.Source `
            -Arguments (@($App.StartArguments) -join " ") `
            -WorkingDirectory $App.StartWorkingDirectory
    } finally {
        Restore-Environment -Snapshot $environmentSnapshot
    }
}

function Wait-AppReady {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$App,

        [System.Diagnostics.Process]$RootProcess
    )

    $deadline = [DateTime]::UtcNow.AddSeconds($App.ReadyTimeoutSeconds)

    while ([DateTime]::UtcNow -lt $deadline) {
        if ($null -ne $RootProcess) {
            $RootProcess.Refresh()
            if ($RootProcess.HasExited) {
                throw "$($App.Name) exited before it became ready (exit code $($RootProcess.ExitCode))."
            }
        }

        if (Test-AppHealth -App $App) {
            return
        }

        Start-Sleep -Milliseconds 300
    }

    throw "$($App.Name) did not become ready at '$($App.HealthUrl)' within $($App.ReadyTimeoutSeconds) seconds."
}

function Wait-ExistingAppReady {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$App
    )

    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (Test-AppHealth -App $App) {
            return
        }
        Start-Sleep -Milliseconds 300
    }

    throw "Port $($App.Port) is occupied, but the listener is not a healthy $($App.Name) instance. The launcher will not start, open, or stop it."
}

function Start-OrReuseApp {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$App,

        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [System.Collections.ArrayList]$ManagedEntries
    )

    if (Test-TcpPort -ComputerName "127.0.0.1" -Port $App.Port) {
        Write-Host "[reuse] $($App.Name) is already listening on port $($App.Port)." -ForegroundColor Cyan
        Wait-ExistingAppReady -App $App
        Write-Host "[ready] $($App.Name): $($App.IdentityUrl)" -ForegroundColor Green

        return [pscustomobject]@{
            App = $App
            AlreadyRunning = $true
        }
    }

    Assert-AppPreflight -App $App
    Assert-AppDatabaseReady -App $App
    Ensure-AppBuild -App $App

    Write-Host "[start] Starting $($App.Name) on port $($App.Port)..."
    $rootProcess = Start-AppProcess -App $App
    $managedEntry = [pscustomobject]@{
        App = $App
        RootProcess = $rootProcess
    }
    [void]$ManagedEntries.Add($managedEntry)

    Wait-AppReady -App $App -RootProcess $rootProcess
    Write-Host "[ready] $($App.Name): $($App.IdentityUrl)" -ForegroundColor Green
    return [pscustomobject]@{
        App = $App
        AlreadyRunning = $false
    }
}

function Stop-ProcessTree {
    param(
        [Parameter(Mandatory = $true)]
        [System.Diagnostics.Process]$Process
    )

    try {
        $Process.Refresh()
    } catch {
        return
    }

    if ($Process.HasExited -or $Process.Id -eq $PID) {
        return
    }

    $naturalExitDeadline = [DateTime]::UtcNow.AddSeconds(4)
    while (-not $Process.HasExited -and [DateTime]::UtcNow -lt $naturalExitDeadline) {
        Start-Sleep -Milliseconds 100
        $Process.Refresh()
    }

    if ($Process.HasExited) {
        return
    }

    $processId = $Process.Id
    $null = Start-Process `
        -FilePath "$env:SystemRoot\System32\taskkill.exe" `
        -ArgumentList @("/PID", [string]$processId, "/T") `
        -WindowStyle Hidden `
        -Wait `
        -PassThru

    $softExitDeadline = [DateTime]::UtcNow.AddSeconds(2)
    while (-not $Process.HasExited -and [DateTime]::UtcNow -lt $softExitDeadline) {
        Start-Sleep -Milliseconds 100
        $Process.Refresh()
    }

    if (-not $Process.HasExited) {
        $null = Start-Process `
            -FilePath "$env:SystemRoot\System32\taskkill.exe" `
            -ArgumentList @("/PID", [string]$processId, "/T", "/F") `
            -WindowStyle Hidden `
            -Wait `
            -PassThru
    }

    $Process.Refresh()
    if (-not $Process.HasExited) {
        try {
            $Process.Kill()
            $null = $Process.WaitForExit(5000)
        } catch {
            # The port-level check below reports any process that remains.
        }
    }
}

function Stop-ManagedServices {
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [System.Collections.ArrayList]$ManagedEntries
    )

    if ($ManagedEntries.Count -eq 0) {
        return
    }

    Write-Host ""
    Write-Host "[stop] Stopping services launched by this window..." -ForegroundColor Yellow
    for ($index = $ManagedEntries.Count - 1; $index -ge 0; $index--) {
        $entry = $ManagedEntries[$index]
        Stop-ProcessTree -Process $entry.RootProcess

        $deadline = [DateTime]::UtcNow.AddSeconds(12)
        while (
            [DateTime]::UtcNow -lt $deadline -and
            (Test-TcpPort -ComputerName "127.0.0.1" -Port $entry.App.Port)
        ) {
            Start-Sleep -Milliseconds 200
        }

        if (Test-TcpPort -ComputerName "127.0.0.1" -Port $entry.App.Port) {
            Write-Warning "$($entry.App.Name) is still listening on port $($entry.App.Port)."
        } else {
            Write-Host "[stop] $($entry.App.Name) stopped."
        }
    }
}

function Get-SelectedApps {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RequestedSelection,

        [Parameter(Mandatory = $true)]
        [object[]]$Apps
    )

    $resolvedSelection = $RequestedSelection.Trim()
    if ([string]::IsNullOrWhiteSpace($resolvedSelection)) {
        throw "Selection must be Menu, All, or a registered app name or id."
    }

    while ($resolvedSelection.Equals("Menu", [System.StringComparison]::OrdinalIgnoreCase)) {
        Write-Host ""
        Write-Host "Babel" -ForegroundColor Cyan
        for ($index = 0; $index -lt $Apps.Count; $index++) {
            Write-Host "  [$($index + 1)] $($Apps[$index].Name)"
        }
        $allChoice = $Apps.Count + 1
        Write-Host "  [$allChoice] Start all"
        Write-Host ""

        $choice = 0
        $answer = Read-Host "Choose 1 through $allChoice"
        if (-not [int]::TryParse($answer, [ref]$choice) -or $choice -lt 1 -or $choice -gt $allChoice) {
            Write-Host "Please enter a number from 1 through $allChoice." -ForegroundColor Yellow
        } elseif ($choice -eq $allChoice) {
            $resolvedSelection = "All"
        } else {
            $resolvedSelection = $Apps[$choice - 1].Id
        }
    }

    if ($resolvedSelection.Equals("All", [System.StringComparison]::OrdinalIgnoreCase)) {
        return @($Apps)
    }

    foreach ($app in $Apps) {
        if (
            $resolvedSelection.Equals($app.Name, [System.StringComparison]::OrdinalIgnoreCase) -or
            $resolvedSelection.Equals($app.Id, [System.StringComparison]::OrdinalIgnoreCase)
        ) {
            return @($app)
        }
    }

    throw "Unknown selection '$resolvedSelection'. Use Menu, All, or a registered app name or id."
}

function Wait-ForStopRequest {
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [System.Collections.ArrayList]$ManagedEntries,

        [AllowNull()]
        [string]$StopSignalPath
    )

    Write-Host ""
    $useStopSignal = -not [string]::IsNullOrWhiteSpace($StopSignalPath)
    if ($useStopSignal) {
        Write-Host "Keep this worker running. Waiting for the stop signal at '$StopSignalPath'." -ForegroundColor Cyan
    } else {
        Write-Host "Keep this window open. Press Ctrl+C to stop services launched by it." -ForegroundColor Cyan
    }

    $nextProcessCheck = [DateTime]::UtcNow

    while ($true) {
        if ($useStopSignal -and (Test-Path -LiteralPath $StopSignalPath -PathType Leaf)) {
            Write-Host "[stop] Stop signal received: '$StopSignalPath'." -ForegroundColor Yellow
            return
        }

        if ([DateTime]::UtcNow -ge $nextProcessCheck) {
            foreach ($entry in $ManagedEntries) {
                $entry.RootProcess.Refresh()
                if ($entry.RootProcess.HasExited) {
                    throw "$($entry.App.Name) stopped unexpectedly (exit code $($entry.RootProcess.ExitCode))."
                }
            }
            $nextProcessCheck = [DateTime]::UtcNow.AddSeconds(1)
        }

        Start-Sleep -Milliseconds 500
    }
}

$babelRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$managedEntries = New-Object System.Collections.ArrayList
$resolvedStopSignalPath = $null
$exitCode = 0

try {
    if ($PSBoundParameters.ContainsKey("StopSignalPath")) {
        $resolvedStopSignalPath = Resolve-StopSignalPath -Path $StopSignalPath
    }

    $registeredApps = @(Get-BabelApps -RootPath $babelRoot)
    $selectedApps = @(Get-SelectedApps `
        -RequestedSelection $Selection `
        -Apps $registeredApps)

    $statuses = @()
    foreach ($app in $selectedApps) {
        $statuses += Start-OrReuseApp -App $app -ManagedEntries $managedEntries
    }

    if ($VerifyAndExit) {
        Write-Host "[verify] Readiness checks passed; cleaning up managed services."
    } else {
        Wait-ForStopRequest `
            -ManagedEntries $managedEntries `
            -StopSignalPath $resolvedStopSignalPath
    }
} catch {
    Write-Host ""
    Write-Host "[error] $($_.Exception.Message)" -ForegroundColor Red
    $exitCode = 1
} finally {
    try {
        Stop-ManagedServices -ManagedEntries $managedEntries
    } finally {
        if (
            -not [string]::IsNullOrWhiteSpace($resolvedStopSignalPath) -and
            (Test-Path -LiteralPath $resolvedStopSignalPath -PathType Leaf)
        ) {
            try {
                Remove-Item -LiteralPath $resolvedStopSignalPath -Force -ErrorAction Stop
            } catch {
                Write-Warning "Could not remove stop signal file '$resolvedStopSignalPath': $($_.Exception.Message)"
            }
        }
    }
}

if ($exitCode -ne 0) {
    $global:BabelLauncherExitCode = $exitCode
    if (
        -not $VerifyAndExit -and
        -not $PSBoundParameters.ContainsKey("StopSignalPath") -and
        [string]::IsNullOrWhiteSpace($resolvedStopSignalPath) -and
        -not [Console]::IsInputRedirected
    ) {
        Write-Host ""
        $null = Read-Host "Press Enter to close"
    }
    exit $exitCode
}
