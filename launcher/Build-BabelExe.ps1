[CmdletBinding()]
param(
    [string]$OutputPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$launcherDirectory = Split-Path -Parent $PSCommandPath
$sourcePath = Join-Path $launcherDirectory "Babel.Launcher.cs"
$iconPath = Join-Path $launcherDirectory "assets\Babel.ico"
$automationAssemblyRoot = Join-Path $env:WINDIR "Microsoft.Net\assembly\GAC_MSIL\System.Management.Automation"
$automationAssemblyPath = @(
    Get-ChildItem `
        -LiteralPath $automationAssemblyRoot `
        -Filter "System.Management.Automation.dll" `
        -Recurse `
        -ErrorAction SilentlyContinue |
        Sort-Object FullName |
        Select-Object -ExpandProperty FullName
)[0]

if ([string]::IsNullOrWhiteSpace($automationAssemblyPath)) {
    throw "Windows PowerShell 5.1 automation assembly was not found under $automationAssemblyRoot."
}

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $launcherDirectory "Babel.exe"
} else {
    $OutputPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputPath)
}

$frameworkRoot = $null
$compilerPath = $null
foreach ($candidateRoot in @(
    (Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319"),
    (Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319")
)) {
    $candidateCompiler = Join-Path $candidateRoot "csc.exe"
    if (Test-Path -LiteralPath $candidateCompiler -PathType Leaf) {
        $frameworkRoot = $candidateRoot
        $compilerPath = $candidateCompiler
        break
    }
}

if ($null -eq $compilerPath) {
    throw "The .NET Framework C# compiler was not found."
}

foreach ($requiredPath in @($sourcePath, $iconPath, $automationAssemblyPath)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "Required launcher input is missing: $requiredPath"
    }
}

& $compilerPath `
    /nologo `
    /noconfig `
    /nostdlib+ `
    /target:winexe `
    /optimize+ `
    /platform:anycpu `
    "/win32icon:$iconPath" `
    "/reference:$(Join-Path $frameworkRoot 'mscorlib.dll')" `
    "/reference:$(Join-Path $frameworkRoot 'System.dll')" `
    "/reference:$(Join-Path $frameworkRoot 'System.Core.dll')" `
    "/reference:$automationAssemblyPath" `
    "/reference:$(Join-Path $frameworkRoot 'System.Windows.Forms.dll')" `
    "/out:$OutputPath" `
    $sourcePath

if ($LASTEXITCODE -ne 0) {
    throw "Babel.exe compilation failed with exit code $LASTEXITCODE."
}

Write-Output "Built $OutputPath"
