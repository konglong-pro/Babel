#requires -Version 7.0
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$FixtureOrigin)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ([Threading.Thread]::CurrentThread.ApartmentState -ne 'STA') { throw 'Run with pwsh.exe -STA.' }
$fixture = [Uri]$FixtureOrigin
if ($fixture.Scheme -ne 'http' -or -not $fixture.IsLoopback -or $fixture.UserInfo.Length -gt 0 -or
    $FixtureOrigin -ne $fixture.GetLeftPart([UriPartial]::Authority)) { throw 'Expected an isolated local fixture origin.' }
. (Join-Path $PSScriptRoot 'Babel.Desktop.ps1')
Import-BabelDesktopRuntime
$managedDirectory = Join-Path $PSScriptRoot '.webview2/1.0.3537.50/lib_manual/netcoreapp3.0'
$references = @(Get-ChildItem -LiteralPath (Join-Path $PSHOME 'ref') -Filter '*.dll' |
    Where-Object Name -notin @('WindowsBase.dll', 'System.Windows.dll') | ForEach-Object FullName)
$references += @((Join-Path $managedDirectory 'Microsoft.Web.WebView2.Core.dll'), (Join-Path $managedDirectory 'Microsoft.Web.WebView2.Wpf.dll'))
foreach ($name in @('WindowsBase.dll', 'PresentationCore.dll', 'PresentationFramework.dll', 'System.Xaml.dll')) { $references += Join-Path $PSHOME $name }
Add-Type -LiteralPath (Join-Path $PSScriptRoot 'Babel.KeyboardModes.Smoke.cs') -ReferencedAssemblies $references `
    -CompilerOptions '/nowarn:1701,1702' -ErrorAction Stop
$temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$profileName = 'babel-keyboard-modes-' + [Guid]::NewGuid().ToString('N')
$profilePath = Join-Path $temporaryRoot $profileName
[void][IO.Directory]::CreateDirectory($profilePath)
$failure = $null
try { [BabelLauncher.KeyboardModesSmoke]::Run([BabelLauncher.DesktopHost], $FixtureOrigin, $profilePath) }
catch { $failure = $_ }
finally {
    $resolvedProfile = [IO.Path]::GetFullPath($profilePath)
    if ([IO.Path]::GetDirectoryName($resolvedProfile) -ne [IO.Path]::TrimEndingDirectorySeparator($temporaryRoot) -or
        [IO.Path]::GetFileName($resolvedProfile) -ne $profileName) { throw 'Refusing cleanup outside the generated temporary profile.' }
    for ($attempt = 0; $attempt -lt 20 -and (Test-Path -LiteralPath $resolvedProfile); $attempt++) {
        try { Remove-Item -LiteralPath $resolvedProfile -Recurse -Force -ErrorAction Stop }
        catch {
            if ($attempt -eq 3) {
                Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" |
                    Where-Object { $null -ne $_.CommandLine -and $_.CommandLine.Contains($resolvedProfile, [StringComparison]::OrdinalIgnoreCase) } |
                    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
            }
            if ($attempt -eq 19) { throw }
            Start-Sleep -Milliseconds 250
        }
    }
}
if ($null -ne $failure) { throw $failure }
