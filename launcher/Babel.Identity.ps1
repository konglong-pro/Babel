#requires -Version 7.0
Set-StrictMode -Version 2.0

if ($null -eq ('BabelLauncher.DesktopIdentity' -as [type])) {
    Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase
    $identityReferences = @(Get-ChildItem -LiteralPath (Join-Path $PSHOME 'ref') -Filter '*.dll' |
        Where-Object Name -notin @('WindowsBase.dll', 'System.Windows.dll') |
        ForEach-Object FullName)
    foreach ($identityAssembly in @('WindowsBase.dll', 'PresentationCore.dll', 'PresentationFramework.dll', 'System.Xaml.dll')) {
        $identityReferences += Join-Path $PSHOME $identityAssembly
    }
    Add-Type -LiteralPath (Join-Path $PSScriptRoot 'Babel.Identity.cs') -ReferencedAssemblies $identityReferences `
        -ErrorAction Stop
}

function Set-BabelWindowIdentity {
    param([Parameter(Mandatory = $true)][Windows.Window]$Window)

    [BabelLauncher.DesktopIdentity]::Attach(
        $Window, (Join-Path $PSScriptRoot 'Babel.exe'), (Join-Path $PSScriptRoot 'assets\Babel.ico'))
}
