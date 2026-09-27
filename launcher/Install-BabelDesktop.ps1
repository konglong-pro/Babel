#requires -Version 7.0
[CmdletBinding()]
param(
    [string]$PackagePath,
    [string]$CacheDirectory = (Join-Path $PSScriptRoot '.webview2')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Pin both the official NuGet archive and the files loaded by the desktop host.
$sdkVersion = '1.0.3537.50'
$packageHash = '5EA526BBD728ADDA0DA4D31219267E96460494A427E4894C4E09D9F320F4B9AA'
$packageUrl = "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$sdkVersion/microsoft.web.webview2.$sdkVersion.nupkg"
$requiredFiles = [ordered]@{
    'lib_manual/netcoreapp3.0/Microsoft.Web.WebView2.Core.dll' = 'E6C517412C245C0F0D65FC494D4F7BF883EBA3CFD7023C3F66CC1FE774EC0A22'
    'lib_manual/netcoreapp3.0/Microsoft.Web.WebView2.Wpf.dll' = '86CE9DEF2507C20EF30E29B581B3AD66C50CC9D35EE5928E472ED96AE2781509'
    'runtimes/win-arm64/native/WebView2Loader.dll' = '0F753606AAA25E21B6C6F4C270AB4A9831029E75C1741D9F27A434961EE6B657'
    'runtimes/win-x64/native/WebView2Loader.dll' = '2F965E10AED3B356A408978A0E6D74EB86E3E722DD008FA9AD39F68884479E85'
    'runtimes/win-x86/native/WebView2Loader.dll' = '64242980E4C4C125F91056589BEA141CFC9218A9C667BC1D5B14B5A165E78000'
}

function Test-BabelDesktopSdk {
    param([string]$Directory)

    foreach ($entry in $requiredFiles.GetEnumerator()) {
        $filePath = Join-Path $Directory $entry.Key
        if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) { return $false }
        if ((Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash -ne $entry.Value) { return $false }
    }
    return $true
}

$cacheRoot = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($CacheDirectory)
$installPath = Join-Path $cacheRoot $sdkVersion
if (Test-Path -LiteralPath $installPath) {
    if (-not (Test-BabelDesktopSdk -Directory $installPath)) {
        throw "The cached WebView2 SDK is incomplete or modified: $installPath. Move that version directory aside and rerun npm run launcher:setup."
    }
    Write-Output "WebView2 SDK $sdkVersion is ready: $installPath"
    return
}

if (-not [string]::IsNullOrWhiteSpace($PackagePath)) {
    $PackagePath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($PackagePath)
    if (-not (Test-Path -LiteralPath $PackagePath -PathType Leaf)) {
        throw "The offline WebView2 SDK package does not exist: $PackagePath"
    }
}

[void][IO.Directory]::CreateDirectory($cacheRoot)
$stagingName = '.install-' + [Guid]::NewGuid().ToString('N')
$stagingPath = Join-Path $cacheRoot $stagingName
[void][IO.Directory]::CreateDirectory($stagingPath)
try {
    if ([string]::IsNullOrWhiteSpace($PackagePath)) {
        $PackagePath = Join-Path $stagingPath 'webview2.nupkg'
        Write-Output "Downloading Microsoft.Web.WebView2 $sdkVersion from NuGet."
        Invoke-WebRequest -Uri $packageUrl -OutFile $PackagePath -TimeoutSec 120 -MaximumRetryCount 2 -RetryIntervalSec 2
    }

    if ((Get-FileHash -LiteralPath $PackagePath -Algorithm SHA256).Hash -ne $packageHash) {
        throw "WebView2 SDK package SHA256 mismatch. Expected the official Microsoft.Web.WebView2 $sdkVersion package. Nothing was installed."
    }

    $extractedPath = Join-Path $stagingPath 'sdk'
    [IO.Compression.ZipFile]::ExtractToDirectory($PackagePath, $extractedPath)
    if (-not (Test-BabelDesktopSdk -Directory $extractedPath)) {
        throw 'The verified WebView2 SDK package is missing required desktop files. Nothing was installed.'
    }
    # Same-volume rename publishes a complete SDK and never overwrites another install.
    [IO.Directory]::Move($extractedPath, $installPath)
    Write-Output "WebView2 SDK $sdkVersion is ready: $installPath"
    Write-Output 'The existing Microsoft Edge WebView2 Runtime will be used; no system runtime was installed.'
} finally {
    # Cleanup is limited to the fresh, randomly named staging directory owned by this run.
    $resolvedStaging = [IO.Path]::GetFullPath($stagingPath)
    $expectedStaging = [IO.Path]::GetFullPath((Join-Path $cacheRoot $stagingName))
    if ($resolvedStaging -eq $expectedStaging -and
        [IO.Path]::GetDirectoryName($resolvedStaging) -eq [IO.Path]::TrimEndingDirectorySeparator($cacheRoot) -and
        (Test-Path -LiteralPath $resolvedStaging -PathType Container)) {
        Remove-Item -LiteralPath $resolvedStaging -Recurse -Force
    }
}
