Option Explicit

Dim shell
Dim fileSystem
Dim scriptDirectory
Dim command
Dim exitCode

Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

scriptDirectory = fileSystem.GetParentFolderName(WScript.ScriptFullName)
command = "pwsh.exe -NoLogo -NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File " _
    & Chr(34) & scriptDirectory & "\Babel.Gui.ps1" & Chr(34)

exitCode = shell.Run(command, 0, True)
If exitCode <> 0 Then
    MsgBox "Babel Launcher could not open. Run launcher\Babel.Gui.ps1 -SmokeTest in PowerShell for details.", _
        vbCritical, "Babel Launcher"
End If
WScript.Quit exitCode
