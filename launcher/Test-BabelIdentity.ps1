#requires -Version 7.0
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([Threading.Thread]::CurrentThread.ApartmentState -ne 'STA') {
    throw 'Run this identity check with pwsh.exe -STA.'
}
. (Join-Path $PSScriptRoot 'Babel.Identity.ps1')
[BabelLauncher.DesktopIdentity]::InitializeProcess()
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class BabelIdentityProbe {
    [DllImport("shell32.dll")]
    public static extern int GetCurrentProcessExplicitAppUserModelID(out IntPtr appId);
}
'@
$appIdPointer = [IntPtr]::Zero
[Runtime.InteropServices.Marshal]::ThrowExceptionForHR([BabelIdentityProbe]::GetCurrentProcessExplicitAppUserModelID([ref]$appIdPointer))
try {
    if ([Runtime.InteropServices.Marshal]::PtrToStringUni($appIdPointer) -ne 'Babel.Desktop') {
        throw 'The GUI process still has another application identity.'
    }
} finally { [Runtime.InteropServices.Marshal]::FreeCoTaskMem($appIdPointer) }

# Read the actual native property store, retaining it through window destruction
# so the test also verifies resource cleanup and cancelled-close behavior.
$identityType = [BabelLauncher.DesktopIdentity]
$propertyKeyType = $identityType.GetNestedType('PropertyKey', [Reflection.BindingFlags]::NonPublic)
$storeType = $identityType.GetNestedType('IPropertyStore', [Reflection.BindingFlags]::NonPublic)
$getValue = $storeType.GetMethod('GetValue')
function Read-IdentityValue($Store, [uint32]$Id) {
    $key = [Activator]::CreateInstance($propertyKeyType)
    $propertyKeyType.GetField('Format').SetValue($key, [Guid]'9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3')
    $propertyKeyType.GetField('Id').SetValue($key, $Id)
    $arguments = [object[]]@($key, $null)
    $null = $getValue.Invoke($Store, $arguments)
    $variant = $arguments[1]
    if ($variant.Type -eq 0) { return $null }
    if ($variant.Type -ne 31) { throw 'Unexpected property value type.' }
    try { return [Runtime.InteropServices.Marshal]::PtrToStringUni($variant.Value) }
    finally { [Runtime.InteropServices.Marshal]::FreeCoTaskMem($variant.Value) }
}

$window = [Windows.Window]::new()
$window.ShowInTaskbar = $false
Set-BabelWindowIdentity -Window $window
$handle = [Windows.Interop.WindowInteropHelper]::new($window).EnsureHandle()
$store = $identityType.GetMethod('OpenStore', [Reflection.BindingFlags]'NonPublic,Static').Invoke($null, [object[]]@($handle))
try {
    $expected = @{
        2 = '"' + (Join-Path $PSScriptRoot 'Babel.exe') + '"'
        3 = (Join-Path $PSScriptRoot 'assets\Babel.ico') + ',0'
        4 = 'Babel'
        5 = 'Babel.Desktop'
    }
    foreach ($id in $expected.Keys) {
        if ((Read-IdentityValue $store $id) -ne $expected[$id]) { throw "Wrong taskbar property $id." }
    }
    $cancelClose = [ComponentModel.CancelEventHandler]{ param($sender, $eventArgs) $eventArgs.Cancel = $true }
    $window.Add_Closing($cancelClose)
    $window.Close()
    if ((Read-IdentityValue $store 5) -ne 'Babel.Desktop') { throw 'Cancelled close lost the taskbar identity.' }
    $window.Remove_Closing($cancelClose)
    $window.Close()
    foreach ($id in $expected.Keys) {
        if ($null -ne (Read-IdentityValue $store $id)) { throw "Taskbar property $id was not cleared on destruction." }
    }
} finally {
    $window.Close()
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($store)
}
Write-Output 'PASS Babel process identity, taskbar icon, relaunch target, cancelled close, and destruction cleanup.'
