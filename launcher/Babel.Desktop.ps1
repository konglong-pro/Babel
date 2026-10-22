#requires -Version 7.0
Set-StrictMode -Version 2.0

function Import-BabelDesktopRuntime {
    param([string]$SdkDirectory = (Join-Path $PSScriptRoot '.webview2/1.0.3537.50'))

    if ($null -ne ('BabelLauncher.DesktopHost' -as [type])) { return }
    $architecture = [Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture.ToString().ToLowerInvariant()
    $managedDirectory = Join-Path $SdkDirectory 'lib_manual/netcoreapp3.0'
    $corePath = Join-Path $managedDirectory 'Microsoft.Web.WebView2.Core.dll'
    $wpfPath = Join-Path $managedDirectory 'Microsoft.Web.WebView2.Wpf.dll'
    $loaderPath = Join-Path $SdkDirectory "runtimes/win-$architecture/native/WebView2Loader.dll"
    foreach ($path in @($corePath, $wpfPath, $loaderPath)) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw 'Babel desktop components are missing. Run npm.cmd run launcher:setup in the Babel folder, then open Babel again.'
        }
    }
    Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase
    [void][Runtime.InteropServices.NativeLibrary]::Load($loaderPath)
    Add-Type -LiteralPath $corePath
    Add-Type -LiteralPath $wpfPath
    $references = @(Get-ChildItem -LiteralPath (Join-Path $PSHOME 'ref') -Filter '*.dll' |
        Where-Object Name -notin @('WindowsBase.dll', 'System.Windows.dll') |
        ForEach-Object FullName)
    $references += @($corePath, $wpfPath)
    foreach ($name in @('WindowsBase.dll', 'PresentationCore.dll', 'PresentationFramework.dll', 'System.Xaml.dll')) {
        $references += Join-Path $PSHOME $name
    }
    # The SDK targets .NET Core 3.0; PowerShell supplies newer compatible WPF
    # assemblies. Suppress only the compiler's reference-version unification warnings.
    Add-Type -LiteralPath (Join-Path $PSScriptRoot 'Babel.Desktop.cs') -ReferencedAssemblies $references `
        -CompilerOptions '/nowarn:1701,1702' -ErrorAction Stop
    try {
        [void][Microsoft.Web.WebView2.Core.CoreWebView2Environment]::GetAvailableBrowserVersionString()
    } catch {
        throw 'Microsoft Edge WebView2 Runtime is unavailable. Install the Microsoft WebView2 Evergreen Runtime, then open Babel again.'
    }
}
